// /api/_lib/syncAchievements.js
//
// Called after a like/favorite/play/publish succeeds so a newly-earned
// badge (e.g. "Rising Creator" at 100 plays) shows up immediately instead
// of waiting for the next scheduled refresh. Uses the service-role client
// ONLY to call sync_creator_achievements(), which is itself safe to run
// as often as you like — it only re-derives truth from already-trusted
// counters and never accepts a value from the caller (see
// community_creator_leaderboards.sql). Never let a request path use this
// service client for anything else.
//
// Deliberately swallows its own errors: a failed achievement sync should
// never turn a successful like/play/publish into a failed request for the
// player.

import { serviceClient } from './supabaseClients.js';

export async function syncAchievementsFor(creatorId) {
  if (!creatorId) return;
  try {
    const supabase = serviceClient();
    await supabase.rpc('sync_creator_achievements', { p_creator_id: creatorId });
  } catch (e) {
    console.error('achievement sync failed', creatorId, e);
  }
}
