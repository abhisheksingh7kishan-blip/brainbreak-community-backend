// /api/admin/[...path].js
//
// Single Vercel Serverless Function that serves every /api/admin/* URL.
// Consolidation of what used to be 2 separate function files
// (reports/list.js, reports/review.js), done purely to stay under Vercel
// Hobby's 12-function limit. Every external URL, method, admin-only auth
// requirement, and response shape is unchanged. See
// src/controllers/admin.js for the actual logic (moved verbatim from the
// original files).
//
// Routes handled here:
//   GET  /api/admin/reports/list
//   POST /api/admin/reports/review

import { handleCors } from '../_lib/supabaseClients.js';
import { listReports, reviewReport } from '../../src/controllers/admin.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  const segments = Array.isArray(req.query.path)
    ? req.query.path
    : req.query.path ? [req.query.path] : [];

  if (segments.length === 2 && segments[0] === 'reports' && segments[1] === 'list') {
    return listReports(req, res);
  }

  if (segments.length === 2 && segments[0] === 'reports' && segments[1] === 'review') {
    return reviewReport(req, res);
  }

  return res.status(404).json({ error: 'not_found' });
}
