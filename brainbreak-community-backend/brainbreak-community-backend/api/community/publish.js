// /api/community/publish.js
//
// POST /api/community/publish
// Body: { schemaVersion, gameplayFormat, level: { id, name, description, gameplay }, requestedVersionNumber, remoteId }
// (exact shape sent by COMMUNITY_PUBLISH.buildPayload() in brainbreak.html)
//
// `level.id` is the CLIENT's local draft key — irrelevant to the database,
// which always assigns its own permanent uuid (see community_world.sql's
// comment on public.levels.id). `remoteId` is that server-assigned id,
// once the client has learned it from a previous successful publish; null
// means "this device has never successfully published this level before".
//
// Two paths:
//   remoteId absent  -> INSERT a new levels row (creator_id forced from the
//                        authenticated session, never from the body),
//                        which seeds version 1 automatically (base schema
//                        trigger), then publish_level().
//   remoteId present -> verify ownership, update title/description
//                        directly (RLS-permitted), push the new gameplay
//                        through create_level_version() (so history/
//                        current_version_id stay correct), then
//                        publish_level() again (idempotent).
//
// `requestedVersionNumber` from the client is never trusted as the real
// version number — it's only ever informational; the response's
// publishedVersion always comes from what the database actually assigned.

import { requireUser, friendlyError, handleCors } from '../_lib/supabaseClients.js';
import { syncAchievementsFor } from '../_lib/syncAchievements.js';

// Storage diet: these match the game's own input limits (name 40, description 200), so nothing a real player
// types is ever cut - they only stop a modified client from storing multi-KB text per level.
const MAX_TITLE = 40;
const MAX_DESCRIPTION = 200;

// Canonical JSON (keys sorted) so the stored jsonb and the incoming payload compare equal regardless of key order.
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { supabase, userId } = auth;

  const { level, remoteId } = req.body || {};
  if (!level || typeof level !== 'object') {
    return res.status(400).json({ error: 'level is required' });
  }

  const title = String(level.name || '').trim().slice(0, MAX_TITLE);
  if (!title) return res.status(400).json({ error: 'Give your level a name first.' });

  const description = level.description != null ? String(level.description).slice(0, MAX_DESCRIPTION) : null;

  const gameplay = level.gameplay;
  if (!gameplay || typeof gameplay !== 'object' || gameplay.v !== 1) {
    // Defense in depth — the database's own CHECK constraint
    // (is_valid_level_data) is the real authority here and will reject
    // anything that gets past this too.
    return res.status(400).json({ error: 'This level could not be prepared for publishing.' });
  }

  try {
    let levelId = remoteId || null;
    let publishedVersion;

    if (!levelId) {
      // ---- brand new level -------------------------------------------
      const { data: inserted, error: insertErr } = await supabase
        .from('levels')
        .insert({ creator_id: userId, title, description, level_data: gameplay })
        .select('id')
        .single();
      if (insertErr) throw insertErr;
      levelId = inserted.id;
      publishedVersion = 1; // levels_after_insert_seed_version trigger always seeds version 1
    } else {
      // ---- republishing an already-known level -------------------------
      const { data: existing, error: fetchErr } = await supabase
        .from('levels')
        .select('id, creator_id, level_data')
        .eq('id', levelId)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) {
        return res.status(404).json({ error: "That level couldn't be found on the server anymore — try publishing it as new." });
      }
      if (existing.creator_id !== userId) {
        return res.status(403).json({ error: "You don't own this level." });
      }

      const { error: updErr } = await supabase.from('levels').update({ title, description }).eq('id', levelId);
      if (updErr) throw updErr;

      // Storage diet: re-publishing an UNCHANGED level (only the title/description changed, or the player just tapped
      // publish again) must not store another full copy of the level. Identical data -> keep the current version.
      // Any problem in this shortcut falls back to the normal path below, so a publish can never fail because of it.
      let unchanged = false;
      try {
        unchanged = canon(existing.level_data) === canon(gameplay);
        if (unchanged) {
          const { data: latest, error: latestErr } = await supabase
            .from('level_versions').select('version_number').eq('level_id', levelId)
            .order('version_number', { ascending: false }).limit(1).maybeSingle();
          if (!latestErr && latest && Number.isFinite(Number(latest.version_number))) publishedVersion = Number(latest.version_number);
          else unchanged = false;
        }
      } catch (e) { unchanged = false; }

      if (!unchanged) {
        const { data: version, error: verErr } = await supabase.rpc('create_level_version', {
          p_level_id: levelId,
          p_level_data: gameplay,
        });
        if (verErr) throw verErr;
        publishedVersion = version.version_number;

        // Keep only the newest 3 versions of this level (needs sql/12 PART 1; silently does nothing if it is not installed).
        try {
          const { serviceClient } = await import('../_lib/supabaseClients.js');
          await serviceClient().rpc('prune_level_versions', { p_keep: 3, p_level_id: levelId });
        } catch (e) { /* housekeeping only */ }
      }
    }

    const { data: published, error: pubErr } = await supabase.rpc('publish_level', { p_level_id: levelId });
    if (pubErr) throw pubErr;

    // Difficulty is computed HERE from the stored level data - never taken from the client - so a rating can't be faked.
    // Never allowed to fail a publish: an unrated level is simply rated on its next Discover view (self-healing).
    let difficulty = null;
    try {
      // Loaded lazily: a missing/broken rating file must never be able to block publishing.
      const { serviceClient } = await import('../_lib/supabaseClients.js');
      const { rateStoredLevel } = await import('../_lib/levelDifficulty.js');
      const rated = rateStoredLevel(gameplay);
      if (rated) {
        const { error: rateErr } = await serviceClient().rpc('set_level_difficulty', {
          p_level_id: levelId, p_score: rated.score, p_bars: rated.bars, p_version: rated.version,
        });
        if (!rateErr) difficulty = { score: rated.score, bars: rated.bars };
        else console.error('set_level_difficulty failed', rateErr);
      }
    } catch (e) {
      console.error('difficulty rating failed', e);
    }

    await syncAchievementsFor(userId);

    return res.status(200).json({
      id: levelId,
      difficulty,
      publishedVersion,
      publishedAt: published.published_at,
    });
  } catch (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }
                                                                         }
    
