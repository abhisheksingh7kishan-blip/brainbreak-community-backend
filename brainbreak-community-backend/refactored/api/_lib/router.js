// /api/_lib/router.js
//
// Minimal path+method router for the consolidated Vercel catch-all
// functions (api/community/[...path].js, api/admin/[...path].js).
//
// Vercel's [...path] dynamic segment delivers everything after the
// static prefix as an array in req.query.path — e.g. a request to
// /api/community/creators/42/levels arrives with
// req.query.path === ['creators', '42', 'levels']. dispatch() matches
// that array + req.method against an ordered ROUTES table (owned by each
// entry-point file) and calls the matching controller with
// (req, res, params), where params holds any ":name" segment values.
//
// ROUTE ORDER MATTERS: this router does not reorder or "specificity
// sort" routes itself — it walks the table top to bottom and returns the
// first match. Put literal (non-":param") patterns before a
// same-length ":param" pattern that could also match them, e.g.
// ['creators', 'leaderboard'] before ['creators', ':id']. Each entry
// point's ROUTES table comments this where it matters.

export function matchRoute(routes, method, segments) {
  for (const route of routes) {
    if (route.pattern.length !== segments.length) continue;

    const params = {};
    let segmentsOk = true;
    for (let i = 0; i < route.pattern.length; i++) {
      const part = route.pattern[i];
      if (part.startsWith(':')) {
        params[part.slice(1)] = segments[i];
      } else if (part !== segments[i]) {
        segmentsOk = false;
        break;
      }
    }
    if (!segmentsOk) continue;

    if (route.method !== method) continue; // path matches, method doesn't — keep looking, then 405
    return { route, params };
  }
  return null;
}

// True if some route's pattern matches these segments regardless of
// method — used to tell "wrong method" (405) apart from "no such route"
// (404), matching each original single-purpose file's own per-route 405
// behavior as closely as possible.
function pathExists(routes, segments) {
  return routes.some((route) => {
    if (route.pattern.length !== segments.length) return false;
    return route.pattern.every((part, i) => part.startsWith(':') || part === segments[i]);
  });
}

export async function dispatch(routes, req, res) {
  const raw = req.query.path;
  const segments = Array.isArray(raw) ? raw : (raw ? [raw] : []);

  const match = matchRoute(routes, req.method, segments);
  if (!match) {
    if (pathExists(routes, segments)) return res.status(405).json({ error: 'method_not_allowed' });
    return res.status(404).json({ error: 'not_found' });
  }

  // Only the matched route's controller module gets imported/evaluated —
  // ESM caches it per warm container, so this costs nothing on repeat
  // hits to the same route and saves real work on cold starts and on
  // requests to routes that don't share a controller file.
  const handler = await match.route.load();
  return handler(req, res, match.params);
}
