// /api/community/[...path].js
//
// Single Vercel Serverless Function entry point for every
// /api/community/* route. This is the ONLY reason this file exists: to
// consolidate the ~15 route files that used to live under
// api/community/**/*.js into one Vercel Function, so the whole backend
// fits inside Vercel Hobby's 12-function limit.
//
// Every external URL, HTTP method, request/response shape, and auth
// check is UNCHANGED from the original files — see
// api/_lib/controllers/*.js for the actual per-route logic (moved there
// verbatim) and api/_lib/router.js for how a request path gets there.
//
// Vercel's [...path] catch-all delivers the remaining path segments as
// req.query.path — e.g. a request to
// /api/community/creators/42/levels arrives here with
// req.query.path === ['creators', '42', 'levels'].
//
// Each route's `load` is a dynamic import, not a top-level one: only the
// controller module a given request actually needs gets parsed and
// evaluated (e.g. a /profile/me request never touches publish.js or
// interactions.js). Node/ESM caches the module after the first import
// within a warm container, so this only helps — repeat hits to the same
// route pay nothing extra.
//
// ROUTE ORDER MATTERS: literal (non-":param") patterns are listed before
// a same-length ":param" pattern that could also match them, e.g.
// ['creators', 'leaderboard'] before ['creators', ':id'], and
// ['creators', 'me', 'levels'] before ['creators', ':id', 'levels'].
// See api/_lib/router.js.

import { dispatch } from '../_lib/router.js';

const ROUTES = [
  // ---- profile --------------------------------------------------------
  { method: 'GET', pattern: ['profile', 'me'], load: async () => (await import('../_lib/controllers/profile.js')).getProfile },
  { method: 'PATCH', pattern: ['profile', 'me'], load: async () => (await import('../_lib/controllers/profile.js')).patchProfile },

  // ---- creators — literal routes before ':id' routes of the same length
  { method: 'GET', pattern: ['creators', 'leaderboard'], load: async () => (await import('../_lib/controllers/creators.js')).getLeaderboard },
  { method: 'GET', pattern: ['creators', 'me', 'levels'], load: async () => (await import('../_lib/controllers/creators.js')).getMyLevels },
  { method: 'GET', pattern: ['creators', ':id'], load: async () => (await import('../_lib/controllers/creators.js')).getCreator },
  { method: 'GET', pattern: ['creators', ':id', 'achievements'], load: async () => (await import('../_lib/controllers/creators.js')).getCreatorAchievements },
  { method: 'GET', pattern: ['creators', ':id', 'levels'], load: async () => (await import('../_lib/controllers/creators.js')).getCreatorLevels },

  // ---- levels — literal routes before ':id' routes of the same length -
  { method: 'GET', pattern: ['levels', 'discover'], load: async () => (await import('../_lib/controllers/levels.js')).getDiscover },
  { method: 'POST', pattern: ['levels', 'report'], load: async () => (await import('../_lib/controllers/levels.js')).postReport },
  { method: 'POST', pattern: ['levels', 'unpublish'], load: async () => (await import('../_lib/controllers/levels.js')).postUnpublish },
  { method: 'GET', pattern: ['levels', ':id'], load: async () => (await import('../_lib/controllers/levels.js')).getLevel },
  { method: 'GET', pattern: ['levels', ':id', 'play-data'], load: async () => (await import('../_lib/controllers/levels.js')).getPlayData },

  // ---- interactions -----------------------------------------------------
  { method: 'POST', pattern: ['interactions', 'like'], load: async () => (await import('../_lib/controllers/interactions.js')).postLike },
  { method: 'POST', pattern: ['interactions', 'favorite'], load: async () => (await import('../_lib/controllers/interactions.js')).postFavorite },
  { method: 'POST', pattern: ['interactions', 'play'], load: async () => (await import('../_lib/controllers/interactions.js')).postPlay },

  // ---- publish ----------------------------------------------------------
  { method: 'POST', pattern: ['publish'], load: async () => (await import('../_lib/controllers/publish.js')).postPublish },
];

export default async function handler(req, res) {
  return dispatch(ROUTES, req, res);
}
