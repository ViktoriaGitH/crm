import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from './backend.js';
import { TZ, fmtLong, useToast } from './ui.jsx';

const MONTHS = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
const pad = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const hm = new Intl.DateTimeFormat('bg-BG', { hour: '2-digit', minute: '2-digit', hour12: false });

export default function Booking({ lead, profiles, onBooked }) {
  const toast = useToast();
  const closers = useMemo(() => profiles.filter(p => p.role === 'closer' && p.active && p.cal_link), [profiles]);
  const [closerId, setCloserId] = useState(closers[0]?.id || '');
  const [mo, setMo] = useState(0);
  const [slots, setSlots] = useState(null);
  const [err, setErr] = useState('');
  const [day, setDay] = useState(null);
  const [slot, setSlot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const req = useRef(0);

  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + mo, 1);
  const y = first.getFullYear(), m = first.getMonth();
  const daysIn = new Date(y, m + 1, 0).getDate();
  const lead0 = (first.getDay() + 6) % 7;

  useEffect(() => {
    if (!closerId) return;
    const id = ++req.current;
    setSlots(null); setErr(''); setSlot(null);
    const start = mo === 0 ? ymd(now.getFullYear(), now.getMonth(), now.getDate()) : ymd(y, m, 1);
    db.slots(closerId, start, ymd(y, m, daysIn), TZ).then(j => {
      if (id !== req.current) return;
      const map = {};
      Object.entries(j.data || {}).forEach(([k, list]) => {
        const xs = (list || []).map(s => (typeof s === 'string' ? s : s?.start)).filter(Boolean).filter(s => new Date(s) > new Date());
        if (xs.length) map[k] = xs;
      });
      setSlots(map);
      setDay(d => (d && map[d] ? d : Object.keys(map).sort()[0] || null));
    }).catch(e => { if (id === req.current) { setErr(e.message); setSlots({}); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closerId, mo, reload]);

  async function book() {
    if (!slot) return;
    setBusy(true);
    try {
      const r = await db.book(lead.id, closerId, slot, TZ);
      toast(`Записан разговор: ${fmtLong(r.call_at || slot)}`);
      onBooked?.();
    } catch (e) {
      toast(e.message, true);
      if (e.code === 'slot_taken') setReload(r => r + 1);
    }
    setBusy(false);
  }

  if (!closers.length) {
    return <div className="err">Няма клоузър със свързан Cal.com линк. Админът трябва да го добави в „Екип“.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <b>Избери час при клоузъра</b>
      {closers.length > 1 && (
        <select className="input" value={closerId} onChange={e => { setCloserId(e.target.value); setDay(null); }} aria-label="Клоузър">
          {closers.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
        </select>
      )}
      {closers.length === 1 && <span className="muted" style={{ fontSize: 14, marginTop: -6 }}>Клоузър: {closers[0].full_name}</span>}

      <div className="cal-nav">
        <button className="icon-btn" onClick={() => { setMo(mo - 1); setDay(null); }} disabled={mo <= 0} aria-label="Предишен месец">‹</button>
        <b aria-live="polite">{MONTHS[m]} {y}</b>
        <button className="icon-btn" onClick={() => { setMo(mo + 1); setDay(null); }} disabled={mo >= 2} aria-label="Следващ месец">›</button>
      </div>
      <div className="g7">{['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'НД'].map(d => <span key={d} className="wd">{d}</span>)}</div>
      <div className="g7">
        {Array.from({ length: lead0 }, (_, i) => <span key={'b' + i} />)}
        {Array.from({ length: daysIn }, (_, i) => {
          const k = ymd(y, m, i + 1); const has = slots && slots[k];
          return <button key={k} className={`day ${day === k ? 'on' : ''}`} disabled={!has} aria-pressed={day === k}
            onClick={() => { setDay(k); setSlot(null); }} style={slots === null ? { opacity: .35 } : undefined}>{i + 1}</button>;
        })}
      </div>
      {err && <div className="err">{err}</div>}
      {slots && !err && !Object.keys(slots).length && <span className="muted" style={{ fontSize: 14 }}>Няма свободни часове този месец.</span>}
      {slots === null && <span className="muted" style={{ fontSize: 14 }}>Зареждам свободните часове…</span>}
      {day && slots?.[day] && (
        <div className="slots">
          {slots[day].map(s => <button key={s} className={`slot ${slot === s ? 'on' : ''}`} aria-pressed={slot === s} onClick={() => setSlot(s)}>{hm.format(new Date(s))}</button>)}
        </div>
      )}
      <button className="btn primary big" disabled={!slot || busy} onClick={book}>
        {busy ? 'Записвам…' : slot ? `Запиши · ${fmtLong(slot)}` : 'Избери ден и час'}
      </button>
    </div>
  );
}
