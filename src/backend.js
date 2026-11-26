import { createClient } from '@supabase/supabase-js';

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const DEMO = !URL_ || !KEY || new URLSearchParams(location.search).has('demo');

const err = (m, code) => Object.assign(new Error(m), { code });

/* =====================================================================
   Истинска база: Supabase
   ===================================================================== */
function supabaseBackend() {
  const sb = createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'crm-auth' } });
  const check = ({ data, error }) => { if (error) throw err(error.message, error.code); return data; };

  async function token() {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token;
  }
  async function api(path, opts = {}) {
    const t = await token();
    const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}`, ...(opts.headers || {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw err(j.error || 'Грешка при връзката', j.code);
    return j;
  }

  return {
    async me() {
      const { data } = await sb.auth.getSession();
      const u = data.session?.user;
      if (!u) return null;
      const { data: p } = await sb.from('profiles').select('*').eq('id', u.id).maybeSingle();
      return p && p.active ? p : { id: u.id, email: u.email, role: null, active: false };
    },
    onAuth(cb) { const { data } = sb.auth.onAuthStateChange((ev) => { if (ev !== 'TOKEN_REFRESHED') cb(ev); }); return () => data.subscription.unsubscribe(); },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw err(/invalid/i.test(error.message) ? 'Грешен имейл или парола' : /banned/i.test(error.message) ? 'Акаунтът е спрян' : error.message);
    },
    async signOut() { await sb.auth.signOut(); },
    async changePassword(pw) { const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw err(error.message); },

    profiles: async () => check(await sb.from('profiles').select('*').order('created_at')),
    imports: async () => check(await sb.from('imports').select('*').order('created_at', { ascending: false })),

    async leads({ view, me, importId, status, search }) {
      let q = sb.from('leads').select('id,full_name,phone,email,status,setter_id,closer_id,import_id,follow_up_at,call_at,lead_created_at,created_at,updated_at');
      if (view === 'free') q = q.is('setter_id', null);
      if (view === 'mine') q = q.eq('setter_id', me.id);
      if (view === 'followups') { q = q.eq('status', 'follow_up'); if (me.role !== 'admin') q = q.eq('setter_id', me.id); }
      if (view === 'calls') q = q.eq('status', 'booked');
      if (importId) q = q.eq('import_id', importId);
      if (status) q = q.eq('status', status);
      if (search) {
        const s = search.replace(/[%,()]/g, ' ').trim();
        if (s) q = q.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`);
      }
      if (view === 'followups') q = q.order('follow_up_at', { ascending: true });
      else if (view === 'calls') q = q.order('call_at', { ascending: true });
      else q = q.order('lead_created_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
      return check(await q.limit(2000));
    },
    lead: async (id) => check(await sb.from('leads').select('*').eq('id', id).maybeSingle()),
    events: async (id) => check(await sb.from('lead_events').select('*').eq('lead_id', id).order('created_at', { ascending: false }).limit(50)),
    async claim(id) { return check(await sb.rpc('claim_lead', { p_lead: id })); },
    async release(id) { return check(await sb.rpc('release_lead', { p_lead: id })); },
    async assign(id, setterId) { check(await sb.rpc('assign_lead', { p_lead: id, p_setter: setterId || null })); },
    async update(id, patch) {
      const rows = check(await sb.from('leads').update(patch).eq('id', id).select('id'));
      if (!rows || !rows.length) throw err('Нямаш права да променяш този лийд');
    },
    async note(id, me, text) { check(await sb.from('lead_events').insert({ lead_id: id, user_id: me.id, type: 'note', data: { text } })); },

    async importLeads(me, { name, fileName }, leads, onProgress) {
      const imp = check(await sb.from('imports').insert({ name, file_name: fileName, created_by: me.id }).select().single());
      let inserted = 0;
      for (let i = 0; i < leads.length; i += 500) {
        const chunk = leads.slice(i, i + 500).map(l => ({ ...l, import_id: imp.id }));
        const rows = check(await sb.from('leads').upsert(chunk, { onConflict: 'external_id', ignoreDuplicates: true }).select('id'));
        inserted += rows ? rows.length : 0;
        onProgress?.(Math.min(i + 500, leads.length), leads.length);
      }
      check(await sb.from('imports').update({ lead_count: inserted }).eq('id', imp.id));
      if (!inserted) check(await sb.from('imports').delete().eq('id', imp.id));
      return { inserted, skipped: leads.length - inserted };
    },
    async deleteImport(id) { check(await sb.from('imports').delete().eq('id', id)); },

    slots: (closerId, start, end, tz) => api(`/api/slots?${new URLSearchParams({ closer_id: closerId, start, end, timeZone: tz })}`),
    book: (leadId, closerId, start, tz) => api('/api/book', { method: 'POST', body: JSON.stringify({ lead_id: leadId, closer_id: closerId, start, timeZone: tz }) }),
    createUser: (u) => api('/api/users', { method: 'POST', body: JSON.stringify(u) }),
    updateUser: (u) => api('/api/users', { method: 'PATCH', body: JSON.stringify(u) })
  };
}

/* =====================================================================
   Демо режим: всичко се пази само в този браузър (за пробване)
   ===================================================================== */
function demoBackend() {
  const KEYS = 'crm-demo-v1';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  const now = () => new Date().toISOString();
  const later = (h) => new Date(Date.now() + h * 3600e3).toISOString();
  const wait = (ms = 120) => new Promise(r => setTimeout(r, ms));
  let listeners = [];

  function seed() {
    const P = [
      { id: 'u-admin', email: 'admin@demo.bg', full_name: 'Вики (админ)', role: 'admin', active: true },
      { id: 'u-set1', email: 'setter@demo.bg', full_name: 'Мария Сетър', role: 'setter', active: true },
      { id: 'u-set2', email: 'setter2@demo.bg', full_name: 'Петър Сетър', role: 'setter', active: true },
      { id: 'u-close', email: 'closer@demo.bg', full_name: 'Алекс Клоузър', role: 'closer', active: true, cal_link: 'demo/razgovor' }
    ].map(p => ({ ...p, created_at: now() }));
    const imp = { id: 'imp-1', name: 'Уебинар 25.11', file_name: 'demo.csv', lead_count: 8, created_at: now() };
    const names = ['Анна Петрова', 'Гергана Иванова', 'Десислава Колева', 'Елена Димитрова', 'Йоана Стоянова', 'Калина Николова', 'Мила Георгиева', 'Ралица Тодорова'];
    const L = names.map((n, i) => ({
      id: 'l-' + (i + 1), import_id: imp.id, external_id: 'demo-' + i, full_name: n, phone: '+35988800000' + i, email: `lead${i + 1}@example.com`,
      answers: [{ q: 'Каква е целта ти?', a: ['−5 кг', 'Повече енергия', 'Да спра сладкото', '−10 кг'][i % 4] }, { q: 'Колко си готова от 1 до 10?', a: String(6 + (i % 5)) }, { q: 'Кое ти е най-трудно?', a: ['Вечерите', 'Нямам време', 'Стресът', 'Почивните дни'][i % 4] }],
      lead_created_at: new Date(Date.now() - i * 3600e3).toISOString(), status: 'new', setter_id: null, claimed_at: null, follow_up_at: null, call_at: null, closer_id: null, notes: '', created_at: now(), updated_at: now()
    }));
    Object.assign(L[1], { setter_id: 'u-set1', status: 'follow_up', follow_up_at: later(20) });
    Object.assign(L[2], { setter_id: 'u-set1', status: 'booked', call_at: later(46), closer_id: 'u-close' });
    Object.assign(L[3], { setter_id: 'u-set2', status: 'no_answer' });
    return { P, I: [imp], L, E: [], pw: Object.fromEntries(P.map(p => [p.email, 'demo1234'])), session: null };
  }
  let S;
  try { S = JSON.parse(localStorage.getItem(KEYS)) || seed(); } catch { S = seed(); }
  const save = () => { try { localStorage.setItem(KEYS, JSON.stringify(S)); } catch { /* demo */ } };
  const me = () => S.P.find(p => p.id === S.session);
  const visible = (l, p) => p.role === 'admin' || (p.role === 'setter' && (!l.setter_id || l.setter_id === p.id)) || (p.role === 'closer' && l.status === 'booked' && l.closer_id === p.id);
  const log = (lead_id, type, data = {}) => S.E.push({ id: S.E.length + 1, lead_id, user_id: S.session, type, data, created_at: now() });

  return {
    demo: true,
    async me() { await wait(30); const p = me(); return p ? (p.active ? p : { ...p, role: null }) : null; },
    onAuth(cb) { listeners.push(cb); return () => { listeners = listeners.filter(x => x !== cb); }; },
    async signIn(email, password) {
      await wait(); const p = S.P.find(x => x.email === email.trim().toLowerCase());
      if (!p || S.pw[p.email] !== password) throw err('Грешен имейл или парола');
      if (!p.active) throw err('Акаунтът е спрян');
      S.session = p.id; save(); listeners.forEach(f => f('SIGNED_IN'));
    },
    async signOut() { S.session = null; save(); listeners.forEach(f => f('SIGNED_OUT')); },
    async changePassword(pw) { S.pw[me().email] = pw; save(); },
    async profiles() { await wait(30); return S.P; },
    async imports() { await wait(30); return S.I.slice().reverse(); },
    async leads({ view, importId, status, search }) {
      await wait(); const p = me(); const s = (search || '').toLowerCase();
      let r = S.L.filter(l => visible(l, p));
      if (view === 'free') r = r.filter(l => !l.setter_id);
      if (view === 'mine') r = r.filter(l => l.setter_id === p.id);
      if (view === 'followups') r = r.filter(l => l.status === 'follow_up' && (p.role === 'admin' || l.setter_id === p.id)).sort((a, b) => a.follow_up_at.localeCompare(b.follow_up_at));
      if (view === 'calls') r = r.filter(l => l.status === 'booked').sort((a, b) => a.call_at.localeCompare(b.call_at));
      if (importId) r = r.filter(l => l.import_id === importId);
      if (status) r = r.filter(l => l.status === status);
      if (s) r = r.filter(l => [l.full_name, l.phone, l.email].some(x => (x || '').toLowerCase().includes(s)));
      return r.map(l => ({ ...l }));
    },
    async lead(id) { await wait(30); const l = S.L.find(x => x.id === id); return l && visible(l, me()) ? { ...l } : null; },
    async events(id) { await wait(30); return S.E.filter(e => e.lead_id === id).slice().reverse(); },
    async claim(id) { await wait(); const l = S.L.find(x => x.id === id); if (!l || l.setter_id) return false; l.setter_id = S.session; l.claimed_at = now(); log(id, 'claimed'); save(); return true; },
    async release(id) { await wait(); const l = S.L.find(x => x.id === id); if (!l || l.status === 'booked' || (l.setter_id !== S.session && me().role !== 'admin')) return false; l.setter_id = null; log(id, 'released'); save(); return true; },
    async assign(id, setterId) { const l = S.L.find(x => x.id === id); l.setter_id = setterId || null; log(id, 'assigned', { setter_id: setterId }); save(); },
    async update(id, patch) {
      await wait(); const l = S.L.find(x => x.id === id); const p = me();
      if (!l || (p.role !== 'admin' && l.setter_id !== p.id && l.closer_id !== p.id)) throw err('Нямаш права да променяш този лийд');
      const prev = l.status; Object.assign(l, patch, { updated_at: now() });
      if (l.status !== 'follow_up') l.follow_up_at = null;
      if (patch.status && patch.status !== prev || patch.follow_up_at) log(id, 'status', { from: prev, to: l.status, follow_up_at: l.follow_up_at });
      save();
    },
    async note(id, _me, text) { log(id, 'note', { text }); save(); },
    async importLeads(_me, { name, fileName }, leads, onProgress) {
      await wait(300); const imp = { id: uid(), name, file_name: fileName, lead_count: 0, created_at: now() };
      const ids = new Set(S.L.map(l => l.external_id)); let n = 0;
      for (const l of leads) { if (l.external_id && ids.has(l.external_id)) continue; S.L.push({ ...l, id: uid(), import_id: imp.id, status: 'new', setter_id: null, notes: '', created_at: now(), updated_at: now() }); ids.add(l.external_id); n++; }
      imp.lead_count = n; if (n) S.I.push(imp); onProgress?.(leads.length, leads.length); save();
      return { inserted: n, skipped: leads.length - n };
    },
    async deleteImport(id) { S.I = S.I.filter(i => i.id !== id); S.L = S.L.filter(l => l.import_id !== id); save(); },
    async slots(_c, start, end) {
      await wait(250); const data = {}; const d = new Date(start + 'T00:00:00'); const e = new Date(end + 'T00:00:00');
      for (; d <= e; d.setDate(d.getDate() + 1)) {
        if (d.getDay() === 0) continue;
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        data[k] = [10, 12, 14, 16, 18].map(h => { const x = new Date(d); x.setHours(h, 0, 0, 0); return { start: x.toISOString() }; }).filter(x => new Date(x.start) > new Date());
      }
      return { data };
    },
    async book(leadId, closerId, start) {
      await wait(400); const l = S.L.find(x => x.id === leadId);
      Object.assign(l, { status: 'booked', call_at: start, closer_id: closerId, follow_up_at: null, updated_at: now() });
      log(leadId, 'booked', { call_at: start, closer_id: closerId }); save(); return { ok: true, call_at: start };
    },
    async createUser(u) {
      await wait(); if (S.P.some(p => p.email === u.email.toLowerCase())) throw err('Вече има акаунт с този имейл');
      if ((u.password || '').length < 8) throw err('Паролата трябва да е поне 8 символа');
      const p = { id: uid(), email: u.email.toLowerCase(), full_name: u.full_name, role: u.role, active: true, cal_link: u.cal_link || null, created_at: now() };
      S.P.push(p); S.pw[p.email] = u.password; save(); return { ok: true };
    },
    async updateUser(u) {
      await wait(); const p = S.P.find(x => x.id === u.id);
      if (u.id === S.session && (u.active === false || (u.role && u.role !== 'admin'))) throw err('Не можеш да спреш или понижиш собствения си акаунт');
      ['full_name', 'role', 'active', 'cal_link'].forEach(k => { if (k in u) p[k] = u[k]; });
      if (u.password) S.pw[p.email] = u.password; save(); return { ok: true };
    },
    resetDemo() { S = seed(); save(); location.reload(); }
  };
}

export const db = DEMO ? demoBackend() : supabaseBackend();
