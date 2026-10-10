// /api/_lib/communityCodec.js
// GENERATED COPY of COMMUNITY_CODEC from the game file (it is a pure module by design, so the server
// decodes level data with exactly the code the client encoded it with). Do not edit by hand.
const COMMUNITY_CODEC = (() => {
  'use strict';

  const FORMAT_VERSION = 1;
  const STORAGE_VERSION = 2;
  const PACKAGE_SCHEMA_VERSION = 1;

  // Hard safety caps for DECODING untrusted data (not gameplay limits — the
  // validator enforces those). They only stop pathological payloads.
  const HARD = { objects: 5000, platforms: 5000, rules: 64, depth: 8, coord: 1e7, str: 4000 };

  class CodecError extends Error {
    constructor(code, msg) { super(msg || code); this.name = 'CodecError'; this.code = code; }
  }

  /* ---------------- frozen v1 dictionaries (append-only) ---------------- */
  // Object types = every type the engine registers (registerObjectType), alphabetical at v1.
  const TYPES_V1 = [
    "ambushDrone", "blinkPlatform", "bridge", "ceilingSpike", "chaserSpike", "clonePlatform", "cloudDriftPlatform",
    "coinArmedSpike", "colorTile", "confidencePlatform", "conveyorPlatform", "countedCrumblePlatform", "crumblePlatform",
    "crusher", "dangerousDecoration", "deathPlatform", "delayedAppearPlatform", "delayedPlatform", "door",
    "dormantSpike", "earthquakeZone", "elasticPlatform", "elevatorMultiStop", "escapeSequenceZone", "exit",
    "explodingBarrel", "fakeCheckpoint", "fakeExit", "fakeSafeZone", "fakeSignPlatform", "fakeSpike", "fakeVictory",
    "fallingRock", "fireJet", "floodRoomWater", "floorWave", "gravityFlipLine", "gravityZone", "growShrinkPlatform",
    "hiddenMovingWall", "hiddenSpike", "hingedSwingPlatform", "hunterCeiling", "hunterLaser", "icePlatform",
    "invisiblePlatform", "invisibleTrigger", "jumpArmedSpike", "key", "laserGate", "lock", "magneticPlatform",
    "memoryPlatform", "mirrorEnemy", "movingCheckpoint", "movingExit", "movingWall", "oneWayPlatform", "orbitPlatform",
    "panicRoomZone", "phantomMirrorPlatform", "pistonPlatform", "pistonWall", "plate", "predictionSpike",
    "proximityTrap", "quantumTile", "reverseTrapPlatform", "risingHazard", "rollingBoulder", "rollingPress",
    "rotatingPlatform", "sawBlade", "scissorWall", "shadowBlock", "shiftOnContactPlatform", "smartMemoryPlatform",
    "speedReactivePlatform", "spike", "spikeWheel", "stickyPlatform", "stillnessCollapsePlatform", "swapExit",
    "swingingPendulum", "switch", "symbolTile", "teleport", "teleportBehindTrap", "telescopicBridge", "trapSwitch",
    "trollCollectible", "vanishOnApproach", "wallSpike", "weatherHazard", "weightTrigger", "windZone",
  ];
  // Positional params per type. Only the order matters; NEVER reorder or remove within v1.
  const OBJ_FIELDS_V1 = {
    ambushDrone: ['wakeDist', 'chargeSpeed'],
    blinkPlatform: ['onDuration', 'offDuration'],
    cloudDriftPlatform: ['driftVX'],
    colorTile: ['color'],
    confidencePlatform: ['seq'],
    conveyorPlatform: ['baseSpeed', 'reversesEvery'],
    countedCrumblePlatform: ['surviveCount'],
    crumblePlatform: ['crumbleDelay', 'skin'],
    crusher: ['period', 'downFraction'],
    dangerousDecoration: ['emoji'],
    deathPlatform: ['killMessage'],
    delayedAppearPlatform: ['appearAfter', 'disappearAfter'],
    delayedPlatform: ['delay', 'launchForce'],
    door: ['linkIds'],
    earthquakeZone: ['rockInterval'],
    escapeSequenceZone: ['keyId', 'collapseSpeed'],
    fakeSignPlatform: ['trapIsTrue', 'label', 'crumbleDelay'],
    floodRoomWater: ['riseSpeed', 'riseDist', 'grace'],
    floorWave: ['amplitude', 'waveSpeed', 'phaseOffset'],
    growShrinkPlatform: ['period', 'minScale'],
    hiddenMovingWall: ['baseX', 'baseY', 'axis', 'range', 'speed', 'triggerDist'],
    hingedSwingPlatform: ['swingSpeed', 'swingAmp'],
    hunterCeiling: ['zoneWidth', 'dropDist', 'dropSpeed', 'retractSpeed'],
    hunterLaser: ['turnSpeed', 'beamLength', 'beamWidth'],
    invisibleTrigger: ['effect'],
    key: ['keyId'],
    lock: ['keyId'],
    magneticPlatform: ['pull'],
    mirrorEnemy: ['tracks', 'mirrorDelay'],
    movingCheckpoint: ['axis', 'range', 'speed'],
    movingExit: ['moveAxis', 'moveRange', 'moveSpeed', 'repeatMove'],
    movingWall: ['baseX', 'baseY', 'axis', 'range', 'speed'],
    orbitPlatform: ['orbitSpeed', 'orbitRadius'],
    panicRoomZone: ['closeTime'],
    phantomMirrorPlatform: ['tracks', 'delaySeconds', 'driftRange'],
    pistonWall: ['detectRange', 'travel', 'speed', 'retractSpeed', 'dir'],
    plate: ['linkIds', 'latch'],
    predictionSpike: ['predictRange', 'riseSpeed'],
    proximityTrap: ['mode', 'threshold', 'killMessage'],
    quantumTile: ['dangerChance'],
    reverseTrapPlatform: ['armsId'],
    risingHazard: ['riseSpeed'],
    rollingPress: ['speed', 'dir'],
    rotatingPlatform: ['rotSpeed'],
    scissorWall: ['dir', 'travel', 'closeTime', 'holdTime', 'openTime'],
    shiftOnContactPlatform: ['shiftX', 'shiftY', 'shiftDuration'],
    stillnessCollapsePlatform: ['mode'],
    swapExit: ['swapInterval', 'swapParity'],
    switch: ['linkIds'],
    symbolTile: ['symbol'],
    teleport: ['pairId', 'targetX', 'targetY'],
    teleportBehindTrap: ['behindDist'],
    trapSwitch: ['linkIds', 'armsId'],
    trollCollectible: ['kind', 'disguise', 'disguiseOn'],
    weightTrigger: ['standTime'],
  };
  const ENUMS_V1 = {
    'symbolTile.symbol': ['star', 'triangle', 'square', 'circle', 'moon', 'diamond'],
    'colorTile.color': ['red', 'green', 'purple', 'amber'],
    'movingWall.axis': ['x', 'y'], 'hiddenMovingWall.axis': ['x', 'y'], 'movingCheckpoint.axis': ['x', 'y'],
    'movingExit.moveAxis': ['x', 'y'],
    'trollCollectible.disguise': ['coin', 'key', 'switch'],
    'invisibleTrigger.effect': ['kill', 'alarm', 'toast'],
    'proximityTrap.mode': ['close', 'far'],
    'phantomMirrorPlatform.tracks': ['A', 'B'], 'mirrorEnemy.tracks': ['A', 'B'],
  };
  const BOOLS_V1 = ['fakeSignPlatform.trapIsTrue', 'trollCollectible.disguiseOn', 'movingExit.repeatMove', 'plate.latch'];
  // Fields that point at ANOTHER OBJECT'S id (verified against every `.id ===` lookup in the engine).
  const REF_FIELDS_V1 = { linkIds: 'list', pairId: 'one', armsId: 'one', revealSwitchId: 'one' };
  // Rules (the 14 engine rule types). Params positional, same conventions as objects.
  const RULE_TYPES_V1 = ['visualMeaning', 'symbolMeaning', 'clock', 'sound', 'oddEven', 'controlSwap', 'littleSight',
    'mirror', 'delay', 'moonOverride', 'gravityPulse', 'cameraChaos', 'windGlobal', 'timeWarp'];
  const RULE_FIELDS_V1 = {
    visualMeaning: ['colors'], symbolMeaning: ['symbols'], clock: ['period', 'greenFraction'],
    sound: ['period', 'bellPeriod', 'bellDuration'], oddEven: ['oddSymbols', 'evenSymbols', 'oddColors', 'evenColors'],
    controlSwap: ['everySeconds', 'swapDuration', 'period'], littleSight: ['tier'], mirror: [], delay: ['seconds'],
    moonOverride: ['cancelsDangerFloorWide'], gravityPulse: ['period', 'flipFraction'],
    cameraChaos: ['period', 'flips', 'flipFraction', 'shakesEverySeconds', 'shakeMag', 'shakeDur'],
    windGlobal: ['period', 'gustFraction', 'strength', 'direction'],
    timeWarp: ['period', 'slowMultiplier', 'fastMultiplier', 'fastFraction'],
  };

  const TYPE_INDEX = Object.create(null);
  TYPES_V1.forEach((t, i) => { TYPE_INDEX[t] = i; });
  const RULE_INDEX = Object.create(null);
  RULE_TYPES_V1.forEach((t, i) => { RULE_INDEX[t] = i; });
  const BOOL_SET = new Set(BOOLS_V1);
  const NO_FIELDS = Object.freeze([]);
  const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const OBJ_RESERVED = new Set(['id', 'type', 'x', 'y', 'w', 'h']);
  const TOP_KNOWN = new Set(['width', 'height', 'timeLimit', 'exitRequiresBoth', 'spawnA', 'spawnB', 'platforms', 'objects', 'rules']);

  /* ---------------- helpers ---------------- */
  const isNum = n => typeof n === 'number' && Number.isFinite(n);
  // realm-independent "plain object" test (an iframe / vm object is still plain; class instances are not)
  const isPlain = o => {
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
    const p = Object.getPrototypeOf(o);
    return p === null || Object.getPrototypeOf(p) === null;
  };
  const isInt = n => Number.isInteger(n);
  function kindOf(type, field) {
    if (REF_FIELDS_V1[field]) return 'ref';
    const k = type + '.' + field;
    if (ENUMS_V1[k]) return 'enum';
    if (BOOL_SET.has(k)) return 'bool';
    return 'raw';
  }
  function checkKey(k, path) { if (FORBIDDEN_KEYS.has(k)) throw new CodecError('bad-key', 'forbidden key "' + k + '" at ' + path); }

  // Deep-clones a JSON value, rejecting anything JSON.stringify would silently corrupt
  // (NaN/Infinity/undefined-in-array/functions/forbidden keys). undefined-valued object keys are dropped.
  function cleanJson(v, path, depth) {
    depth = depth || 0;
    if (depth > HARD.depth) throw new CodecError('too-deep', 'nesting too deep at ' + path);
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new CodecError('nonfinite', 'non-finite number at ' + path); return v; }
    if (typeof v === 'string') { if (v.length > HARD.str) throw new CodecError('too-long', 'string too long at ' + path); return v; }
    if (Array.isArray(v)) return v.map((e, i) => {
      if (e === undefined) throw new CodecError('bad-value', 'undefined in array at ' + path + '[' + i + ']');
      return cleanJson(e, path + '[' + i + ']', depth + 1);
    });
    if (isPlain(v)) {
      const out = {};
      for (const k of Object.keys(v)) {
        checkKey(k, path);
        if (v[k] === undefined) continue;
        out[k] = cleanJson(v[k], path + '.' + k, depth + 1);
      }
      return out;
    }
    throw new CodecError('bad-value', 'unsupported value at ' + path);
  }
  const cloneJson = v => (v !== null && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  function needNum(v, path) { if (!isNum(v)) throw new CodecError('nonfinite', 'expected a finite number at ' + path); return v; }
  function needCoord(v, path) {
    needNum(v, path);
    if (Math.abs(v) > HARD.coord) throw new CodecError('range', 'number out of range at ' + path);
    return v;
  }
  function utf8Bytes(str) {
    let n = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c < 0x80) n += 1; else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } else n += 3;
    }
    return n;
  }
  function stableStringify(v) {
    if (v === undefined) return 'undefined';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }

  /* ---------------- references ---------------- */
  function encodeRefValue(field, v, refIndex, path) {
    const one = s => { const i = refIndex.get(s); return i === undefined ? s : i; };
    if (REF_FIELDS_V1[field] === 'list') {
      if (!Array.isArray(v) || !v.every(e => typeof e === 'string')) throw new CodecError('bad-ref', 'reference list must be strings at ' + path);
      return v.map(one);
    }
    if (typeof v !== 'string') throw new CodecError('bad-ref', 'reference must be a string at ' + path);
    return one(v);
  }
  function decodeRefValue(field, v, ids, path) {
    const one = e => {
      if (typeof e === 'string') return e;
      if (isInt(e) && e >= 0 && e < ids.length) return ids[e];
      throw new CodecError('bad-ref', 'broken object reference at ' + path);
    };
    if (REF_FIELDS_V1[field] === 'list') {
      if (!Array.isArray(v)) throw new CodecError('bad-ref', 'reference list expected at ' + path);
      return v.map(one);
    }
    return one(v);
  }

  /* ---------------- objects ---------------- */
  function encodeObject(o, refIndex, path) {
    if (!isPlain(o)) throw new CodecError('shape', 'object must be a plain object at ' + path);
    const type = o.type;
    const T = (typeof type === 'string') ? TYPE_INDEX[type] : undefined;
    if (T === undefined) throw new CodecError('unknown-type', 'unknown object type ' + JSON.stringify(type) + ' at ' + path);
    const fields = OBJ_FIELDS_V1[type] || NO_FIELDS;
    let overflow = null;
    const over = (k, v) => { (overflow || (overflow = {}))[k] = v; };
    const tuple = [T, needCoord(o.x, path + '.x'), needCoord(o.y, path + '.y'), null, null];
    for (const k of ['w', 'h']) {
      const v = o[k], slot = k === 'w' ? 3 : 4;
      if (v === undefined) continue;
      if (v === null) { over(k, null); continue; }
      tuple[slot] = needCoord(v, path + '.' + k);
    }
    const inFields = new Set(fields);
    fields.forEach((f, j) => {
      const v = o[f];
      if (v === undefined) { tuple.push(null); return; }
      if (v === null) { tuple.push(null); over(f, null); return; }
      const kind = kindOf(type, f);
      if (kind === 'ref') { tuple.push(encodeRefValue(f, v, refIndex, path + '.' + f)); return; }
      if (kind === 'enum') {
        const ix = ENUMS_V1[type + '.' + f].indexOf(v);
        if (ix >= 0) { tuple.push(ix); return; }
        tuple.push(null); over(f, cleanJson(v, path + '.' + f)); return;
      }
      if (kind === 'bool') {
        if (v === true) { tuple.push(1); return; }
        if (v === false) { tuple.push(0); return; }
        tuple.push(null); over(f, cleanJson(v, path + '.' + f)); return;
      }
      tuple.push(cleanJson(v, path + '.' + f));
    });
    for (const k of Object.keys(o)) {
      if (OBJ_RESERVED.has(k) || inFields.has(k) || k.charAt(0) === '_' || o[k] === undefined) continue;
      checkKey(k, path);
      if (o[k] === null) { over(k, null); continue; }
      over(k, REF_FIELDS_V1[k] ? encodeRefValue(k, o[k], refIndex, path + '.' + k) : cleanJson(o[k], path + '.' + k));
    }
    if (overflow) tuple.push(overflow);
    else while (tuple.length > 3 && tuple[tuple.length - 1] === null) tuple.pop();
    return tuple;
  }

  function decodeObject(t, i, ids, path) {
    if (!Array.isArray(t) || t.length < 3) throw new CodecError('shape', 'object tuple expected at ' + path);
    const T = t[0];
    if (!isInt(T) || T < 0 || T >= TYPES_V1.length) throw new CodecError('unknown-type', 'unknown object type code ' + JSON.stringify(T) + ' at ' + path);
    const type = TYPES_V1[T];
    const fields = OBJ_FIELDS_V1[type] || NO_FIELDS;
    if (t.length > 5 + fields.length + 1) throw new CodecError('shape', 'object tuple too long at ' + path);
    const o = { id: ids[i], type, x: needCoord(t[1], path + '.x'), y: needCoord(t[2], path + '.y') };
    if (t[3] != null) o.w = needCoord(t[3], path + '.w');
    if (t[4] != null) o.h = needCoord(t[4], path + '.h');
    fields.forEach((f, j) => {
      const v = t[5 + j];
      if (v === null || v === undefined) return;
      const kind = kindOf(type, f), p = path + '.' + f;
      if (kind === 'ref') o[f] = decodeRefValue(f, v, ids, p);
      else if (kind === 'enum') {
        const list = ENUMS_V1[type + '.' + f];
        if (!isInt(v) || v < 0 || v >= list.length) throw new CodecError('bad-enum', 'bad enum value at ' + p);
        o[f] = list[v];
      } else if (kind === 'bool') {
        if (v !== 0 && v !== 1) throw new CodecError('bad-bool', 'bad boolean at ' + p);
        o[f] = v === 1;
      } else o[f] = cleanJson(v, p);
    });
    const ov = t[5 + fields.length];
    if (ov !== undefined) {
      if (!isPlain(ov)) throw new CodecError('shape', 'overflow must be an object at ' + path);
      for (const k of Object.keys(ov)) {
        checkKey(k, path);
        if (OBJ_RESERVED.has(k) && k !== 'w' && k !== 'h') throw new CodecError('bad-key', 'reserved key "' + k + '" in overflow at ' + path);
        o[k] = (ov[k] !== null && REF_FIELDS_V1[k]) ? decodeRefValue(k, ov[k], ids, path + '.' + k) : cleanJson(ov[k], path + '.' + k);
      }
    }
    return o;
  }

  /* ---------------- rules ---------------- */
  function encodeRule(r, path) {
    if (!isPlain(r)) throw new CodecError('shape', 'rule must be a plain object at ' + path);
    const R = (typeof r.type === 'string') ? RULE_INDEX[r.type] : undefined;
    if (R === undefined) throw new CodecError('unknown-rule', 'unknown rule type ' + JSON.stringify(r.type) + ' at ' + path);
    const fields = RULE_FIELDS_V1[r.type];
    const tuple = [R];
    let overflow = null;
    const over = (k, v) => { (overflow || (overflow = {}))[k] = v; };
    fields.forEach(f => {
      const v = r[f];
      if (v === undefined) { tuple.push(null); return; }
      if (v === null) { tuple.push(null); over(f, null); return; }
      tuple.push(cleanJson(v, path + '.' + f));
    });
    for (const k of Object.keys(r)) {
      if (k === 'type' || fields.includes(k) || k.charAt(0) === '_' || r[k] === undefined) continue;
      checkKey(k, path);
      over(k, cleanJson(r[k], path + '.' + k));
    }
    if (overflow) tuple.push(overflow);
    else while (tuple.length > 1 && tuple[tuple.length - 1] === null) tuple.pop();
    return tuple;
  }
  function decodeRule(t, path) {
    if (!Array.isArray(t) || t.length < 1) throw new CodecError('shape', 'rule tuple expected at ' + path);
    const R = t[0];
    if (!isInt(R) || R < 0 || R >= RULE_TYPES_V1.length) throw new CodecError('unknown-rule', 'unknown rule code ' + JSON.stringify(R) + ' at ' + path);
    const type = RULE_TYPES_V1[R], fields = RULE_FIELDS_V1[type];
    if (t.length > 1 + fields.length + 1) throw new CodecError('shape', 'rule tuple too long at ' + path);
    const r = { type };
    fields.forEach((f, j) => { const v = t[1 + j]; if (v !== null && v !== undefined) r[f] = cleanJson(v, path + '.' + f); });
    const ov = t[1 + fields.length];
    if (ov !== undefined) {
      if (!isPlain(ov)) throw new CodecError('shape', 'overflow must be an object at ' + path);
      for (const k of Object.keys(ov)) {
        checkKey(k, path);
        if (k === 'type') throw new CodecError('bad-key', 'reserved key in overflow at ' + path);
        r[k] = cleanJson(ov[k], path + '.' + k);
      }
    }
    return r;
  }

  /* ---------------- gameplay ---------------- */
  function encodeGameplay(gp) {
    if (!isPlain(gp)) throw new CodecError('shape', 'gameplay must be an object');
    const w = needCoord(gp.width, 'width'), h = needCoord(gp.height, 'height');
    if (w <= 0 || h <= 0) throw new CodecError('range', 'width/height must be positive');
    const c = { v: FORMAT_VERSION, d: [w, h] };
    if (gp.timeLimit !== undefined && gp.timeLimit !== null) {
      if (!isNum(gp.timeLimit) || gp.timeLimit < 0) throw new CodecError('shape', 'timeLimit must be a non-negative number or null');
      c.t = gp.timeLimit;
    }
    if (gp.exitRequiresBoth === false) c.b = 0;
    else if (gp.exitRequiresBoth !== undefined && gp.exitRequiresBoth !== true) throw new CodecError('shape', 'exitRequiresBoth must be a boolean');
    for (const k of ['spawnA', 'spawnB']) {
      const s = gp[k];
      if (!isPlain(s)) throw new CodecError('shape', k + ' missing');
      const extra = Object.keys(s).filter(z => z !== 'x' && z !== 'y' && s[z] !== undefined);
      if (extra.length) throw new CodecError('shape', k + ' has unsupported fields: ' + extra.join(','));
    }
    c.s = [needCoord(gp.spawnA.x, 'spawnA.x'), needCoord(gp.spawnA.y, 'spawnA.y'), needCoord(gp.spawnB.x, 'spawnB.x'), needCoord(gp.spawnB.y, 'spawnB.y')];

    const plats = gp.platforms === undefined ? [] : gp.platforms;
    if (!Array.isArray(plats)) throw new CodecError('shape', 'platforms must be an array');
    if (plats.length) {
      c.p = plats.map((p, i) => {
        const path = 'platforms[' + i + ']';
        if (!isPlain(p)) throw new CodecError('shape', 'platform must be an object at ' + path);
        const t = [needCoord(p.x, path + '.x'), needCoord(p.y, path + '.y'), needCoord(p.w, path + '.w'), needCoord(p.h, path + '.h')];
        const ex = {};
        let any = fa
