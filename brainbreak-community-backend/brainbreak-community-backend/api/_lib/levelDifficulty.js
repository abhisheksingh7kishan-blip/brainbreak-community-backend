// /api/_lib/levelDifficulty.js
// SERVER-SIDE difficulty rating. This is the same LEVEL_DIFFICULTY algorithm that lives in the game file
// (identical source, verified to give identical ratings on real levels). The server runs it itself on the
// stored level data, so a player can never submit a fake rating - the client's own number is only a preview.
//
// Rating = how many attempts a typical first-time player needs (see the algorithm comment in the game file):
//   0 bars TOO SIMPLE · 1 SIMPLE · 2 MODERATE · 3 HARD · 4 VERY HARD · 5 ULTRA HARD
import { COMMUNITY_CODEC } from './communityCodec.js';

const LEVEL_DIFFICULTY = (() => {
  'use strict';
  const VERSION = 1;

  // ---- engine physics (mirrors ENGINE: GRAVITY 1500, MOVE_SPEED 230, JUMP 820) ----
  const G = 1500, SPEED = 230, JUMP_V = 820;
  const MAX_RISE = (JUMP_V * JUMP_V) / (2 * G);          // ~224 px
  const PLAYER_W = 28;

  // ---- threat weight per object type (0 = harmless, 1 = lethal & hard to read) ----
  const W = {};
  const set = (w, names) => names.split(/\s+/).filter(Boolean).forEach(n => { W[n] = w; });
  set(0.50, 'spike wallSpike ceilingSpike deathPlatform dangerousDecoration');
  set(0.70, 'sawBlade fireJet fallingRock explodingBarrel weatherHazard earthquakeZone laserGate movingWall pistonWall dormantSpike');
  set(0.80, 'spikeWheel swingingPendulum rollingBoulder rollingPress crusher scissorWall jumpArmedSpike coinArmedSpike proximityTrap trapSwitch floodRoomWater risingHazard');
  set(0.95, 'chaserSpike hunterCeiling hunterLaser ambushDrone mirrorEnemy predictionSpike panicRoomZone escapeSequenceZone hiddenMovingWall teleportBehindTrap');
  set(0.90, 'hiddenSpike');
  set(0.35, 'fakeSpike fakeCheckpoint fakeSignPlatform');
  set(0.70, 'fakeExit fakeVictory fakeSafeZone trollCollectible invisibleTrigger shadowBlock');
  set(0.80, 'invisiblePlatform vanishOnApproach phantomMirrorPlatform quantumTile reverseTrapPlatform');
  set(0.45, 'crumblePlatform countedCrumblePlatform blinkPlatform stillnessCollapsePlatform shiftOnContactPlatform growShrinkPlatform hingedSwingPlatform rotatingPlatform orbitPlatform pistonPlatform magneticPlatform icePlatform floorWave clonePlatform speedReactivePlatform');
  set(0.30, 'delayedPlatform delayedAppearPlatform cloudDriftPlatform stickyPlatform conveyorPlatform elasticPlatform telescopicBridge weightTrigger elevatorMultiStop movingCheckpoint');
  set(0.60, 'confidencePlatform memoryPlatform smartMemoryPlatform movingExit swapExit gravityFlipLine gravityZone windZone');
  set(0.40, 'key lock door switch plate colorTile symbolTile teleport');
  set(0.10, 'oneWayPlatform bridge');
  set(0.00, 'exit');
  const DEFAULT_W = 0.5;            // unknown (future) types: assume a middling threat, never ignore

  const RULE_W = { controlSwap: 1.0, mirror: 0.9, littleSight: 1.0, delay: 0.8, cameraChaos: 1.0, gravityPulse: 0.8,
    timeWarp: 0.7, windGlobal: 0.5, clock: 0.5, sound: 0.5, visualMeaning: 0.6, symbolMeaning: 0.6, oddEven: 0.6, moonOverride: 0.3 };

  // types whose body can serve as a foothold for routing
  const FOOTHOLD = /Platform$|^bridge$|^telescopicBridge$|^conveyorPlatform$/;
  const NOT_FOOTHOLD = new Set(['deathPlatform', 'invisiblePlatform', 'fakeSignPlatform']);

  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const sat = (x, half) => x <= 0 ? 0 : x / (x + half);   // 0..1 saturating

  function airReach(dy) {             // horizontal reach for a jump to a surface dy px higher (negative = lower)
    const disc = JUMP_V * JUMP_V - 2 * G * dy;
    if (disc < 0) return -1;
    return SPEED * (JUMP_V + Math.sqrt(disc)) / G;
  }

  // Shortest "effort" route from spawn to exit over the platform graph. Returns route stats + polyline.
  function analyseRoute(level, plats, exit, spawn, tele) {
    const n = plats.length;
    if (!n) return null;
    const top = p => p.y;
    const startIdx = nearestUnder(plats, spawn.x, spawn.y);
    const exitCx = exit.x + num(exit.w, 0) / 2, exitCy = exit.y + num(exit.h, 0);
    const goalIdx = nearestUnder(plats, exitCx, exitCy);
    if (startIdx < 0 || goalIdx < 0) return null;
    const edges = Array.from({ length: n }, () => []);
    const order = plats.map((_, i) => i).sort((p, q) => plats[p].x - plats[q].x);
    const MAXGAP = SPEED * (2 * JUMP_V / G) + PLAYER_W;       // nothing further apart than this is reachable
    for (let ii = 0; ii < n; ii++) for (let jj = 0; jj < n; jj++) {
      const i = order[ii], j = order[jj];
      if (i === j) continue;
      const a = plats[i], b = plats[j];
      if (b.x > a.x + a.w + MAXGAP) { if (jj > ii) break; else continue; }
      if (b.x + b.w < a.x - MAXGAP) continue;
      const dy = top(a) - top(b);                    // >0: b is higher
      if (dy > MAX_RISE * 0.96) continue;
      const gap = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
      const reach = airReach(dy) + PLAYER_W * 0.5;
      if (reach <= 0) continue;
      const r = gap / reach;
      if (r > 1) continue;
      const rise = Math.max(0, dy) / MAX_RISE;
      const narrow = 1 - sat(Math.min(a.w, b.w), 60);   // narrow landing = harder
      const cost = (gap < 4 && dy <= 4) ? 0.15 : 1 + 3.2 * r * r + 2.0 * rise * rise + 1.2 * narrow;
      edges[i].push({ j, cost, r, rise, narrow, jump: !(gap < 4 && dy <= 4) });
    }
    (tele || []).forEach(t => {
      const i = nearestUnder(plats, t.x + num(t.w, 0) / 2, t.y + num(t.h, 0)), j = nearestUnder(plats, t.targetX, t.targetY);
      if (i >= 0 && j >= 0 && i !== j) edges[i].push({ j, cost: 0.8, r: 0, rise: 0, narrow: 0, jump: false });
    });
    const dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), via = new Array(n).fill(null);
    dist[startIdx] = 0;
    const done = new Array(n).fill(false);
    for (let it = 0; it < n; it++) {
      let u = -1; for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity) break;
      done[u] = true;
      for (const e of edges[u]) if (dist[u] + e.cost < dist[e.j]) { dist[e.j] = dist[u] + e.cost; prev[e.j] = u; via[e.j] = e; }
    }
    if (dist[goalIdx] === Infinity) return { reachable: false, startIdx, goalIdx };
    const hops = []; const poly = [];
    for (let v = goalIdx; v !== startIdx && v >= 0; v = prev[v]) { hops.push(via[v]); poly.push(v); }
    poly.push(startIdx); poly.reverse();
    return { reachable: true, hops, poly: poly.map(i => plats[i]), startIdx, goalIdx };
  }
  function nearestUnder(plats, x, y) {
    let best = -1, bd = Infinity;
    plats.forEach((p, i) => {
      const dx = x < p.x ? p.x - x : x > p.x + p.w ? x - (p.x + p.w) : 0;
      const dy = y <= p.y + 8 ? p.y - y : (y - p.y) * 3;
      const d = dx * dx + dy * dy * 0.5;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }
  function distToPolyline(px, py, poly) {
    let best = Infinity;
    for (const p of poly) {
      const dx = px < p.x ? p.x - px : px > p.x + p.w ? px - (p.x + p.w) : 0;
      const dy = py - p.y;
      const d = Math.hypot(dx, dy < -300 ? dy + 300 : dy > 300 ? dy - 300 : 0 * dy + Math.min(Math.abs(dy), 300) * 0 + dy);
      if (d < best) best = d;
    }
    return best;
  }

  // typical first-time player: surprise = expected EXTRA deaths from things they cannot see coming
  const SURPRISE = {};
  const sur = (v, names) => names.split(/\s+/).filter(Boolean).forEach(n => { SURPRISE[n] = v; });
  sur(0.80, 'hiddenSpike hiddenMovingWall teleportBehindTrap');
  sur(0.60, 'fakeExit fakeVictory fakeSafeZone trollCollectible invisiblePlatform predictionSpike ambushDrone');
  sur(0.45, 'invisibleTrigger vanishOnApproach phantomMirrorPlatform quantumTile reverseTrapPlatform shadowBlock proximityTrap trapSwitch dormantSpike jumpArmedSpike coinArmedSpike mirrorEnemy');
  sur(0.30, 'fakeSpike fakeCheckpoint fakeSignPlatform chaserSpike hunterCeiling hunterLaser panicRoomZone escapeSequenceZone stillnessCollapsePlatform confidencePlatform memoryPlatform smartMemoryPlatform reverseTrapPlatform');
  sur(0.20, 'crumblePlatform countedCrumblePlatform blinkPlatform shiftOnContactPlatform floorWave clonePlatform speedReactivePlatform gravityFlipLine gravityZone');
  sur(0.12, 'key lock door switch plate colorTile symbolTile teleport movingExit swapExit');

  function features(level) {
    const platforms = (Array.isArray(level.platforms) ? level.platforms : []).filter(p => p && isFinite(p.x) && isFinite(p.y) && p.w > 0);
    const objects = (Array.isArray(level.objects) ? level.objects : []).filter(o => o && typeof o.type === 'string');
    const rules = Array.isArray(level.rules) ? level.rules : [];
    const width = num(level.width, 480), height = num(level.height, 700);
    const spawn = (level.spawnA && isFinite(level.spawnA.x) && isFinite(level.spawnA.y)) ? level.spawnA : { x: 32, y: height - 100 };
    const exits = objects.filter(o => o.type === 'exit' || o.type === 'movingExit' || o.type === 'swapExit');
    const ex0 = exits[0] || {};
    const exit = { x: num(ex0.x, width - 80), y: num(ex0.y, 100), w: num(ex0.w, 60), h: num(ex0.h, 60) };

    const MAXH = 1200;
    const holds = platforms.slice(0, MAXH).map(p => ({ x: p.x, y: p.y, w: p.w, h: num(p.h, 16) }));
    objects.forEach(o => { if (holds.length < MAXH && FOOTHOLD.test(o.type) && !NOT_FOOTHOLD.has(o.type) && o.w > 0) holds.push({ x: o.x, y: o.y, w: o.w, h: num(o.h, 16) }); });

    const tele = objects.filter(o => o.type === 'teleport' && isFinite(o.targetX) && isFinite(o.targetY));
    const route = analyseRoute(level, holds, exit, spawn, tele);
    const straight = Math.hypot((exit.x + num(exit.w, 0) / 2) - spawn.x, exit.y - spawn.y);
    const f = { routeKnown: !!(route && route.reachable), straight };

    // ---------- 1) route execution: product of per-jump success ----------
    let jumps = 0, tight = 0, rMax = 0, effort = 0, routeLen = straight, pExec = 1;
    if (route && route.reachable) {
      route.hops.forEach(h => {
        effort += h.cost;
        if (h.jump) {
          jumps++; rMax = Math.max(rMax, h.r); if (h.r > 0.72) tight++;
          const q = clamp(0.012 + 0.36 * h.r * h.r + 0.22 * h.rise * h.rise + 0.05 * h.narrow, 0, 0.6);
          pExec *= (1 - q);
        }
      });
      routeLen = 0;
      for (let i = 1; i < route.poly.length; i++) { const a = route.poly[i - 1], b = route.poly[i]; routeLen += Math.hypot((b.x + b.w / 2) - (a.x + a.w / 2), b.y - a.y); }
      routeLen = Math.max(routeLen, straight);
    } else {
      // needs doors / switches / moving parts to progress: no honest static path, estimate from distance + assume friction
      jumps = Math.round(straight / 170); effort = jumps * 1.6;
      pExec *= Math.pow(0.95, jumps) * 0.9;
    }

    // ---------- 2) hazards near the route ----------
    const poly = (route && route.reachable) ? route.poly : null;
    let pHaz = 1, surprise = 0, threat = 0, count = 0;
    const kinds = new Set(), seen = Object.create(null), surpMax = Object.create(null);
    objects.forEach(o => {
      const w = (o.type in W) ? W[o.type] : DEFAULT_W;
      if (w <= 0) return;
      count++; kinds.add(o.type);
      let prox = 0.6;
      if (poly) {
        const cx = num(o.x, 0) + num(o.w, 0) / 2, cy = num(o.y, 0) + num(o.h, 0) / 2;
        let best = Infinity;
        for (const p of poly) {
          const dx = cx < p.x ? p.x - cx : cx > p.x + p.w ? cx - (p.x + p.w) : 0;
          const d = Math.hypot(dx, Math.abs(cy - p.y) * 0.8);
          if (d < best) best = d;
        }
        prox = 0.05 + 0.95 * Math.exp(-best / 140);
      }
      // players LEARN: the 2nd, 3rd... instance of the same trap is read faster, so repeats are discounted
      const idx = seen[o.type] = (seen[o.type] || 0) + 1;
      const learn = 1 / (1 + 0.12 * (idx - 1));
      const p0 = P_SCALE * Math.pow(w, 1.6);
      pHaz *= (1 - p0 * prox * learn);
      const s0 = (o.type in SURPRISE) ? SURPRISE[o.type] : 0;
      if (s0 > 0) {
        const gain = s0 * (0.25 + 0.75 * prox) * (idx === 1 ? 1 : 0.18 / Math.sqrt(idx - 1));
        surprise += gain;
      }
      threat += w * prox;
    });

    // ---------- 3) rules (global mechanics the player must learn AND live with) ----------
    let pRules = 1, ruleLoad = 0;
    rules.forEach(r => {
      if (!r || !r.type) return;
      const rw = (r.type in RULE_W) ? RULE_W[r.type] : 0.5;
      ruleLoad += rw; pRules *= (1 - 0.10 * rw); surprise += 0.35 * rw;
    });

    // ---------- 4) pressure, length, co-op ----------
    const both = level.exitRequiresBoth !== false;
    const tl = (typeof level.timeLimit === 'number' && level.timeLimit > 0) ? level.timeLimit : null;
    const estTime = routeLen / (SPEED * 0.55) + jumps * 0.55;
    const pressure = tl ? estTime / tl : 0;
    const pTime = pressure > 0.4 ? clamp(1 - 0.55 * (pressure - 0.4) / 0.6, 0.25, 1) : 1;
    const pLen = Math.exp(-routeLen / 9000);
    const pCoop = both ? 0.94 : 1;

    const pSucc = clamp(pExec * pHaz * pRules * pTime * pLen * pCoop, 0.0005, 1);
    let attempts = 1 / pSucc + surprise;
    if (!isFinite(attempts)) attempts = 1;
    attempts = Math.min(1e4, Math.max(1, attempts));
    f.pSucc = pSucc; f.surprise = surprise; f.attempts = attempts;
    f.jumps = jumps; f.tight = tight; f.rMax = rMax; f.effort = effort; f.routeLen = routeLen;
    f.threat = threat; f.count = count; f.kinds = kinds.size; f.ruleLoad = ruleLoad; f.both = both ? 1 : 0; f.pressure = pressure;
    return f;
  }
  const P_SCALE = 0.22;
  // score 0..100 from expected attempts of a typical first-time player; 1 attempt = 0, ~80 attempts = 100
  const SCORE_TOP = Math.log(80);
  const CUTS = [9, 21, 37, 57, 78];          // bar thresholds on the 0..100 score
  const LABELS = ['TOO SIMPLE', 'SIMPLE', 'MODERATE', 'HARD', 'VERY HARD', 'ULTRA HARD'];
  function rate(level) {
    const f = features(level || {});
    const score = Math.round(clamp(Math.log(Math.max(1, f.attempts)) / SCORE_TOP, 0, 1) * 1000) / 10;
    let bars = 0; for (const c of CUTS) if (score >= c) bars++;
    return { score, bars, label: LABELS[bars], attempts: Math.round(f.attempts * 10) / 10, version: VERSION, detail: f };
  }
  return { features, rate, VERSION, CUTS, LABELS };
})();

export { LEVEL_DIFFICULTY };
export const DIFFICULTY_VERSION = LEVEL_DIFFICULTY.VERSION;

// Rate a stored COMPACT level_data blob. Returns null when it cannot be decoded (never throws).
export function rateStoredLevel(levelData) {
  try {
    const gameplay = COMMUNITY_CODEC.decodeGameplay(levelData);
    const r = LEVEL_DIFFICULTY.rate(gameplay);
    if (!Number.isFinite(r.score)) return null;
    return { score: r.score, bars: r.bars, version: r.version };
  } catch (e) {
    return null;
  }
                          }
      
