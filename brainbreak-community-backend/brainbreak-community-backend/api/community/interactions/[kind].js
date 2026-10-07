// POST /api/community/interactions/like      { levelId, active }
// POST /api/community/interactions/favorite  { levelId, active }
// Handles both routes. Your existing play.js keeps working (a static file beats a [kind] route).
// If your package.json has "type": "module", change the first line to  import { createClient } from '@supabase/supabase-js';
// and the last export to  export default async function handler(req, res) { ... }
const { createClient } = require('@supabase/supabase-js');

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  // The game runs from a different origin than this API, so CORS is required.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const kind = String((req.query && req.query.kind) || '').toLowerCase();
  if (kind !== 'like' && kind !== 'favorite') return res.status(404).json({ error: 'Unknown interaction' });

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign-in required' });
  const { data: u, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !u || !u.user) return res.status(401).json({ error: 'Invalid session' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const levelId = body && body.levelId;
  if (!levelId || !UUID.test(levelId) || typeof body.active !== 'boolean') return res.status(400).json({ error: 'levelId and active are required' });

  const { data, error } = await admin.rpc('community_set_reaction', { p_level: levelId, p_user: u.user.id, p_kind: kind, p_active: body.active });
  if (error) { console.error('reaction failed', error); return res.status(500).json({ error: "Couldn't save that — try again." }); }
  const row = Array.isArray(data) ? data[0] : data;
  return res.status(200).json({ ok: true, kind, active: row.active, likes: row.likes, favorites: row.favorites });
};
  
