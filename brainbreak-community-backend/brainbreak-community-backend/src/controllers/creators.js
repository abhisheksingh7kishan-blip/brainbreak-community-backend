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

  // The caller's OWN exact rank in this category (so "YOUR RANK" is right even when they are on page 400 of 10,000).
  // Optional: only when the game asks for it (me=1) AND the caller is signed in. Never fails the leaderboard.
  let me = null;
  if (req.query.me === '1' && req.headers.authorization) {
    try {
      const { data: u } = await supabase.auth.getUser();
      if (u && u.user) {
        const { data: r } = await supabase.rpc('get_creator_rank', { p_creator_id: u.user.id, p_category: category });
        if (r && r.rank != null) me = { id: u.user.id, rank: Number(r.rank), value: Number(r.value), totalCreators: Number(r.totalCreators) };
      }
    } catch (e) { me = null; }
  }

  return res.status(200).json({
    category,
    page,
    limit,
    hasMore: data.length >= limit,   // a full page means there may be more; the game keeps loading until a short page
    me,
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

// GET|POST /api/community/creators/me/achievements
//
// The signed-in player's achievements, titles and badge showcase.
//   GET  -> current state (no writes).
//   POST -> { events:[{a:'slug', t:epoch_ms}], title?: 'title_id'|null, fav?: ['slug', ...] }
//           records newly observed trophies, applies a title/showcase change, returns the new state.
// Identity is ALWAYS the caller's own forwarded token (auth.uid() inside sync_my_achievements) — a user id
// in the body is never read. Uses the player's own client, not the service-role client. Everything is
// validated again inside the database function; the checks here only keep obviously bad input out.
const SLUG_RE = /^[a-z0-9_]{2,40}$/;

export async function myAchievements(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const auth = await requireUser(req, res);
  if (!auth) return; // requireUser already sent 401
  const { supabase } = auth;

  const args = {};
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'invalid_json' }); }
    }
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid_body' });

    if (body.events !== undefined) {
      if (!Array.isArray(body.events)) return res.status(400).json({ error: 'invalid_events' });
      args.p_events = body.events
        .slice(0, 100)
        .filter((e) => e && typeof e.a === 'string' && SLUG_RE.test(e.a))
        .map((e) => ({ a: e.a, t: Number.isFinite(Number(e.t)) ? Math.trunc(Number(e.t)) : null }));
    }
    if ('title' in body) {
      if (body.title !== null && (typeof body.title !== 'string' || (body.title !== '' && !SLUG_RE.test(body.title)))) {
        return res.status(400).json({ error: 'invalid_title' });
      }
      args.p_set_title = true;
      args.p_title = body.title || null;
    }
    if (body.fav !== undefined) {
      if (!Array.isArray(body.fav)) return res.status(400).json({ error: 'invalid_showcase' });
      args.p_set_showcase = true;
      args.p_showcase = body.fav.filter((x) => typeof x === 'string' && SLUG_RE.test(x)).slice(0, 3);
    }
  }

  const { data, error } = await supabase.rpc('sync_my_achievements', args);
  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
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

  // ?status=published  -> only this creator's LIVE levels (what the "Your Stats" page lists)
  const onlyPublished = String(req.query.status || '') === 'published';
  const run = (cols) => {
    let q = supabase.from('levels').select(cols, { count: 'exact' }).eq('creator_id', userId);
    if (onlyPublished) q = q.eq('status', 'published');
    return q.order(onlyPublished ? 'published_at' : 'updated_at', { ascending: false }).range(from, from + limit - 1);
  };
  const BASE = 'id, title, status, play_count, like_count, favorite_count, published_at';
  // The rating columns exist only after 6_difficulty_rating.sql - if they are not there yet, still answer (without ratings).
  let { data, error, count } = await run(BASE + ', difficulty_bars, difficulty_score');
  if (error) ({ data, error, count } = await run(BASE));

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
      publishedAt: l.published_at || null,
      difficultyBars: l.difficulty_bars != null ? l.difficulty_bars : null,
      difficultyScore: l.difficulty_score != null ? Number(l.difficulty_score) : null,
      stats: { plays: l.play_count, likes: l.like_count, favorites: l.favorite_count },
    })),
  });
}

// GET /api/community/creators/search?q=neo&limit=25
// Find creators by name (best match first: exact, then starts-with, then contains; ties -> more plays).
export async function searchCreators(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const q = String((req.query && req.query.q) || '').trim().slice(0, 40);
  if (!q) return res.status(200).json({ query: '', entries: [] });
  const limit = Math.min(Math.max(parseInt(req.query && req.query.limit, 10) || 25, 1), 50);

  const supabase = clientFor(req);
  const { data, error } = await supabase.rpc('search_creators', { p_query: q, p_limit: limit });
  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }

  const rows = Array.isArray(data) ? data : [];
  return res.status(200).json({
    query: q,
    entries: rows.map((row) => ({
      creator: { id: row.creator_id, displayName: row.display_name || row.username, avatarUrl: row.avatar_url },
      creatorSince: row.creator_since,
      totalPublished: Number(row.total_published) || 0,
      totalPlays: Number(row.total_plays) || 0,
      totalLikes: Number(row.total_likes) || 0,
      totalFavorites: Number(row.total_favorites) || 0,
    })),
  });
                                 }
  
