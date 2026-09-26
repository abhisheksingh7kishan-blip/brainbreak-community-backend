// /api/_lib/controllers/levels.js
//
// GET  /api/community/levels/discover
// GET  /api/community/levels/:id
// GET  /api/community/levels/:id/play-data
// POST /api/community/levels/report
// POST /api/community/levels/unpublish
//
// Logic moved verbatim from the original single-purpose files under
// api/community/levels/ (all deleted; their URLs now route here via
// api/community/[...path].js). No behavior change: same RPCs, same
// validation, same response shapes.

import { clientFor, requireUser, friendlyError } from '../supabaseClients.js';
import { cachePublic } from '../cache.js';

const DISCOVER_CATEGORIES = new Set(['most_played', 'most_liked', 'recent', 'complex']);
const REPORT_REASONS = new Set(['broken', 'inappropriate', 'spam', 'exploit', 'other']);

// GET /api/community/levels/discover?category=recent&q=&page=1&limit=20
// Thin wrapper around get_discover_levels(). Public — works with or
// without a signed-in caller.
export async function getDiscover(req, res) {
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
  cachePublic(res, { maxAge: 15, staleWhileRevalidate: 60 });
  return res.status(200).json(data);
}

// POST { levelId, reason, details? } /api/community/levels/report
// A plain insert using the CALLER's own forwarded token — RLS
// (level_reports_insert_own) restricts reporter_id to auth.uid(), and the
// table's UNIQUE(level_id, reporter_id) constraint stops duplicate reports.
export async function postReport(req, res) {
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

// POST { levelId } /api/community/levels/unpublish
// Thin wrapper around unpublish_level() — RLS + the RPC's own auth.uid()
// check both independently guarantee only the owner can do this.
export async function postUnpublish(req, res) {
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

// GET /api/community/levels/:id
// Thin wrapper around get_level_public(). Works for anonymous browsing
// (published levels) and for the owner checking their own draft — the RPC
// itself decides visibility from auth.uid().
export async function getLevel(req, res, params) {
  const id = params.id;
  if (!id) return res.status(400).json({ error: 'missing_level_id' });

  const supabase = clientFor(req); // forwards Authorization if present, anon-only otherwise
  const { data, error } = await supabase.rpc('get_level_public', { p_level_id: id });

  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }
  if (!data) return res.status(404).json({ error: 'This level is no longer available.' });
  cachePublic(res, { maxAge: 30, staleWhileRevalidate: 120 });
  return res.status(200).json(data);
}

// GET /api/community/levels/:id/play-data
// Returns { id, name, levelData } for a PUBLISHED level only, via
// get_level_for_play(). Separate from POST .../interactions/play, which
// is what actually records the play statistic.
export async function getPlayData(req, res, params) {
  const id = params.id;
  if (!id) return res.status(400).json({ error: 'missing_level_id' });

  const supabase = clientFor(req);
  const { data, error } = await supabase.rpc('get_level_for_play', { p_level_id: id });

  if (error) {
    console.error('get_level_for_play error', error);
    return res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
  }
  if (!data) return res.status(404).json({ error: 'This level is no longer available to play.' });
  cachePublic(res, { maxAge: 60, staleWhileRevalidate: 300 });
  return res.status(200).json(data);
}
