// /api/community/creators/[...path].js
//
// Single Vercel Serverless Function that serves every
// /api/community/creators/* URL. This is a consolidation of what used to
// be 5 separate function files (leaderboard.js, [id].js,
// [id]/achievements.js, [id]/levels.js, me/levels.js) — done purely to
// stay under Vercel Hobby's 12-function limit. Every external URL,
// method, auth requirement, and response shape is unchanged; only the
// internal file layout changed. See src/controllers/creators.js for the
// actual logic (moved verbatim from the original files).
//
// Routes handled here (matched by path shape, not by method — each
// controller function enforces its own allowed method and returns 405
// otherwise, exactly like the original single-purpose files did):
//
//   GET /api/community/creators/leaderboard
//   GET /api/community/creators/me/levels
//   GET /api/community/creators/:id/levels
//   GET /api/community/creators/:id/achievements
//   GET /api/community/creators/:id

import { handleCors } from '../../_lib/supabaseClients.js';
import {
  getLeaderboard,
  getProfile,
  getAchievements,
  getLevels,
  getMyLevels,
} from '../../../src/controllers/creators.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  const segments = Array.isArray(req.query.path)
    ? req.query.path
    : req.query.path ? [req.query.path] : [];

  if (segments.length === 1 && segments[0] === 'leaderboard') {
    return getLeaderboard(req, res);
  }

  if (segments.length === 2 && segments[0] === 'me' && segments[1] === 'levels') {
    return getMyLevels(req, res);
  }

  if (segments.length === 2 && segments[1] === 'levels') {
    return getLevels(req, res, segments[0]);
  }

  if (segments.length === 2 && segments[1] === 'achievements') {
    return getAchievements(req, res, segments[0]);
  }

  if (segments.length === 1) {
    return getProfile(req, res, segments[0]);
  }

  return res.status(404).json({ error: 'not_found' });
}
