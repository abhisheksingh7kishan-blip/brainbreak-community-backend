// /api/404.js
//
// Vercel serves this only when a request under /api/(.*) doesn't match
// any real Serverless Function or dynamic route — see the "rewrites"
// entry in vercel.json. Filesystem matches (api/health.js,
// api/community/[...path].js, api/admin/[...path].js,
// api/cron/refresh-leaderboard.js, and every route those two catch-alls
// already handle) always take priority over this rewrite, so this file
// only ever fires for a genuinely unknown /api/* path — e.g. a typo, an
// old client hitting a URL that never existed, or someone probing the
// API. Returns clean JSON instead of Vercel's default platform error
// page, which is what a game client actually wants to parse.

export default function handler(req, res) {
  return res.status(404).json({
    error: 'not_found',
    message: 'No API route matches this path.',
  });
}
