// /src/controllers/admin.js
//
// Business logic for every /api/admin/* route. Moved here, unchanged in
// behavior, from the original one-file-per-route handlers so a single
// Vercel Serverless Function (api/admin/[...path].js) can dispatch to
// all of them.

import { requireAdmin, serviceClient, friendlyError } from '../../api/_lib/supabaseClients.js';

const REVIEW_ACTIONS = new Set(['remove_level', 'dismiss']);

// GET /api/admin/reports/list?status=pending
// (originally api/admin/reports/list.js)
export async function listReports(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const auth = await requireAdmin(req, res);
  if (!auth) return; // requireAdmin already sent 401/403

  const status = ['pending', 'reviewed', 'dismissed', 'action_taken'].includes(req.query.status)
    ? req.query.status : 'pending';

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from('level_reports')
    .select(`
      id, reason, details, status, created_at,
      levels ( id, title, status, creator_id, profiles ( username, display_name ) ),
      reporter:profiles!level_reports_reporter_id_fkey ( id, username, display_name )
    `)
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) {
    console.error('admin reports list error', error);
    return res.status(500).json({ error: 'Could not load reports.' });
  }

  return res.status(200).json({
    reports: data.map((r) => ({
      id: r.id,
      reason: r.reason,
      details: r.details,
      status: r.status,
      createdAt: r.created_at,
      level: r.levels ? {
        id: r.levels.id,
        name: r.levels.title,
        status: r.levels.status,
        creatorName: r.levels.profiles ? (r.levels.profiles.display_name || r.levels.profiles.username) : 'Unknown',
      } : null,
      reporterName: r.reporter ? (r.reporter.display_name || r.reporter.username) : 'Unknown',
    })),
  });
}

// POST /api/admin/reports/review  { reportId, action: 'remove_level' | 'dismiss' }
// (originally api/admin/reports/review.js)
export async function reviewReport(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const { userId } = auth;

  const { reportId, action } = req.body || {};
  if (!reportId || !REVIEW_ACTIONS.has(action)) {
    return res.status(400).json({ error: 'reportId and a valid action are required' });
  }

  const supabase = serviceClient();

  const { data: report, error: fetchErr } = await supabase
    .from('level_reports').select('id, level_id, status').eq('id', reportId).single();
  if (fetchErr || !report) return res.status(404).json({ error: 'Report not found.' });
  if (report.status !== 'pending') {
    return res.status(409).json({ error: 'This report was already reviewed.' });
  }

  try {
    if (action === 'remove_level') {
      const { error: removeErr } = await supabase.rpc('remove_level', { p_level_id: report.level_id });
      if (removeErr) throw removeErr;
    }

    const { error: updErr } = await supabase
      .from('level_reports')
      .update({
        status: action === 'remove_level' ? 'action_taken' : 'dismissed',
        reviewed_at: new Date().toISOString(),
        reviewed_by: userId,
      })
      .eq('id', reportId);
    if (updErr) throw updErr;

    return res.status(200).json({ ok: true, action });
  } catch (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }
}
