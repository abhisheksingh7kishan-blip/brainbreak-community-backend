// /api/cron/refresh-leaderboard.js
//
// Called on a schedule (see vercel.json) to refresh
// public.creator_leaderboard_cache — a materialized view, which Postgres
// never updates on its own. Without this running periodically, "Worldwide
// Creators" would keep showing the numbers from whenever the view was
// last refreshed, forever.
//
// Uses the service-role key deliberately — refresh_creator_leaderboard_cache()
// is intentionally NOT granted to anon/authenticated (see
// community_creator_leaderboards.sql), so only this trusted, scheduled,
// secret-protected endpoint can trigger it.
//
// Vercel Hobby plan cron jobs run at most once per day — the schedule in
// vercel.json defaults to once daily, which is fine for a new/small
// Community World. On a Pro plan (or using a free external scheduler like
// cron-job.org pointed at this same URL+secret), you can safely call this
// far more often — the refresh itself is cheap and this handler is
// idempotent.

import { serviceClient } from '../_lib/supabaseClients.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  // Vercel auto-provisions CRON_SECRET and sends it as this header when
  // IT triggers the job. Rejects anyone else who finds/guesses this URL.
  const auth = req.headers.authorization || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const supabase = serviceClient();
    const { error } = await supabase.rpc('refresh_creator_leaderboard_cache');
    if (error) throw error;
    return res.status(200).json({ ok: true, refreshedAt: new Date().toISOString() });
  } catch (error) {
    console.error('leaderboard cache refresh failed', error);
    return res.status(500).json({ ok: false });
  }
}
