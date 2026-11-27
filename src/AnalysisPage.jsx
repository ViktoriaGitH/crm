import { useEffect, useMemo, useState } from 'react';
import { db } from './backend.js';
import { money, useToast } from './ui.jsx';
import SalesPage from './SalesPage.jsx';

const TABS = [['funnel', 'Фуния и конверсия'], ['team', 'Екип'], ['sales', 'Продажби и печалба']];
const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');

export default function AnalysisPage() {
  const toast = useToast();
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('crm-an') || 'funnel'; } catch { return 'funnel'; } });
  const [st, setSt] = useState(null);
  const [people, setPeople] = useState([]);
  const [imports, setImports] = useState([]);
  useEffect(() => { try { sessionStorage.setItem('crm-an', tab); } catch { /* ignore */ } }, [tab]);
  const load = () => {
    db.stats().then(setSt).catch(e => toast(e.message, true));
    db.profiles().then(setPeople).catch(() => {});
    db.imports().then(setImports).catch(() => {});
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="page-head">
        <div><h1>Анализ</h1><p>Всички числа на едно място.</p></div>
        <div className="tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      </div>
      {!st ? <><div className="loading-row" /><div className="loading-row" /></> :
        tab === 'funnel' ? <Funnel st={st} imports={imports} /> :
        tab === 'team' ? <Team st={st} people={people} /> :
        <SalesPage st={st} reload={load} />}
    </>
  );
}

function Funnel({ st, imports }) {
  const b = st.by_status || {}, s = st.sales || {};
  const total = +st.total || 0;
  const worked = total - (+b.new || 0);
  const reached = (+b.answered || 0) + (+b.follow_up || 0) + (+b.booked || 0);
  const booked = +b.booked || 0;
  const held = (+s.closed || 0) + (+s.not_closed || 0);
  const closed = +s.closed || 0;
  const steps = [
    ['Лийдове', total, null],
    ['Обработени (звънено)', worked, pct(worked, total)],
    ['Вдигнали', reached, pct(reached, worked)],
    ['Записани срещи', booked, pct(booked, reached)],
    ['Проведени срещи', held, pct(held, booked - (+s.pending || 0) - (+s.rescheduled || 0))],
    ['Затворени', closed, pct(closed, held)]
  ];
  const max = Math.max(total, 1);
  const webs = imports.map(i => ({ i, ...((st.imports || []).find(r => r.id === i.id) || {}) }));
  return (
    <>
      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat"><b>{pct(booked, total)}</b><span>лийд → среща</span></div>
        <div className="stat"><b>{pct(closed, held)}</b><span>close rate (от проведени)</span></div>
        <div className="stat"><b>{pct(closed, total)}</b><span>лийд → продажба</span></div>
        <div className="stat"><b>{+b.no_answer || 0}</b><span>не вдигнали (за повторно звънене)</span></div>
      </div>
      <div className="card box" style={{ marginBottom: 16 }}>
        <p className="sec-t">Фуния</p>
        <div className="funnel">
          {steps.map(([l, n, r]) => (
            <div key={l} className="f-row"><span className="f-l">{l}</span>
              <div className="f-bar"><div style={{ width: `${Math.max((n / max) * 100, n ? 2 : 0)}%` }} /></div>
              <b className="f-n">{n}</b><span className="f-r">{r ? `${r} от предишната` : ''}</span></div>
          ))}
        </div>
        <span className="faint" style={{ fontSize: 13 }}>Сега: {+b.new || 0} нови · {+b.no_answer || 0} не вдигнали · {+b.wrong_number || 0} грешен номер · {+b.disqualified || 0} неквалифицирани · {+b.follow_up || 0} фолоу ъп · {+s.pending || 0} срещи чакат резултат</span>
      </div>
      <div className="card">
        <div className="box"><p className="sec-t" style={{ margin: 0 }}>По уебинар / източник</p></div>
        <div className="box table-scroll"><table className="table compact"><thead><tr><th>Източник</th><th>Лийдове</th><th>Обработени</th><th>Срещи</th><th>Затворени</th><th>Лийд → продажба</th><th>Платено</th></tr></thead><tbody>
          {webs.length === 0 ? <tr><td colSpan={7} className="faint">Още няма импорти.</td></tr> : webs.map(({ i, ...x }) =>
            <tr key={i.id}><td>{i.name}</td><td>{x.total || 0}</td><td>{x.worked || 0} ({pct(x.worked || 0, x.total)})</td><td>{x.booked || 0}</td><td>{x.closed || 0}</td><td>{pct(x.closed || 0, x.total)}</td><td><b>{money(x.net)}</b></td></tr>)}
        </tbody></table></div>
      </div>
    </>
  );
}

function Team({ st, people }) {
  const name = useMemo(() => Object.fromEntries(people.map(p => [p.id, p.full_name])), [people]);
  const setters = (st.setters || []).slice().sort((a, b) => (b.booked || 0) - (a.booked || 0));
  const closers = (st.closers || []).slice().sort((a, b) => (+b.net || 0) - (+a.net || 0));
  return (
    <div className="dash-2">
      <div className="card">
        <div className="box"><p className="sec-t" style={{ margin: 0 }}>Сетъри</p></div>
        <div className="box table-scroll"><table className="table compact"><thead><tr><th>Име</th><th>Взети</th><th>Обработени</th><th>Срещи</th><th>Лийд → среща</th><th>Затворени</th></tr></thead><tbody>
          {setters.length === 0 ? <tr><td colSpan={6} className="faint">Още няма взети лийдове.</td></tr> : setters.map(x =>
            <tr key={x.id}><td>{name[x.id] || '—'}</td><td>{x.taken}</td><td>{x.worked}</td><td>{x.booked}</td><td>{pct(x.booked, x.worked)}</td><td>{x.closed || 0}</td></tr>)}
        </tbody></table></div>
      </div>
      <div className="card">
        <div className="box"><p className="sec-t" style={{ margin: 0 }}>Клоузъри</p></div>
        <div className="box table-scroll"><table className="table compact"><thead><tr><th>Име</th><th>Срещи</th><th>Не се яви</th><th>Затворени</th><th>Close rate</th><th>Платено</th></tr></thead><tbody>
          {closers.length === 0 ? <tr><td colSpan={6} className="faint">Още няма срещи.</td></tr> : closers.map(x => {
            const held = (x.booked || 0) - (x.no_show || 0);
            return <tr key={x.id}><td>{name[x.id] || '—'}</td><td>{x.booked}</td><td>{x.no_show || 0}</td><td>{x.closed || 0}</td><td>{pct(x.closed || 0, held)}</td><td><b>{money(x.net)}</b></td></tr>;
          })}
        </tbody></table></div>
      </div>
    </div>
  );
}
