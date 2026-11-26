import { admin, caller, body, fail, parseCalLink, validTz, CAL_API } from './_lib.js';

async function calBook(payload) {
  const r = await fetch(`${CAL_API}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cal-api-version': '2026-02-25' },
    body: JSON.stringify(payload)
  });
  return { r, j: await r.json().catch(() => ({})) };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'method' }); }
    const sb = admin();
    const me = await caller(req, sb);
    const b = await body(req);
    const start = new Date(b.start);
    if (!b.lead_id || !b.closer_id || isNaN(start) || start <= new Date()) throw Object.assign(new Error('Bad request'), { status: 400 });

    const { data: lead } = await sb.from('leads').select('*').eq('id', b.lead_id).maybeSingle();
    if (!lead) throw Object.assign(new Error('Лийдът не е намерен'), { status: 404 });
    if (me.role !== 'admin' && !(me.role === 'setter' && lead.setter_id === me.id)) {
      throw Object.assign(new Error('Този лийд не е твой'), { status: 403 });
    }
    if (lead.status === 'booked') throw Object.assign(new Error('Лийдът вече има записан разговор'), { status: 409, code: 'already_booked' });

    const { data: closer } = await sb.from('profiles').select('*').eq('id', b.closer_id).maybeSingle();
    const cal = closer && closer.active && parseCalLink(closer.cal_link);
    if (!cal) throw Object.assign(new Error('Клоузърът няма свързан Cal.com линк'), { status: 400, code: 'no_cal' });

    const answers = Array.isArray(lead.answers) ? lead.answers : [];
    const summary = [
      `Сетър: ${me.full_name || me.email}`,
      lead.phone ? `Телефон: ${lead.phone}` : null,
      ...answers.map(x => `${x.q}: ${x.a}`)
    ].filter(Boolean).join('\n').slice(0, 1900);

    const attendee = { name: lead.full_name || 'Лийд', timeZone: validTz(b.timeZone) };
    if (lead.email) attendee.email = lead.email;
    if (lead.phone && /^\+\d{8,15}$/.test(lead.phone)) attendee.phoneNumber = lead.phone;

    const payload = {
      start: start.toISOString(), eventTypeSlug: cal.slug, username: cal.username, attendee,
      bookingFieldsResponses: { notes: summary },
      metadata: { lead_id: String(lead.id), source: 'crm' }
    };
    let { r, j } = await calBook({ ...payload, attendee: { ...attendee, language: 'bg' } });
    if (!r.ok && r.status === 400 && /language/i.test(JSON.stringify(j))) ({ r, j } = await calBook(payload));
    if (!r.ok) {
      const t = JSON.stringify(j);
      console.error('cal booking', r.status, t.slice(0, 800));
      if (r.status === 409 || /not available|already has booking|no available users/i.test(t)) {
        throw Object.assign(new Error('Този час току-що беше зает'), { status: 409, code: 'slot_taken' });
      }
      if (/email/i.test(t) && !lead.email) throw Object.assign(new Error('Cal.com изисква имейл — добави имейл на лийда'), { status: 400, code: 'need_email' });
      throw Object.assign(new Error('Cal.com не прие записването'), { status: 502 });
    }
    const booking = j.data || {};
    const call_at = booking.start || start.toISOString();
    const { error } = await sb.from('leads').update({
      status: 'booked', call_at, closer_id: closer.id, booking_uid: booking.uid || null, follow_up_at: null
    }).eq('id', lead.id);
    if (error) throw error;
    await sb.from('lead_events').insert({ lead_id: lead.id, user_id: me.id, type: 'booked', data: { call_at, closer_id: closer.id } });
    return res.status(200).json({ ok: true, call_at, closer_id: closer.id });
  } catch (e) { return fail(res, e); }
}
