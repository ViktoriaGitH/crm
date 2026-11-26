import { useEffect, useMemo, useState } from 'react';
import { db } from './backend.js';
import { Av, Badge, Icon, relWhen, useToast } from './ui.jsx';
import { go } from './App.jsx';

const ORDER = ['new', 'answered', 'no_answer', 'wrong_number', 'follow_up', 'booked'];
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export default function HomePage({ me }) {
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [fus, setFus] = useState([]);
  const [calls, setCalls] = useState([]);
  const [people, setPeople] = useState([]);
  const [imports, setImports] = useState([]);
  const [grabbing, setGrabbing] = useState(false);
  const isAdmin = me.role === 'admin';

  const load = () => {
    db.stats().then(setSt).catch(e => { toast(e.message, true); setSt({ total: 0, free: 0, by_status: {}, mine_by_status: {}, setters: [], imports: [] }); });
    db.leads({ view: 'followups', me, limit: 50 }).then(setFus).catch(() => {});
    db.leads({ view: 'calls', me, limit: 50 }).then(setCalls).catch(() => {});
    db.profiles().then(setPeople).catch(() => {});
    db.imports().then(setImports).catch(() => {});
  };
  useEffect(() => { load(); const t = setInterval(() => { if (!document.hidden) load(); }, 60000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => Object.fromEntries(people.map(p => [p.id, p])), [people]);
  const d = useMemo(() => {
    if (!st) return null;
    const counts = isAdmin ? st.by_status || {} : st.mine_by_status || {};
    const c = Object.fromEntries(ORDER.map(s => [s, Number(counts[s] || 0)]));
    const mineTotal = Object.values(c).reduce((a, b) => a + b, 0);
    const worked = mineTotal - c.new;
    const endToday = new Date(); endToday.setHours(23, 59, 59, 999);
    const dueFu = fus.filter(l => new Date(l.follow_up_at) <= endToday);
    const nextCalls = calls.filter(l => new Date(l.call_at) >= new Date(Date.now() - 3600e3));
    const board = people.filter(p => p.role === 'setter' && p.active).map(p => {
      const x = (st.setters || []).find(r => r.id === p.id) || {};
      return { p, taken: +x.taken || 0, worked: +x.worked || 0, booked: +x.booked || 0, conv: pct(+x.booked || 0, +x.worked || 0) };
    }).sort((a, b) => b.booked - a.booked || b.worked - a.worked);
    const webs = imports.map(i => { const x = (st.imports || []).find(r => r.id === i.id) || {}; return { i, total: +x.total || 0, free: +x.free || 0, worked: +x.worked || 0, booked: +x.booked || 0 }; });
    return { counts: c, mineTotal, worked, booked: c.booked, dueFu, nextCalls, board, webs, total: +st.total || 0, free: +st.free || 0 };
  }, [st, fus, calls, people, imports, isAdmin]);

  async function grabNext() {
    setGrabbing(true);
    try {
      const free = await db.leads({ view: 'free', me, limit: 15 });
      for (const l of free) {
        if (await db.claim(l.id)) { toast('Лийдът е твой — звънни!'); go(`leads/${l.id}`); setGrabbing(false); return; }
      }
      toast('Няма свободни лийдове в момента', true);
    } catch (e) { toast(e.message, true); }
    setGrabbing(false); load();
  }

  const h = new Date().getHours();
  const hello = h < 12 ? 'Добро утро' : h < 18 ? 'Добър ден' : 'Добър вечер';
  if (!d) return <><div className="loading-row" /><div className="loading-row" /><div className="loading-row" /></>;
  const maxCount = Math.max(1, ...Object.values(d.counts));

  return (
    <>
      <div className="page-head">
        <div><h1>{hello}, {me.full_name.split(' ')[0]}</h1><p>{isAdmin ? 'Обобщение на всички лийдове и екипа.' : 'Твоят ден с един поглед.'}</p></div>
        {me.role === 'setter' && <button className="btn primary" disabled={grabbing || !d.free} onClick={grabNext}><Icon name="phone" size={16} />{grabbing ? 'Взимам…' : 'Вземи следващия лийд'}</button>}
      </div>

      <div className="kpis">
        {isAdmin ? <>
          <Kpi label="Лийдове общо" value={d.total} />
          <Kpi label="Свободни" value={d.free} hint="чакат сетър" accent={d.free > 0} />
          <Kpi label="Обработени" value={d.worked} hint={`${pct(d.worked, d.total)}% от всички`} />
          <Kpi label="Записани разговори" value={d.booked} hint={`${pct(d.booked, d.worked)}% конверсия`} />
        </> : <>
          <Kpi label="Свободни за взимане" value={d.free} accent={d.free > 0} />
          <Kpi label="Мои лийдове" value={d.mineTotal} />
          <Kpi label="Фолоу ъпи днес" value={d.dueFu.length} hint={d.dueFu.some(l => new Date(l.follow_up_at) < new Date()) ? 'има просрочени' : ''} />
          <Kpi label="Записани разговори" value={d.booked} hint={`${pct(d.booked, d.worked)}% конверсия`} />
        </>}
      </div>

      <div className="dash-grid">
        <section className="card box">
          <div className="row"><h2 className="h2 grow">Фолоу ъпи за днес</h2><a href="#/followups" className="link-sm">Всички →</a></div>
          {d.dueFu.length === 0 ? <p className="faint small-p">Няма фолоу ъпи за днес.</p> :
            <ul className="mini-list">{d.dueFu.slice(0, 6).map(l => { const w = relWhen(l.follow_up_at); return (
              <li key={l.id}><a href={`#/followups/${l.id}`}><span className="grow"><b>{l.full_name}</b>{isAdmin && byId[l.setter_id] && <span className="faint"> · {byId[l.setter_id].full_name}</span>}</span><span className={`when ${w.cls}`}>{w.text}</span></a></li>); })}</ul>}
        </section>
        <section className="card box">
          <div className="row"><h2 className="h2 grow">Следващи разговори</h2><a href="#/calls" className="link-sm">Всички →</a></div>
          {d.nextCalls.length === 0 ? <p className="faint small-p">Няма предстоящи разговори.</p> :
            <ul className="mini-list">{d.nextCalls.slice(0, 6).map(l => { const w = relWhen(l.call_at); return (
              <li key={l.id}><a href={`#/calls/${l.id}`}><span className="grow"><b>{l.full_name}</b>{byId[l.closer_id] && <span className="faint"> · {byId[l.closer_id].full_name}</span>}</span><span className="when">{w.text}</span></a></li>); })}</ul>}
        </section>

        <section className="card box">
          <h2 className="h2">Статуси{isAdmin ? '' : ' на моите лийдове'}</h2>
          <div className="bars">
            {ORDER.map(s => (
              <div key={s} className="bar-row">
                <Badge status={s} />
                <div className="bar"><div className={`fill st-${s}`} style={{ width: `${(d.counts[s] / maxCount) * 100}%` }} /></div>
                <b>{d.counts[s]}</b>
              </div>
            ))}
          </div>
        </section>

        {isAdmin && (
          <section className="card box">
            <h2 className="h2">Сетъри</h2>
            {d.board.length === 0 ? <p className="faint small-p">Още няма сетъри. Създай ги в „Екип“.</p> : (
              <div className="tscroll"><table className="table compact">
                <thead><tr><th>Сетър</th><th>Взети</th><th>Обработени</th><th>Записани</th><th>Конв.</th></tr></thead>
                <tbody>{d.board.map((r, i) => (
                  <tr key={r.p.id} style={{ cursor: 'default' }}><td><span className="setter-chip">{i === 0 && r.booked > 0 ? <span className="crown" aria-label="Първи">1</span> : <Av name={r.p.full_name} />}{r.p.full_name}</span></td>
                    <td>{r.taken}</td><td>{r.worked}</td><td><b>{r.booked}</b></td><td>{r.conv}%</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        )}

        {isAdmin && d.webs.length > 0 && (
          <section className="card box span2">
            <h2 className="h2">Уебинари</h2>
            <div className="tscroll"><table className="table compact">
              <thead><tr><th>Уебинар</th><th>Лийдове</th><th>Свободни</th><th>Обработени</th><th>Записани</th><th>Конв.</th></tr></thead>
              <tbody>{d.webs.map(w => (
                <tr key={w.i.id} style={{ cursor: 'default' }}><td><b>{w.i.name}</b></td><td>{w.total}</td><td>{w.free}</td><td>{w.worked} <span className="faint">({pct(w.worked, w.total)}%)</span></td><td><b>{w.booked}</b></td><td>{pct(w.booked, w.worked)}%</td></tr>
              ))}</tbody>
            </table></div>
          </section>
        )}
      </div>
    </>
  );
}

function Kpi({ label, value, hint, accent }) {
  return <div className={`kpi ${accent ? 'accent' : ''}`}><span>{label}</span><b>{value}</b>{hint ? <small>{hint}</small> : <small>&nbsp;</small>}</div>;
}

