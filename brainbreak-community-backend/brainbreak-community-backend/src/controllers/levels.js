// /src/controllers/levels.js
//
// Business logic for every /api/community/levels/* route. Moved here,
// unchanged in behavior, from the original one-file-per-route handlers so
// a single Vercel Serverless Function (api/community/levels/[...path].js)
// can dispatch to all of them.

import { clientFor, requireUser, friendlyError } from '../../api/_lib/supabaseClients.js';

const REPORT_REASONS = new Set(['broken', 'inappropriate', 'spam', 'exploit', 'other']);
const DISCOVER_CATEGORIES = new Set(['most_played', 'most_liked', 'recent', 'complex']);

// GET /api/community/levels/:id
// (originally api/community/levels/[id].js)
export async function getById(req, res, id) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  if (!id) return res.status(400).json({ error: 'missing_level_id' });

  const supabase = clientFor(req); // forwards Authorization if present, anon-only otherwise
  const { data, error } = await supabase.rpc('get_level_public', { p_level_id: id });

  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }
  if (!data) return res.status(404).json({ error: 'This level is no longer available.' });

  return res.status(200).json(data);
}

// GET /api/community/levels/:id/play-data
// (originally api/community/levels/[id]/play-data.js)
export async function getPlayData(req, res, id) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  if (!id) return res.status(400).json({ error: 'missing_level_id' });

  const supabase = clientFor(req);
  const { data, error } = await supabase.rpc('get_level_for_play', { p_level_id: id });

  if (error) {
    console.error('get_level_for_play error', error);
    return res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
  }
  if (!data) return res.status(404).json({ error: 'This level is no longer available to play.' });

  return res.status(200).json(data);
}

// GET /api/community/levels/discover?category=recent&q=&page=1&limit=20
// (originally api/community/levels/discover.js)
export async function discover(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const category = DISCOVER_CATEGORIES.has(req.query.category) ? req.query.category : 'recent';
  const query = req.query.q ? String(req.query.q).slice(0, 100) : null;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  const supabase = clientFor(req);
  const { data, error } = await supabase.rpc('get_discover_levels', {
    p_category: category, p_query: query, p_page: page, p_limit: limit,
  });

  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }
  return res.status(200).json(data);
}

// POST /api/community/levels/report  { levelId, reason, details? }
// (originally api/community/levels/report.js)
export async function report(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { supabase, userId } = auth;

  const { levelId, reason, details } = req.body || {};
  if (!levelId) return res.status(400).json({ error: 'levelId is required' });
  if (!REPORT_REASONS.has(reason)) {
    return res.status(400).json({ error: 'reason must be one of: ' + [...REPORT_REASONS].join(', ') });
  }
  const cleanDetails = details ? String(details).slice(0, 1000) : null;

  const { error } = await supabase
    .from('level_reports')
    .insert({ level_id: levelId, reporter_id: userId, reason, details: cleanDetails });

  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }

  return res.status(200).json({ ok: true });
}

// POST /api/community/levels/unpublish  { levelId }
// (originally api/community/levels/unpublish.js)
export async function unpublish(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const { levelId } = req.body || {};
  if (!levelId) return res.status(400).json({ error: 'levelId is required' });

  const { data, error } = await supabase.rpc('unpublish_level', { p_level_id: levelId });
  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }

  return res.status(200).json({ ok: true, id: data.id, status: data.status });
}
