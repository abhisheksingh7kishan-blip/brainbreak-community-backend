// /src/controllers/interactions.js
//
// Business logic for every /api/community/interactions/* route. Moved
// here, unchanged in behavior, from the original one-file-per-route
// handlers so a single Vercel Serverless Function
// (api/community/interactions/[...path].js) can dispatch to all of them.

import { requireUser, clientFor, friendlyError } from '../../api/_lib/supabaseClients.js';
import { syncAchievementsFor } from '../../api/_lib/syncAchievements.js';

// POST /api/community/interactions/like  { levelId, action: 'like' | 'unlike' }
// (originally api/community/interactions/like.js)
export async function like(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

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

// POST /api/community/interactions/favorite  { levelId, action: 'favorite' | 'unfavorite' }
// (originally api/community/interactions/favorite.js)
export async function favorite(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

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

// POST /api/community/interactions/play  { levelId }
// (originally api/community/interactions/play.js)
export async function play(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { levelId } = req.body || {};
  if (!levelId) return res.status(400).json({ error: 'levelId is required' });

  // Forwards the caller's token if present, but works fine anonymously too
  // (register_level_play has no auth.uid() check) — plays count regardless
  // of whether the player is signed in.
  const supabase = clientFor(req);
  const { data: level, error: lookupError } = await supabase
    .from('levels').select('creator_id, status').eq('id', levelId).single();

  if (lookupError || !level) return res.status(404).json({ error: 'This level is no longer available.' });

  const { error } = await supabase.rpc('register_level_play', { p_level_id: levelId });
  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }

  await syncAchievementsFor(level.creator_id);
  return res.status(200).json({ ok: true });
}
