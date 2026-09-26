// /api/_lib/controllers/publish.js
//
// POST /api/community/publish
// Body: { schemaVersion, gameplayFormat, level: { id, name, description, gameplay }, requestedVersionNumber, remoteId }
// (exact shape sent by COMMUNITY_PUBLISH.buildPayload() in brainbreak.html)
//
// Logic moved verbatim from the original single-purpose file
// api/community/publish.js (deleted; its URL now routes here via
// api/community/[...path].js). No behavior change.
//
// `level.id` is the CLIENT's local draft key — irrelevant to the database,
// which always assigns its own permanent uuid. `remoteId` is that
// server-assigned id, once the client has learned it from a previous
// successful publish; null means "this device has never successfully
// published this level before".
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

import { requireUser, friendlyError } from '../supabaseClients.js';
import { syncAchievementsFor } from '../syncAchievements.js';

const MAX_TITLE = 100;
const MAX_DESCRIPTION = 2000;

export async function postPublish(req, res) {
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
        .select('id, creator_id')
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

      const { data: version, error: verErr } = await supabase.rpc('create_level_version', {
        p_level_id: levelId,
        p_level_data: gameplay,
      });
      if (verErr) throw verErr;
      publishedVersion = version.version_number;
    }

    const { data: published, error: pubErr } = await supabase.rpc('publish_level', { p_level_id: levelId });
    if (pubErr) throw pubErr;

    await syncAchievementsFor(userId);

    return res.status(200).json({
      id: levelId,
      publishedVersion,
      publishedAt: published.published_at,
    });
  } catch (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }
}
