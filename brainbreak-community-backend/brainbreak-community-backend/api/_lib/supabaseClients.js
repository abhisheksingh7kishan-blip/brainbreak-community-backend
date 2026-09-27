// /api/_lib/supabaseClients.js
//
// Two kinds of Supabase client, used for two different purposes. Getting
// this split right is what makes every "never trust a client-submitted
// creatorId" requirement actually true at the database level, not just in
// application code:
//
// 1. clientFor(req)  — anon key + the CALLER'S OWN access token forwarded
//    in the Authorization header. Supabase resolves auth.uid() from that
//    token, so RLS policies and every SECURITY DEFINER function that
//    checks auth.uid() (publish_level, like_level, register_level_play,
//    update_display_name, ...) are enforcing the REAL signed-in user —
//    the request body's JSON is never consulted for identity.
//    Use this for every endpoint that reads/writes on behalf of a player.
//
// 2. serviceClient() — the service-role key. Bypasses RLS entirely, so it
//    is used ONLY for the small set of trusted, backend-only operations
//    that no client request should be able to trigger directly:
//      - sync_creator_achievements()   (not granted to anon/authenticated)
//      - refresh_creator_leaderboard_cache() (cron only)
//    NEVER instantiate this client using anything from `req` — it must
//    stay completely disconnected from client-supplied identity.

import { createClient } from '@supabase/supabase-js';

// The game runs inside a packaged Android app, not a page served from this
// same domain — every request is cross-origin from the WebView's point of
// view, so every response needs these headers or the request gets silently
// blocked client-side before your code ever sees a response. `*` is fine
// here: these endpoints are already protected by Supabase auth/RLS, not by
// which origin is asking, and a packaged app doesn't have a fixed origin
// to allow-list anyway (WebViews commonly use `file://`, `null`, or an
// app-specific custom scheme depending on the wrapper).
//
// Every handler must call this FIRST, and return immediately if it
// returns true (that means the request was a CORS preflight OPTIONS call,
// already fully answered).
export function handleCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function clientFor(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function serviceClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Resolves the authenticated user id from the request's bearer token, or
// null if the request is anonymous / the token is invalid or expired.
// Every "me" endpoint below calls this FIRST and returns 401 on null —
// the game never gets to assert its own user id.
export async function requireUser(req, res) {
  const supabase = clientFor(req);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    res.status(401).json({ error: 'authentication_required' });
    return null;
  }
  return { supabase, userId: data.user.id };
}

// Same as requireUser, but additionally verifies the caller's OWN profile
// has role='admin' before returning — reads that role via the caller's own
// forwarded token (RLS-safe, not something the client can spoof), and 403s
// anyone who isn't. Every admin/moderation endpoint should use this instead
// of requireUser.
export async function requireAdmin(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return null; // requireUser already sent 401
  const { supabase, userId } = auth;
  const { data, error } = await supabase.from('profiles').select('role').eq('id', userId).single();
  if (error || !data || data.role !== 'admin') {
    res.status(403).json({ error: 'admin_privileges_required' });
    return null;
  }
  return auth;
}

// Maps a Postgres/PostgREST error into a short, user-friendly message —
// callers should show this to the player, never the raw error text
// (which can contain table/column names or constraint internals).
export function friendlyError(error) {
  const msg = (error && error.message) || '';
  if (msg.includes('authentication required')) return { status: 401, message: 'Please sign in and try again.' };
  if (msg.includes('admin privileges required')) return { status: 403, message: "You don't have permission to do that." };
  if (msg.includes('not the owner')) return { status: 403, message: "You don't have permission to do that." };
  if (msg.includes('not found')) return { status: 404, message: 'That item is no longer available.' };
  if (msg.includes('too long') || msg.includes('unsupported characters') || msg.includes('cannot be empty')) {
    return { status: 400, message: msg };
  }
  if (msg.includes('structural validation') || msg.includes('violates check constraint')) {
    return { status: 400, message: 'That level data looks invalid — check the title, description, and level contents.' };
  }
  if (msg.includes('duplicate key') || error?.code === '23505') {
    return { status: 409, message: "You've already reported this level." };
  }
  if (msg.includes('removed level')) return { status: 409, message: 'This level was removed and can no longer be edited.' };
  return { status: 500, message: 'Something went wrong on our end. Please try again.' };
}
