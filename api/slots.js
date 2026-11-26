import { admin, caller, fail, parseCalLink, validTz, CAL_API } from './_lib.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method' }); }
    const sb = admin();
    await caller(req, sb);
    const { closer_id, start, end, timeZone } = req.query || {};
    if (!closer_id || !DATE.test(start || '') || !DATE.test(end || '')) throw Object.assign(new Error('Bad request'), { status: 400 });
    const { data: c } = await sb.from('profiles').select('cal_link, active, role').eq('id', closer_id).maybeSingle();
    const cal = c && c.active && parseCalLink(c.cal_link);
    if (!cal) throw Object.assign(new Error('Клоузърът няма свързан Cal.com линк'), { status: 400, code: 'no_cal' });
    const url = `${CAL_API}/slots?` + new URLSearchParams({ eventTypeSlug: cal.slug, username: cal.username, start, end, timeZone: validTz(timeZone) });
    const r = await fetch(url, { headers: { 'cal-api-version': '2024-09-04' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error('cal slots', r.status, JSON.stringify(j).slice(0, 500)); throw Object.assign(new Error('Cal.com не отговори'), { status: 502 }); }
    return res.status(200).json({ data: j.data || {} });
  } catch (e) { return fail(res, e); }
}
