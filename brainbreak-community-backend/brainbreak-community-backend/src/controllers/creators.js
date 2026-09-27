// /src/controllers/creators.js
//
// Business logic for every /api/community/creators/* route. Moved here,
// unchanged in behavior, from the original one-file-per-route handlers so
// that a single Vercel Serverless Function
// (api/community/creators/[...path].js) can dispatch to all of them
// without exceeding Vercel Hobby's 12-function limit. Each exported
// function is a straight copy of the corresponding original handler body,
// including its own method check, so behavior (status codes, auth,
// response shape) is identical to before the refactor.

import { clientFor, requireUser, friendlyError } from '../../api/_lib/supabaseClients.js';

const LEADERBOARD_CATEGORIES = new Set([
  'most_played',
  'most_liked',
  'most_published',
  'most_favorited',
  'popular_levels',
]);

// GET /api/community/creators/leaderboard?category=most_played&page=1&limit=25
// (originally api/community/creators/leaderboard.js)
export async function getLeaderboard(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

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

// GET /api/community/creators/:id
// (originally api/community/creators/[id].js)
export async function getProfile(req, res, id) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

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

  return res.status(200).json(data);
}

// GET /api/community/creators/:id/achievements
// (originally api/community/creators/[id]/achievements.js)
export async function getAchievements(req, res, id) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  if (!id) return res.status(400).json({ error: 'missing_creator_id' });

  const supabase = clientFor(req);
  const { data, error } = await supabase.rpc('get_creator_achievements', { p_creator_id: id });

  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }
  return res.status(200).json({ achievements: data });
}

// GET /api/community/creators/:id/levels?page=1&limit=20
// (originally api/community/creators/[id]/levels.js)
export async function getLevels(req, res, id) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

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
  return res.status(200).json(data);
}

// GET /api/community/creators/me/levels?page=1&limit=20
// (originally api/community/creators/me/levels.js)
export async function getMyLevels(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const auth = await requireUser(req, res);
  if (!auth) return; // requireUser already sent 401
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
