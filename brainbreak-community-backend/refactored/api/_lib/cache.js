// /api/_lib/cache.js
//
// Sets Cache-Control + Vary: Authorization on responses that are safe to
// cache at Vercel's edge — public read endpoints whose SQL/RPC layer
// doesn't gate anything on the caller's identity in a way that changes
// the response for two different anonymous callers. `Vary: Authorization`
// is the important part: it keeps this safe even for handlers that
// forward whatever Authorization header is present (clientFor(req)) —
// every distinct token value gets its own cache bucket, and every
// anonymous request (no header) shares one bucket. Nothing here changes
// status codes, payloads, or auth checks; it only lets repeat requests
// for the same public data be served from Vercel's CDN instead of
// round-tripping to Supabase every time.
//
// NEVER call this for an endpoint whose response is tied to "the current
// user" in a way a shared cache bucket could leak (own profile, own
// levels, admin data) — those must stay uncached (the default).

export function cachePublic(res, { maxAge = 30, staleWhileRevalidate = 120 } = {}) {
  res.setHeader('Cache-Control', `public, s-maxage=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`);
  res.setHeader('Vary', 'Authorization');
}
