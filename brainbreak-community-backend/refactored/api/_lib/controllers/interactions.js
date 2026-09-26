// /api/_lib/controllers/interactions.js
//
// POST /api/community/interactions/like     { levelId, action: 'like' | 'unlike' }
// POST /api/community/interactions/favorite { levelId, action: 'favorite' | 'unfavorite' }
// POST /api/community/interactions/play     { levelId }
//
// Logic moved verbatim from the original single-purpose files under
// api/community/interactions/ (all deleted; their URLs now route here via
// api/community/[...path].js). No behavior change: same RPCs (which own
// the actual anti-duplicate guarantees via DB primary keys), same
// validation, same response shapes.

import { clientFor, requireUser, friendlyError } from '../supabaseClients.js';
import { syncAchievementsFor } from '../syncAchievements.js';

// Wraps like_level()/unlike_level(). Those RPCs insert/delete on
// level_likes, whose PRIMARY KEY (level_id, user_id) is what actually
// prevents duplicate likes.
export async function postLike(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const { levelId, action } = req.body || {};
  if (!levelId || !['like', 'unlike'].includes(action)) {
    return res.status(400).json({ error: 'levelId and a valid action are required' });
  }

  const fn = action === 'like' ? 'like_level' : 'unlike_level';
  const { error } = await supabase.rpc(fn, { p_level_id: levelId });
  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }

  // Best-effort: find the level's creator so a newly-earned badge (e.g.
  // "Like Magnet") shows up right away. Not fatal if this lookup fails.
  const { data: level } = await supabase.from('levels').select('creator_id').eq('id', levelId).single();
  if (level) await syncAchievementsFor(level.creator_id);

  return res.status(200).json({ ok: true, action });
}

// Same shape and same anti-duplicate guarantee as postLike, backed by
// favorite_level()/unfavorite_level() and the level_favorites PRIMARY KEY.
export async function postFavorite(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const { levelId, action } = req.body || {};
  if (!levelId || !['favorite', 'unfavorite'].includes(action)) {
    return res.status(400).json({ error: 'levelId and a valid action are required' });
  }

  const fn = action === 'favorite' ? 'favorite_level' : 'unfavorite_level';
  const { error } = await supabase.rpc(fn, { p_level_id: levelId });
  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }

  const { data: level } = await supabase.from('levels').select('creator_id').eq('id', levelId).single();
  if (level) await syncAchievementsFor(level.creator_id);

  return res.status(200).json({ ok: true, action });
}

// Wraps register_level_play(), which only accepts plays on
// status='published' levels and updates play_count plus the daily
// aggregate — never a value the client can set directly. Works
// anonymously too (register_level_play has no auth.uid() check).
export async function postPlay(req, res) {
  const { levelId } = req.body || {};
  if (!levelId) return res.status(400).json({ error: 'levelId is required' });

  const supabase = clientFor(req);
  const { data: level, error: lookupError } = await supabase
    .from('levels').select('creator_id').eq('id', levelId).single();

  if (lookupError || !level) return res.status(404).json({ error: 'This level is no longer available.' });

  const { error } = await supabase.rpc('register_level_play', { p_level_id: levelId });
  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }

  await syncAchievementsFor(level.creator_id);
  return res.status(200).json({ ok: true });
}
