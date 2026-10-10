// /api/community/profile/me.js
//
// GET   -> current creator's own profile (safe to show private-ish fields
//          like created_at, since it's only ever returned to that same user)
// PATCH -> { displayName } -> update_display_name() RPC (validates length/
//          empty/control characters server-side; see community_creator_system_api.sql)
//
// Both branches resolve identity ONLY from the caller's own access token —
// nothing in the request body is ever used as an id.

import { clientFor, requireUser, friendlyError, handleCors } from '../../_lib/supabaseClients.js';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  const auth = await requireUser(req, res);
  if (!auth) return; // requireUser already sent 401
  const { supabase, userId } = auth;

  if (req.method === 'GET') {
    // GET /api/community/profile/me?checkName=Foo  ->  { available: true|false }
    // Powers the live "already taken" hint in the game's name box. Your own current name counts as available.
    let checkName = null;
    try { checkName = new URL(req.url, 'http://x').searchParams.get('checkName'); } catch (e) { checkName = null; }
    if (checkName !== null) {
      const { data: free, error: availErr } = await supabase.rpc('is_display_name_available', { p_name: checkName });
      if (availErr) {
        const { status, message } = friendlyError(availErr);
        return res.status(status).json({ error: message });
      }
      return res.status(200).json({ available: free === true, name: checkName });
    }

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

  if (req.method === 'PATCH') {
    const displayName = req.body && req.body.displayName;
    const { data, error } = await supabase.rpc('update_display_name', { p_display_name: displayName });

    if (error) {
      const { status, message, code } = friendlyError(error);
      return res.status(status).json(code ? { error: message, code } : { error: message });
    }
    return res.status(200).json({
      id: data.id,
      username: data.username,
      displayName: data.display_name || data.username,
    });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
             }
    
