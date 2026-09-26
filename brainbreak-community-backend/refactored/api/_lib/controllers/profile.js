// /api/_lib/controllers/profile.js
//
// GET/PATCH /api/community/profile/me — logic moved verbatim from the
// original single-purpose file api/community/profile/me.js (deleted; its
// URL now routes here via api/community/[...path].js). No behavior
// change: same RPCs, same validation, same response shape.
//
// GET   -> current creator's own profile (safe to show private-ish fields
//          like created_at, since it's only ever returned to that same user)
// PATCH -> { displayName } -> update_display_name() RPC (validates length/
//          empty/control characters server-side; see community_creator_system_api.sql)
//
// Both resolve identity ONLY from the caller's own access token — nothing
// in the request body is ever used as an id.

import { requireUser, friendlyError } from '../supabaseClients.js';

export async function getProfile(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return; // requireUser already sent 401
  const { supabase, userId } = auth;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, created_at')
    .eq('id', userId)
    .single();

  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }
  return res.status(200).json({
    id: data.id,
    username: data.username,
    displayName: data.display_name || data.username,
    avatarUrl: data.avatar_url,
    createdAt: data.created_at,
  });
}

export async function patchProfile(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const { supabase } = auth;

  const displayName = req.body && req.body.displayName;
  const { data, error } = await supabase.rpc('update_display_name', { p_display_name: displayName });

  if (error) {
    const { status, message } = friendlyError(error);
    return res.status(status).json({ error: message });
  }
  return res.status(200).json({
    id: data.id,
    username: data.username,
    displayName: data.display_name || data.username,
  });
}
