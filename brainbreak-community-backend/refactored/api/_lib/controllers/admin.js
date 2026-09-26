// /api/_lib/controllers/admin.js
//
// GET  /api/admin/reports/list?status=pending
// POST /api/admin/reports/review  { reportId, action: 'remove_level' | 'dismiss' }
//
// Logic moved verbatim from the original single-purpose files
// api/admin/reports/list.js and api/admin/reports/review.js (both
// deleted; their URLs now route here via api/admin/[...path].js). No
// behavior change.

import { requireAdmin, serviceClient, friendlyError } from '../supabaseClients.js';

const REVIEW_ACTIONS = new Set(['remove_level', 'dismiss']);

// Admin-only (requireAdmin verifies the caller's OWN profile.role via
// their own forwarded token first). Once verified, uses the service-role
// client for the actual read — level_reports' RLS only lets a normal user
// see their OWN reports (level_reports_select_own), so an admin needs the
// privileged connection to see everyone's.
//
// Note: `reporter:profiles!level_reports_reporter_id_fkey` relies on
// Postgres's default foreign-key constraint naming
// (`<table>_<column>_fkey`) since level_reports.reporter_id was declared
// as a plain inline `references` in community_world.sql. If this join
// ever errors with "could not find relationship", check the actual
// constraint name in Supabase -> Table Editor -> level_reports -> and
// update the string above, or fall back to two separate queries (reports,
// then a second query for the reporter names by id).
export async function listReports(req, res) {
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

// Admin-only. The admin check happens with the caller's OWN identity
// (requireAdmin, via their forwarded token — can't be spoofed); the
// actual privileged writes (updating level_reports.status, and removing
// the level) then use the service-role client, because level_reports'
// guard trigger only permits a service_role connection to change
// status/reviewed_at/reviewed_by — not even a SECURITY DEFINER function
// running as an authenticated admin satisfies that check, by design.
export async function reviewReport(req, res) {
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
