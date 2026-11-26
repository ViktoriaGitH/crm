import { admin, caller, body, fail } from './_lib.js';

const ROLES = ['admin', 'setter', 'closer'];

export default async function handler(req, res) {
  try {
    const sb = admin();
    const me = await caller(req, sb);
    if (me.role !== 'admin') throw Object.assign(new Error('Only admin'), { status: 403 });

    if (req.method === 'POST') {
      const b = await body(req);
      const email = String(b.email || '').trim().toLowerCase();
      const full_name = String(b.full_name || '').trim().slice(0, 120);
      const role = ROLES.includes(b.role) ? b.role : 'setter';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Невалиден имейл'), { status: 400 });
      if (String(b.password || '').length < 8) throw Object.assign(new Error('Паролата трябва да е поне 8 символа'), { status: 400 });
      if (!full_name) throw Object.assign(new Error('Въведи име'), { status: 400 });
      const { data, error } = await sb.auth.admin.createUser({
        email, password: String(b.password), email_confirm: true, user_metadata: { full_name }
      });
      if (error) {
        const dup = /already|registered|exists/i.test(error.message);
        throw Object.assign(new Error(dup ? 'Вече има акаунт с този имейл' : error.message), { status: dup ? 409 : 400 });
      }
      const { error: e2 } = await sb.from('profiles').upsert({
        id: data.user.id, email, full_name, role, active: true, cal_link: b.cal_link ? String(b.cal_link).trim() : null
      });
      if (e2) throw e2;
      return res.status(200).json({ ok: true, id: data.user.id });
    }

    if (req.method === 'PATCH') {
      const b = await body(req);
      if (!b.id) throw Object.assign(new Error('Missing id'), { status: 400 });
      if (b.id === me.id && (b.active === false || (b.role && b.role !== 'admin'))) {
        throw Object.assign(new Error('Не можеш да спреш или понижиш собствения си акаунт'), { status: 400 });
      }
      const patch = {};
      if (typeof b.full_name === 'string' && b.full_name.trim()) patch.full_name = b.full_name.trim().slice(0, 120);
      if (ROLES.includes(b.role)) patch.role = b.role;
      if (typeof b.active === 'boolean') patch.active = b.active;
      if ('cal_link' in b) patch.cal_link = b.cal_link ? String(b.cal_link).trim() : null;
      if (Object.keys(patch).length) {
        const { error } = await sb.from('profiles').update(patch).eq('id', b.id);
        if (error) throw error;
      }
      const authPatch = {};
      if (b.password) {
        if (String(b.password).length < 8) throw Object.assign(new Error('Паролата трябва да е поне 8 символа'), { status: 400 });
        authPatch.password = String(b.password);
      }
      if (typeof b.active === 'boolean') authPatch.ban_duration = b.active ? 'none' : '876000h';
      if (Object.keys(authPatch).length) {
        const { error } = await sb.auth.admin.updateUserById(b.id, authPatch);
        if (error) throw error;
      }
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'POST, PATCH');
    return res.status(405).json({ error: 'method' });
  } catch (e) { return fail(res, e); }
}
