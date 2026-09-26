// /api/_lib/controllers/creators.js
//
// GET /api/community/creators/leaderboard
// GET /api/community/creators/me/levels
// GET /api/community/creators/:id
// GET /api/community/creators/:id/achievements
// GET /api/community/creators/:id/levels
//
// Logic moved verbatim from the original single-purpose files under
// api/community/creators/ (all deleted; their URLs now route here via
// api/community/[...path].js). No behavior change: same RPCs, same
// validation, same pagination caps, same response shapes.

import { clientFor, requireUser, friendlyError } from '../supabaseClients.js';
import { cachePublic } from '../cache.js';

const LEADERBOARD_CATEGORIES = new Set([
  'most_played',
  'most_liked',
  'most_published',
  'most_favorited',
  'popular_levels',
]);

// GET /api/community/creators/leaderboard?category=most_played&page=1&limit=25
// Thin wrapper around get_creator_leaderboard() — all ranking logic and
// pagination limits live in Postgres. Uses the anon-key client (least
// privilege): the RPC is granted to anon because leaderboard data is public.
export async function getLeaderboard(req, res) {
  const category = String(req.query.category || 'most_played');
  if (!LEADERBOARD_CATEGORIES.has(category)) {
    return res.status(400).json({ error: 'invalid_category', validCategories: [...LEADERBOARD_CATEGORIES] });
  }

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

  const supabase = clientFor(req);
  const { data, error } = await supabase.rpc('get_creator_leaderboard', {
    p_category: category,
    p_page: page,
    p_limit: limit,
  });

  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }

  cachePublic(res, { maxAge: 15, staleWhileRevalidate: 60 });
  return res.status(200).json({
    category,
    page,
    limit,
    entries: data.map((row) => ({
      rank: Number(row.rank),
      creator: {
        id: row.creator_id,
        displayName: row.display_name || row.username,
      },
      creatorSince: row.creator_since,
      value: Number(row.value),
    })),
  });
}

// GET /api/community/creators/me/levels?page=1&limit=20
// Own levels, ANY status (draft/published/unpublished) — relies on the
// existing RLS policy `levels_select_published_or_own`, so no new RPC is
// needed here.
export async function getMyLevels(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const { supabase, userId } = auth;

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const from = (page - 1) * limit;

  const { data, error, count } = await supabase
    .from('levels')
    .select('id, title, status, play_count, like_count, favorite_count, published_at', { count: 'exact' })
    .eq('creator_id', userId)
    .order('updated_at', { ascending: false })
    .range(from, from + limit - 1);

  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }

  return res.status(200).json({
    page, limit, total: count,
    items: data.map((l) => ({
      id: l.id,
      name: l.title,
      status: l.status,
      stats: { plays: l.play_count, likes: l.like_count, favorites: l.favorite_count },
    })),
  });
}

// GET /api/community/creators/:id
// Public creator profile payload via get_creator_profile(). Uses the
// anon-key client (least privilege).
export async function getCreator(req, res, params) {
  const id = params.id;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'missing_creator_id' });
  }

  const supabase = clientFor(req);
  const { data, error } = await supabase.rpc('get_creator_profile', { p_creator_id: id });

  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }
  if (!data) {
    return res.status(404).json({ error: 'creator_not_found' });
  }
  cachePublic(res, { maxAge: 30, staleWhileRevalidate: 120 });
  return res.status(200).json(data);
}

// GET /api/community/creators/:id/achievements
// Thin wrapper around get_creator_achievements() — public, anon-safe.
export async function getCreatorAchievements(req, res, params) {
  const id = params.id;
  if (!id) return res.status(400).json({ error: 'missing_creator_id' });

  const supabase = clientFor(req);
  const { data, error } = await supabase.rpc('get_creator_achievements', { p_creator_id: id });

  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }
  cachePublic(res, { maxAge: 30, staleWhileRevalidate: 120 });
  return res.status(200).json({ achievements: data });
}

// GET /api/community/creators/:id/levels?page=1&limit=20
// A creator's PUBLISHED levels only. Thin wrapper around
// get_creator_levels(), which enforces page/limit caps and the
// status='published' filter server-side.
export async function getCreatorLevels(req, res, params) {
  const id = params.id;
  if (!id) return res.status(400).json({ error: 'missing_creator_id' });

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  const supabase = clientFor(req); // public data — works with or without a signed-in caller
  const { data, error } = await supabase.rpc('get_creator_levels', {
    p_creator_id: id, p_page: page, p_limit: limit,
  });

  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }
  cachePublic(res, { maxAge: 30, staleWhileRevalidate: 120 });
  return res.status(200).json(data);
}
