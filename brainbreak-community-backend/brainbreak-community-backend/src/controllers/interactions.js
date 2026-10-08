// /src/controllers/interactions.js
//
// Business logic for every /api/community/interactions/* route. Moved
// here, unchanged in behavior, from the original one-file-per-route
// handlers so a single Vercel Serverless Function
// (api/community/interactions/[...path].js) can dispatch to all of them.

import { requireUser, clientFor, friendlyError } from '../../api/_lib/supabaseClients.js';
import { syncAchievementsFor } from '../../api/_lib/syncAchievements.js';

// Shared by like + favorite. Reads the level's CURRENT totals through get_level_public() (SECURITY
// DEFINER, public-safe) so the game can show the real numbers the instant a tap succeeds.
async function currentTotals(supabase, levelId) {
  try {
    const { data } = await supabase.rpc('get_level_public', { p_level_id: levelId });
    if (data && data.stats) return { likes: Number(data.stats.likes) || 0, favorites: Number(data.stats.favorites) || 0, creatorId: data.creator && data.creator.id };
  } catch (e) { /* totals are a bonus - never fail a successful like because of this */ }
  return null;
}

// A duplicate-key error on LIKE/FAVORITE just means "this player already did that" - the end state the
// player asked for is already true, so it is a success, not a failure (and never a double count).
function isAlreadyDone(error) {
  const msg = (error && error.message) || '';
  return (error && error.code === '23505') || /duplicate key|already/i.test(msg);
}

// POST /api/community/interactions/like  { levelId, action: 'like' | 'unlike' }
//   (the game may also send { levelId, active: true|false } - both forms are accepted)
// Responds { ok, action, active, likes, favorites } with the level's real, current totals.
export async function like(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const body = req.body || {};
  const levelId = body.levelId;
  let action = body.action;
  if (!action && typeof body.active === 'boolean') action = body.active ? 'like' : 'unlike';
  if (!levelId || !['like', 'unlike'].includes(action)) {
    return res.status(400).json({ error: 'levelId and a valid action are required' });
  }

  const fn = action === 'like' ? 'like_level' : 'unlike_level';
  const { error } = await supabase.rpc(fn, { p_level_id: levelId });
  if (error && !isAlreadyDone(error)) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }

  const totals = await currentTotals(supabase, levelId);
  if (totals && totals.creatorId) await syncAchievementsFor(totals.creatorId);

  return res.status(200).json({
    ok: true, action, active: action === 'like',
    likes: totals ? totals.likes : undefined,
    favorites: totals ? totals.favorites : undefined,
  });
}

// POST /api/community/interactions/favorite  { levelId, action: 'favorite' | 'unfavorite' }
//   (or { levelId, active: true|false })
export async function favorite(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const body = req.body || {};
  const levelId = body.levelId;
  let action = body.action;
  if (!action && typeof body.active === 'boolean') action = body.active ? 'favorite' : 'unfavorite';
  if (!levelId || !['favorite', 'unfavorite'].includes(action)) {
    return res.status(400).json({ error: 'levelId and a valid action are required' });
  }

  const fn = action === 'favorite' ? 'favorite_level' : 'unfavorite_level';
  const { error } = await supabase.rpc(fn, { p_level_id: levelId });
  if (error && !isAlreadyDone(error)) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }

  const totals = await currentTotals(supabase, levelId);
  if (totals && totals.creatorId) await syncAchievementsFor(totals.creatorId);

  return res.status(200).json({
    ok: true, action, active: action === 'favorite',
    likes: totals ? totals.likes : undefined,
    favorites: totals ? totals.favorites : undefined,
  });
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
