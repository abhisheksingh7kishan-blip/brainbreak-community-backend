// /api/community/levels/[...path].js
//
// Single Vercel Serverless Function that serves every
// /api/community/levels/* URL. Consolidation of what used to be 5
// separate function files ([id].js, [id]/play-data.js, discover.js,
// report.js, unpublish.js), done purely to stay under Vercel Hobby's
// 12-function limit. Every external URL, method, auth requirement, and
// response shape is unchanged. See src/controllers/levels.js for the
// actual logic (moved verbatim from the original files).
//
// Routes handled here:
//   GET  /api/community/levels/discover
//   POST /api/community/levels/report
//   POST /api/community/levels/unpublish
//   GET  /api/community/levels/:id/play-data
//   GET  /api/community/levels/:id
//
// 'discover', 'report', and 'unpublish' are reserved single-segment path
// names checked before the generic :id case — level ids are Supabase
// uuids, so there is no real collision, but the explicit check avoids
// ever relying on that assumption.

import { handleCors, pathSegments } from '../../_lib/supabaseClients.js';
import { getById, getPlayData, discover, report, unpublish } from '../../../src/controllers/levels.js';

const RESERVED = new Set(['discover', 'report', 'unpublish']);

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  const segments = pathSegments(req, '/api/community/levels');

  if (segments.length === 1 && segments[0] === 'discover') {
    return discover(req, res);
  }

  if (segments.length === 1 && segments[0] === 'report') {
    return report(req, res);
  }

  if (segments.length === 1 && segments[0] === 'unpublish') {
    return unpublish(req, res);
  }

  if (segments.length === 2 && segments[1] === 'play-data') {
    return getPlayData(req, res, segments[0]);
  }

  if (segments.length === 1 && !RESERVED.has(segments[0])) {
    return getById(req, res, segments[0]);
  }

  return res.status(404).json({ error: 'not_found', debug: { url: req.url, segments } });
}
