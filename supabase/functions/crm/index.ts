// Сървърна част на CRM-а (Supabase Edge Function).
// Действия: status, setup (първи админ), create_user, update_user, slots, book
import { createClient } from 'npm:@supabase/supabase-js@2';

const CAL_API = 'https://api.cal.com/v2';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
class HttpError extends Error { constructor(public status: number, message: string, public code?: string) { super(message); } }
const fail = (status: number, message: string, code?: string) => { throw new HttpError(status, message, code); };

const ROLES = ['admin', 'setter', 'closer'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

async function caller(req: Request, sb: ReturnType<typeof admin>) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) fail(401, 'Не си влязъл');
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) fail(401, 'Не си влязъл');
  const { data: p } = await sb.from('profiles').select('*').eq('id', data!.user!.id).maybeSingle();
  if (!p || !p.active) fail(403, 'Нямаш достъп');
  return p;
}

function parseCalLink(link?: string | null) {
  if (!link) return null;
  const s = String(link).trim().replace(/^(https?:\/\/)?(www\.)?(app\.)?cal\.com\//i, '').replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '');
  const [username, slug] = s.split('/');
  return username && slug ? { username, slug } : null;
}
function validTz(tz?: string) {
  try { if (tz) { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } } catch { /* default */ }
  return 'Europe/Sofia';
}
const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

async function createAuthUser(sb: ReturnType<typeof admin>, b: Record<string, unknown>, role: string) {
  const email = clip(b.email, 200).toLowerCase();
  const full_name = clip(b.full_name, 120);
  const password = String(b.password || '');
  if (!EMAIL.test(email)) fail(400, 'Невалиден имейл');
  if (password.length < 8) fail(400, 'Паролата трябва да е поне 8 символа');
  if (!full_name) fail(400, 'Въведи име');
  const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) fail(409, 'Вече има акаунт с този имейл');
    fail(400, error.message);
  }
  const { error: e2 } = await sb.from('profiles').upsert({
    id: data!.user!.id, email, full_name, role, active: true,
    cal_link: b.cal_link ? clip(b.cal_link, 300) : null
  });
  if (e2) throw e2;
  return data!.user!.id;
}

async function calBook(payload: Record<string, unknown>) {
  const r = await fetch(`${CAL_API}/bookings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'cal-api-version': '2026-02-25' }, body: JSON.stringify(payload)
  });
  return { r, j: await r.json().catch(() => ({})) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  try {
    const sb = admin();
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || '');

    // ---- без вход ----
    if (action === 'status') {
      const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true });
      return json({ needs_setup: !count });
    }
    if (action === 'setup') {
      const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true });
      if (count) fail(403, 'Системата вече е настроена. Влез с акаунта си.');
      const id = await createAuthUser(sb, b, 'admin');
      // защита при едновременни опити: само най-ранният акаунт остава админ
      const { data: first } = await sb.from('profiles').select('id').order('created_at', { ascending: true }).order('id').limit(1).maybeSingle();
      if (first?.id !== id) {
        await sb.auth.admin.deleteUser(id);
        fail(403, 'Системата вече е настроена. Влез с акаунта си.');
      }
      return json({ ok: true });
    }

    // ---- с вход ----
    const me = await caller(req, sb);

    if (action === 'create_user') {
      if (me.role !== 'admin') fail(403, 'Само админ може да създава акаунти');
      const id = await createAuthUser(sb, b, ROLES.includes(String(b.role)) ? String(b.role) : 'setter');
      return json({ ok: true, id });
    }

    if (action === 'update_user') {
      if (me.role !== 'admin') fail(403, 'Само админ може да променя акаунти');
      const id = String(b.id || '');
      if (!id) fail(400, 'Липсва потребител');
      if (id === me.id && (b.active === false || (b.role && b.role !== 'admin'))) fail(400, 'Не можеш да спреш или понижиш собствения си акаунт');
      const patch: Record<string, unknown> = {};
      if (typeof b.full_name === 'string' && b.full_name.trim()) patch.full_name = clip(b.full_name, 120);
      if (ROLES.includes(String(b.role))) patch.role = b.role;
      if (typeof b.active === 'boolean') patch.active = b.active;
      if ('cal_link' in b) patch.cal_link = b.cal_link ? clip(b.cal_link, 300) : null;
      if (Object.keys(patch).length) { const { error } = await sb.from('profiles').update(patch).eq('id', id); if (error) throw error; }
      const authPatch: Record<string, unknown> = {};
      if (b.password) { if (String(b.password).length < 8) fail(400, 'Паролата трябва да е поне 8 символа'); authPatch.password = String(b.password); }
      if (typeof b.active === 'boolean') authPatch.ban_duration = b.active ? 'none' : '876000h';
      if (Object.keys(authPatch).length) { const { error } = await sb.auth.admin.updateUserById(id, authPatch); if (error) throw error; }
      return json({ ok: true });
    }

    if (action === 'slots') {
      const DATE = /^\d{4}-\d{2}-\d{2}$/;
      if (!b.closer_id || !DATE.test(b.start || '') || !DATE.test(b.end || '')) fail(400, 'Невалидна заявка');
      const { data: c } = await sb.from('profiles').select('cal_link, active').eq('id', b.closer_id).maybeSingle();
      const cal = c && c.active && parseCalLink(c.cal_link);
      if (!cal) fail(400, 'Клоузърът още няма свързан Cal.com линк', 'no_cal');
      const url = `${CAL_API}/slots?` + new URLSearchParams({ eventTypeSlug: cal!.slug, username: cal!.username, start: b.start, end: b.end, timeZone: validTz(b.timeZone) });
      const r = await fetch(url, { headers: { 'cal-api-version': '2024-09-04' } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { console.error('cal slots', r.status, JSON.stringify(j).slice(0, 500)); fail(502, 'Cal.com не отговори'); }
      return json({ data: j.data || {} });
    }

    if (action === 'book') {
      const start = new Date(b.start);
      if (!b.lead_id || !b.closer_id || isNaN(+start) || start <= new Date()) fail(400, 'Невалидна заявка');
      const { data: lead } = await sb.from('leads').select('*').eq('id', b.lead_id).maybeSingle();
      if (!lead) fail(404, 'Лийдът не е намерен');
      if (me.role !== 'admin' && !(me.role === 'setter' && lead.setter_id === me.id)) fail(403, 'Този лийд не е твой');
      if (lead.status === 'booked') fail(409, 'Лийдът вече има записан разговор', 'already_booked');
      const { data: closer } = await sb.from('profiles').select('*').eq('id', b.closer_id).maybeSingle();
      const cal = closer && closer.active && parseCalLink(closer.cal_link);
      if (!cal) fail(400, 'Клоузърът още няма свързан Cal.com линк', 'no_cal');

      const answers = Array.isArray(lead.answers) ? lead.answers : [];
      const notes = [`Сетър: ${me.full_name || me.email}`, lead.phone ? `Телефон: ${lead.phone}` : null,
        ...answers.map((x: { q: string; a: string }) => `${x.q}: ${x.a}`)].filter(Boolean).join('\n').slice(0, 1900);
      const attendee: Record<string, unknown> = { name: lead.full_name || 'Лийд', timeZone: validTz(b.timeZone) };
      if (lead.email) attendee.email = lead.email;
      if (lead.phone && /^\+\d{8,15}$/.test(lead.phone)) attendee.phoneNumber = lead.phone;
      const payload = { start: start.toISOString(), eventTypeSlug: cal!.slug, username: cal!.username, attendee,
        bookingFieldsResponses: { notes }, metadata: { lead_id: String(lead.id), source: 'crm' } };

      let { r, j } = await calBook({ ...payload, attendee: { ...attendee, language: 'bg' } });
      if (!r.ok && r.status === 400 && /language/i.test(JSON.stringify(j))) ({ r, j } = await calBook(payload));
      if (!r.ok) {
        const t = JSON.stringify(j);
        console.error('cal booking', r.status, t.slice(0, 800));
        if (r.status === 409 || /not available|already has booking|no available users/i.test(t)) fail(409, 'Този час току-що беше зает', 'slot_taken');
        if (/email/i.test(t) && !lead.email) fail(400, 'Cal.com изисква имейл — добави имейл на лийда', 'need_email');
        fail(502, 'Cal.com не прие записването');
      }
      const call_at = j?.data?.start || start.toISOString();
      const { error } = await sb.from('leads').update({ status: 'booked', call_at, closer_id: closer.id, booking_uid: j?.data?.uid || null, follow_up_at: null }).eq('id', lead.id);
      if (error) throw error;
      await sb.from('lead_events').insert({ lead_id: lead.id, user_id: me.id, type: 'booked', data: { call_at, closer_id: closer.id } });
      return json({ ok: true, call_at, closer_id: closer.id });
    }

    fail(400, 'Непознато действие');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error(e);
    return json({ error: 'Сървърна грешка' }, 500);
  }
  return json({ error: 'unreachable' }, 500);
});
