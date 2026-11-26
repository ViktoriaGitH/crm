import { createClient } from '@supabase/supabase-js';

export const CAL_API = 'https://api.cal.com/v2';

export function admin() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Object.assign(new Error('Server is not configured'), { status: 500 });
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Проверява кой праща заявката (по токена от логина) и връща профила му
export async function caller(req, sb) {
  const h = req.headers.authorization || req.headers.Authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) throw Object.assign(new Error('Not signed in'), { status: 401 });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw Object.assign(new Error('Not signed in'), { status: 401 });
  const { data: p } = await sb.from('profiles').select('*').eq('id', data.user.id).maybeSingle();
  if (!p || !p.active) throw Object.assign(new Error('No access'), { status: 403 });
  return p;
}

export async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = []; for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

export function fail(res, e) {
  const status = e.status || 500;
  if (status >= 500) console.error(e);
  return res.status(status).json({ error: e.message || 'Error', code: e.code });
}

// "https://cal.com/user/slug" или "user/slug" → { username, slug }
export function parseCalLink(link) {
  if (!link) return null;
  const s = String(link).trim().replace(/^(https?:\/\/)?(www\.)?(app\.)?cal\.com\//i, '').replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '');
  const [username, slug] = s.split('/');
  return username && slug ? { username, slug } : null;
}

export function validTz(tz) {
  try { if (tz) { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } } catch { /* fall through */ }
  return 'Europe/Sofia';
}
