// /api/admin/[...path].js
//
// Single Vercel Serverless Function entry point for every /api/admin/*
// route (currently the two moderation-report endpoints). Same
// consolidation rationale as api/community/[...path].js — see that
// file's header comment. No external behavior change: same URLs, same
// methods, same admin auth check (requireAdmin), same response shapes.
//
// Lazily imports api/_lib/controllers/admin.js only on the first request
// that actually needs it, same reasoning as the community entry point.

import { dispatch } from '../_lib/router.js';

const ROUTES = [
  { method: 'GET', pattern: ['reports', 'list'], load: async () => (await import('../_lib/controllers/admin.js')).listReports },
  { method: 'POST', pattern: ['reports', 'review'], load: async () => (await import('../_lib/controllers/admin.js')).reviewReport },
];

export default async function handler(req, res) {
  return dispatch(ROUTES, req, res);
}
