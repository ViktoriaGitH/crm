import { useCallback, useEffect, useState } from 'react';
import { db } from './backend.js';
import { Av, Badge, Icon, STATUS, fmt, fmtLong, money, toLocalInput, useEsc, useToast } from './ui.jsx';

function ManualBooking({ lead, profiles, onDone }) {
  const toast = useToast();
  const closers = profiles.filter(p => p.active && (p.role === 'closer' || p.role === 'admin'))
    .sort((a, b) => (b.role === 'closer') - (a.role === 'closer') || !!b.cal_link - !!a.cal_link);
  const [closerId, setCloserId] = useState(lead.closer_id || closers[0]?.id || '');
  const [at, setAt] = useState(() => {
    if (lead.call_at) return toLocalInput(new Date(lead.call_at));
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(11, 0, 0, 0); return toLocalInput(d);
  });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!at || !closerId) { toast('Избери дата, час и клоузър', true); return; }
    if (new Date(at) < new Date(Date.now() - 864e5)) { toast('Датата е в миналото', true); return; }
    setBusy(true);
    try { await db.bookManual(lead.id, at, closerId); toast(`Записан разговор: ${fmtLong(new Date(at))}`); onDone(); }
    catch (e) { toast(e.message, true); setBusy(false); }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <b>Кога е разговорът?</b>
      <input className="input" type="datetime-local" value={at} onChange={e => setAt(e.target.value)} aria-label="Дата и час на разговора" />
      {closers.length > 1
        ? <label className="field">С кого<select className="input" value={closerId} onChange={e => setCloserId(e.target.value)}>{closers.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}</select></label>
        : closers[0] && <span className="muted" style={{ fontSize: 14 }}>с {closers[0].full_name}</span>}
      <button className="btn primary big" disabled={busy} onClick={save}>{busy ? 'Записвам…' : 'Запиши разговора'}</button>
    </div>
  );
}

const OUT = { closed: 'Затворена', not_closed: 'Не затворена', no_show: 'Не се яви', rescheduled: 'Пренасрочена' };

function Outcome({ lead, onSaved }) {
  const toast = useToast();
  const [pk, setPk] = useState([]);
  const [o, setO] = useState(lead.outcome || '');
  const [f, setF] = useState({ package_id: lead.package_id || '', sale_price: lead.sale_price ?? '', discount: lead.discount || '', closer_notes: lead.closer_notes || '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { db.packages().then(setPk).catch(() => {}); }, []);
  const net = (+f.sale_price || 0) - (+f.discount || 0);
  async function save(next = o) {
    if (next === 'closed') {
      if (!(+f.sale_price > 0)) { toast('Въведи цена на сделката', true); return; }
      if (+f.discount > +f.sale_price) { toast('Отстъпката е по-голяма от цената', true); return; }
    }
    setBusy(true);
    try {
      await db.update(lead.id, next === 'closed'
        ? { outcome: 'closed', package_id: f.package_id || null, sale_price: +f.sale_price, discount: +f.discount || 0, closer_notes: f.closer_notes }
        : { outcome: next || null, closer_notes: f.closer_notes });
      toast(next ? `Записано: ${OUT[next]}` : 'Запазено'); onSaved();
    } catch (e) { toast(e.message, true); }
    setBusy(false);
  }
  const pick = k => { setO(k); if (k !== 'closed') save(k); };
  return (
    <section>
      <p className="sec-t">Резултат от срещата</p>
      <div className="status-grid">
        {Object.entries(OUT).map(([k, l]) => (
          <button key={k} className={`status-btn out-${k} ${o === k ? 'on' : ''}`} style={{ background: 'var(--surface2)' }} disabled={busy} aria-pressed={o === k} onClick={() => pick(k)}><span className="dot" /><span>{l}</span></button>
        ))}
      </div>
      {o === 'closed' && (
        <div className="sub-box" style={{ marginTop: 10 }}>
          <label className="field">Пакет
            <select className="input" value={f.package_id} onChange={e => { const p = pk.find(x => x.id === e.target.value); setF({ ...f, package_id: e.target.value, sale_price: p ? p.price : f.sale_price }); }}>
              <option value="">— избери пакет —</option>
              {pk.filter(p => p.active || p.id === f.package_id).map(p => <option key={p.id} value={p.id}>{p.name} · {money(p.price)}</option>)}
            </select>
            {!pk.length && <span className="faint" style={{ fontWeight: 400 }}>Още няма пакети. Админът ги добавя в „Продажби“.</span>}
          </label>
          <div className="map-grid">
            <label className="field">Цена (€)<input className="input" type="number" min="0" step="1" inputMode="decimal" value={f.sale_price} onChange={e => setF({ ...f, sale_price: e.target.value })} /></label>
            <label className="field">Отстъпка (€)<input className="input" type="number" min="0" step="1" inputMode="decimal" value={f.discount} onChange={e => setF({ ...f, discount: e.target.value })} /></label>
          </div>
          <b>Платено: {money(net)}</b>
        </div>
      )}
      <label className="field" style={{ marginTop: 10 }}>Бележки от срещата
        <textarea className="input" rows={3} value={f.closer_notes} onChange={e => setF({ ...f, closer_notes: e.target.value })} placeholder="Възражения, какво реши, разсрочено плащане…" maxLength={5000} />
      </label>
      <button className="btn primary" style={{ marginTop: 8 }} disabled={busy} onClick={() => save()}>{busy ? 'Запазвам…' : 'Запази резултата'}</button>
    </section>
  );
}

const ACTIONS = [
  ['answered', 'Вдигна'],
  ['no_answer', 'Не вдигна'],
  ['wrong_number', 'Грешен номер'],
  ['follow_up', 'Фолоу ъп'],
  ['booked', 'Записан разговор']
];

const EV = {
  claimed: () => 'взе лийда',
  released: () => 'освободи лийда',
  assigned: () => 'прехвърли лийда',
  booked: (d) => `записа разговор за ${fmt(d.call_at)}`,
  note: (d) => `бележка: „${d.text}“`,
  outcome: (d) => d.outcome ? `резултат: ${OUT[d.outcome] || d.outcome}${d.sale_price ? ` · ${money(d.sale_price - (d.discount || 0))}` : ''}` : 'изчисти резултата',
  status: (d) => d.to === 'follow_up' ? `фолоу ъп за ${fmt(d.follow_up_at)}` : `статус: ${STATUS[d.to] || d.to}`
};

export default function LeadPanel({ id, me, profiles, imports, onClose, onChanged, page }) {
  const toast = useToast();
  const [lead, setLead] = useState(undefined);
  const [events, setEvents] = useState([]);
  const [mode, setMode] = useState(null);            // 'follow_up' | 'booked' | null
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const [fuAt, setFuAt] = useState('');
  const [askDel, setAskDel] = useState(false);
  useEsc(onClose);

  const byId = Object.fromEntries(profiles.map(p => [p.id, p]));
  const load = useCallback(async () => {
    try {
      const l = await db.lead(id);
      setLead(l);
      if (l) { setNotes(l.notes || ''); db.events(id).then(setEvents).catch(() => {}); }
    } catch { setLead(null); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (page) { window.scrollTo(0, 0); return; } document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, [page]);

  const isAdmin = me.role === 'admin';
  const mine = lead && lead.setter_id === me.id;
  const canEdit = lead && (isAdmin || mine);
  const free = lead && !lead.setter_id;
  const setter = lead && byId[lead.setter_id];
  const closer = lead && byId[lead.closer_id];

  async function run(fn, ok) {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); await load(); onChanged?.(); }
    catch (e) { toast(e.message || 'Грешка', true); }
    setBusy(false);
  }

  const claim = () => run(async () => {
    const r = await db.claim(lead.id);
    if (!r) throw new Error('Някой друг току-що го взе');
  }, 'Лийдът е твой — звънни!');
  const release = () => run(() => db.release(lead.id), 'Лийдът е освободен');
  // админът може да отбелязва директно; ако лийдът е свободен, първо става негов
  const ensureMine = async () => { if (!lead.setter_id && isAdmin) { const ok = await db.claim(lead.id); if (!ok) throw new Error('Някой друг току-що го взе'); } };
  const setStatus = (s) => run(async () => { await ensureMine(); await db.update(lead.id, { status: s }); }, s === 'new' ? 'Статусът е махнат' : `Записано: ${STATUS[s]}`);
  const saveNotes = () => run(async () => { await ensureMine(); await db.update(lead.id, { notes }); }, 'Бележката е запазена');

  function pick(s) {
    if (s === 'follow_up') {
      const d = lead.follow_up_at ? new Date(lead.follow_up_at) : (() => { const x = new Date(); x.setDate(x.getDate() + 1); x.setHours(10, 0, 0, 0); return x; })();
      setFuAt(toLocalInput(d)); setMode(mode === 'follow_up' ? null : 'follow_up'); return;
    }
    if (s === 'booked') { if (mode !== 'booked' && free && isAdmin) run(ensureMine); setMode(mode === 'booked' ? null : 'booked'); return; }
    setMode(null);
    if (lead.status === s) { setStatus('new'); return; }   // второ натискане маха статуса
    setStatus(s);
  }
  function quick(kind) {
    const d = new Date();
    if (kind === '1h') d.setHours(d.getHours() + 1, d.getMinutes(), 0, 0);
    if (kind === '3h') d.setHours(d.getHours() + 3, d.getMinutes(), 0, 0);
    if (kind === 'eve') { d.setHours(18, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); }
    if (kind === 'tom') { d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); }
    if (kind === '2d') { d.setDate(d.getDate() + 2); d.setHours(10, 0, 0, 0); }
    setFuAt(toLocalInput(d));
  }
  function saveFollowUp() {
    const d = new Date(fuAt);
    if (!fuAt || isNaN(d)) { toast('Избери дата и час', true); return; }
    if (d < new Date(Date.now() - 60000)) { toast('Избери час в бъдещето', true); return; }
    run(async () => { await ensureMine(); await db.update(lead.id, { status: 'follow_up', follow_up_at: d.toISOString() }); setMode(null); }, `Фолоу ъп: ${fmt(d)}`);
  }

  useEffect(() => {
    if (!canEdit || !lead || lead.status === 'booked') return;
    const h = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
      const i = Number(e.key) - 1;
      if (i >= 0 && i < ACTIONS.length && !busy) { e.preventDefault(); pick(ACTIONS[i][0]); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast('Копирано'); } catch { /* ignore */ } };
  const showPhone = lead && (!free || isAdmin || me.role !== 'setter');

  return (
    <>
      {!page && <div className="overlay" onClick={onClose} />}
      <aside className={page ? 'panel page' : 'panel'} role={page ? 'main' : 'dialog'} aria-modal={page ? undefined : true} aria-label={lead?.full_name || 'Лийд'}>
        {page && <button className="btn ghost sm back" onClick={onClose}>‹ Назад към лийдовете</button>}
        <div className="panel-head">
          <div className="grow">
            <h2>{lead === undefined ? 'Зареждам…' : lead ? lead.full_name : 'Лийдът не е намерен'}</h2>
            {lead && <div className="row" style={{ marginTop: 8, gap: 8 }}>
              <Badge status={lead.status} />
              {(lead.source || imports[lead.import_id]) && <span className="faint" style={{ fontSize: 13 }}>Източник: {lead.source || imports[lead.import_id].name}</span>}
            </div>}
          </div>
          {!page && <button className="icon-btn" onClick={onClose} aria-label="Затвори"><Icon name="x" /></button>}
        </div>

        {lead === null && <div className="panel-body"><p className="muted">Възможно е друг сетър да го е взел или да нямаш достъп до него.</p></div>}

        {lead && (
          <div className="panel-body">
            {free && (me.role === 'setter' || me.role === 'admin') && (
              <div className="claim-box">
                <b>Този лийд е свободен</b>
                <span className="muted" style={{ fontSize: 14 }}>Вземи го, за да видиш телефона и да отбележиш разговора.</span>
                <button className="btn primary big" disabled={busy} onClick={claim}>Взимам лийда</button>
              </div>
            )}

            {lead.status === 'booked' && (
              <div className="call-card">
                <span className="faint" style={{ fontSize: 13, fontWeight: 600 }}>ЗАПИСАН РАЗГОВОР</span>
                <b>{fmtLong(lead.call_at)}</b>
                {closer && <span className="muted" style={{ fontSize: 14 }}>с {closer.full_name}</span>}
                {(isAdmin || lead.setter_id === me.id) && (mode === 'rebook'
                  ? <div className="sub-box" style={{ marginTop: 8 }}><ManualBooking lead={lead} profiles={profiles} onDone={() => { setMode(null); load(); onChanged?.(); }} /></div>
                  : <button className="btn ghost sm" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={() => setMode('rebook')}>Смени часа</button>)}
              </div>
            )}
            {lead.status === 'follow_up' && lead.follow_up_at && (
              <div className="fu-card">
                <span className="faint" style={{ fontSize: 13, fontWeight: 600 }}>ФОЛОУ ЪП</span>
                <b>{fmtLong(lead.follow_up_at)}</b>
              </div>
            )}

            {lead.status === 'booked' && (isAdmin || lead.closer_id === me.id) && <Outcome lead={lead} onSaved={() => { load(); onChanged?.(); }} />}

            <section>
              <p className="sec-t">Контакт</p>
              <div className="contact">
                <div className="contact-row"><span className="lbl">Име</span><span className="val">{lead.full_name}</span></div>
                <div className="contact-row">
                  <span className="lbl">Телефон</span>
                  {showPhone ? <>
                    <span className="val" style={{ userSelect: 'all' }}>{lead.phone || '—'}</span>
                    {lead.phone && <button className="btn primary sm" onClick={() => copy(lead.phone)}><Icon name="copy" size={15} />Копирай номера</button>}
                  </> : <span className="val masked">{lead.phone ? lead.phone.slice(0, -6) + ' ••• •••' : '—'}</span>}
                </div>
                <div className="contact-row">
                  <span className="lbl">Имейл</span><span className="val">{lead.email || '—'}</span>
                  {lead.email && showPhone && <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => copy(lead.email)} aria-label="Копирай имейла"><Icon name="copy" size={15} /></button>}
                </div>
                <div className="contact-row"><span className="lbl">Получен</span><span className="val">{fmt(lead.lead_created_at || lead.created_at)}</span></div>
                <div className="contact-row"><span className="lbl">Сетър</span>
                  <span className="val">{setter ? <span className="setter-chip"><Av name={setter.full_name} />{setter.full_name}</span> : <span className="faint">свободен</span>}</span>
                  {canEdit && !free && lead.status !== 'booked' && <button className="btn ghost sm" disabled={busy} onClick={release}>Освободи</button>}
                </div>
                {isAdmin && (
                  <label className="contact-row"><span className="lbl">Прехвърли</span>
                    <select className="input" style={{ minHeight: 36, fontSize: 14 }} value={lead.setter_id || ''} disabled={busy || lead.status === 'booked'}
                      onChange={e => run(() => db.assign(lead.id, e.target.value || null), 'Прехвърлен')}>
                      <option value="">— свободен —</option>
                      {profiles.filter(p => p.role !== 'closer' && p.active).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </section>

            {canEdit && lead.status !== 'booked' && (
              <section>
                <div className="row" style={{ alignItems: 'baseline' }}><p className="sec-t grow">Какво стана при разговора?</p>
                  {lead.status !== 'new' && <button className="btn ghost sm" disabled={busy} onClick={() => { setMode(null); setStatus('new'); }}>Махни статуса</button>}</div>
                <div className="status-grid">
                  {ACTIONS.map(([k, label]) => (
                    <button key={k} className={`status-btn st-${k} ${lead.status === k || mode === k ? 'on' : ''} ${k === 'booked' ? 'wide' : ''}`}
                      style={{ background: 'var(--surface2)' }} disabled={busy} aria-pressed={lead.status === k} onClick={() => pick(k)}>
                      <span className="dot" /><span>{label}</span><span className="kbd" aria-hidden="true">{ACTIONS.findIndex(a => a[0] === k) + 1}</span>
                    </button>
                  ))}
                </div>
                {mode === 'follow_up' && (
                  <div className="sub-box" style={{ marginTop: 10 }}>
                    <b>Кога да го потърсиш отново?</b>
                    <div className="chips">
                      {[['1h', 'След 1 час'], ['3h', 'След 3 часа'], ['eve', 'Довечера 18:00'], ['tom', 'Утре 10:00'], ['2d', 'След 2 дни']].map(([k, l]) =>
                        <button key={k} type="button" className="chip" onClick={() => quick(k)}>{l}</button>)}
                    </div>
                    <input className="input" type="datetime-local" value={fuAt} min={toLocalInput(new Date())} onChange={e => setFuAt(e.target.value)} aria-label="Дата и час за фолоу ъп" />
                    <div className="row"><button className="btn primary grow" disabled={busy} onClick={saveFollowUp}>Запази фолоу ъп</button><button className="btn ghost" onClick={() => setMode(null)}>Отказ</button></div>
                  </div>
                )}
                {mode === 'booked' && (
                  <div className="sub-box" style={{ marginTop: 10 }}>
                    <ManualBooking lead={lead} profiles={profiles} onDone={() => { setMode(null); load(); onChanged?.(); }} />
                  </div>
                )}
              </section>
            )}

            <section>
              <p className="sec-t">Анкета</p>
              {Array.isArray(lead.answers) && lead.answers.length ? (
                <div className="qa">{lead.answers.map((x, i) => <div key={i}><b>{x.q}</b><span>{x.a}</span></div>)}</div>
              ) : <p className="faint" style={{ margin: 0, fontSize: 14 }}>Няма отговори от анкета.</p>}
            </section>

            {(canEdit || lead.closer_id === me.id) && (
              <section>
                <p className="sec-t">Бележки</p>
                <textarea className="input" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Какво каза, кога е удобно, възражения…" />
                {notes !== (lead.notes || '') && <div className="row" style={{ marginTop: 8 }}><button className="btn primary" disabled={busy} onClick={saveNotes}>Запази бележката</button><button className="btn ghost" onClick={() => setNotes(lead.notes || '')}>Отказ</button></div>}
              </section>
            )}

            {isAdmin && (
              <section>
                {!askDel ? <button className="btn ghost sm danger" onClick={() => setAskDel(true)}>Изтрий лийда (тестов / грешен)</button> : (
                  <div className="sub-box">
                    <b>Да изтрия ли {lead.full_name}?</b>
                    <span className="muted" style={{ fontSize: 14 }}>Изчезва от списъците и статистиката заедно с историята. Не може да се върне.{lead.booking_uid ? ' Разговорът в Cal.com остава — откажи го там.' : ''}</span>
                    <div className="row"><button className="btn primary grow" disabled={busy} onClick={async () => { setBusy(true); try { await db.deleteLead(lead.id); toast('Лийдът е изтрит'); onChanged?.(); onClose(); } catch (e) { toast(e.message, true); setBusy(false); } }}>Да, изтрий</button><button className="btn" onClick={() => setAskDel(false)}>Отказ</button></div>
                  </div>
                )}
              </section>
            )}

            {events.length > 0 && (
              <section>
                <p className="sec-t">История</p>
                <div className="events">
                  {events.map(e => (
                    <div className="ev" key={e.id}><time>{fmt(e.created_at)}</time>
                      <span><b>{byId[e.user_id]?.full_name || 'Система'}</b> {(EV[e.type] || (() => e.type))(e.data || {})}</span></div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
