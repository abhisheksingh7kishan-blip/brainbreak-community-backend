// /api/health.js
//
// GET /api/health
// Quick way to confirm (from a phone browser, no tools needed) that env
// vars are set and Supabase is reachable, right after deploying. Never
// returns key values — only whether each is present, and whether a basic
// public query succeeds.

import { clientFor } from './_lib/supabaseClients.js';

export default async function handler(req, res) {
  const envOk = {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  let dbOk = false;
  let dbError = null;
  try {
    const supabase = clientFor(req);
    const { error } = await supabase.rpc('get_creator_leaderboard', { p_category: 'most_played', p_page: 1, p_limit: 1 });
    if (error) throw error;
    dbOk = true;
  } catch (e) {
    dbError = e.message;
  }

  const allOk = Object.values(envOk).every(Boolean) && dbOk;
  return res.status(allOk ? 200 : 500).json({ ok: allOk, env: envOk, database: dbOk, dbError });
}
