// /api/community/interactions/[...path].js
//
// Single Vercel Serverless Function that serves every
// /api/community/interactions/* URL. Consolidation of what used to be 3
// separate function files (like.js, favorite.js, play.js), done purely
// to stay under Vercel Hobby's 12-function limit. Every external URL,
// method, auth requirement, and response shape is unchanged. See
// src/controllers/interactions.js for the actual logic (moved verbatim
// from the original files).
//
// Routes handled here:
//   POST /api/community/interactions/like
//   POST /api/community/interactions/favorite
//   POST /api/community/interactions/play

import { handleCors } from '../../_lib/supabaseClients.js';
import { like, favorite, play } from '../../../src/controllers/interactions.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  const segments = Array.isArray(req.query.path)
    ? req.query.path
    : req.query.path ? [req.query.path] : [];

  if (segments.length === 1 && segments[0] === 'like') return like(req, res);
  if (segments.length === 1 && segments[0] === 'favorite') return favorite(req, res);
  if (segments.length === 1 && segments[0] === 'play') return play(req, res);

  return res.status(404).json({ error: 'not_found' });
}
