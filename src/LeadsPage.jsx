import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from './backend.js';
import { Av, Badge, Icon, STATUS, fmt, fmtDay, relWhen, useToast } from './ui.jsx';
import LeadPanel from './LeadPanel.jsx';
import { go } from './App.jsx';

const TITLES = {
  leads: ['Лийдове', 'Вземи лийд, звънни и отбележи какво стана.'],
  followups: ['Фолоу ъпи', 'Кого да потърсиш отново и кога.'],
  calls: ['Разговори', 'Записаните разговори с клоузъра.']
};

export default function LeadsPage({ me, view, openId, onChanged }) {
  const toast = useToast();
  const isAdmin = me.role === 'admin';
  const defaultTab = view === 'leads' ? (isAdmin ? 'all' : 'free') : view;
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem('crm-tab-' + view) || defaultTab; } catch { return defaultTab; } });
  const [status, setStatus] = useState('');
  const [importId, setImportId] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [imports, setImports] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const reqRef = useRef(0);

  useEffect(() => { const t = setTimeout(() => setQ(search), 250); return () => clearTimeout(t); }, [search]);
  useEffect(() => { try { sessionStorage.setItem('crm-tab-' + view, tab); } catch { /* ignore */ } }, [tab, view]);
  useEffect(() => { db.profiles().then(setProfiles).catch(() => {}); db.imports().then(setImports).catch(() => {}); }, []);

  const PAGE = 500;
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const rowsRef = useRef(null);
  rowsRef.current = rows;
  const v = view === 'leads' ? tab : view;
  const load = useCallback(async (quiet) => {
    const id = ++reqRef.current;
    if (!quiet) setRows(null);
    try {
      // при тихо опресняване презареждаме толкова, колкото вече са показани
      const limit = quiet && rowsRef.current ? Math.max(PAGE, rowsRef.current.length) : PAGE;
      const r = await db.leads({ view: v, me, importId, status, search: q, offset: 0, limit });
      if (id === reqRef.current) { setRows(r); setHasMore(r.length >= limit); setError(''); }
    } catch (e) { if (id === reqRef.current) { setError(e.message); if (!quiet) setRows([]); } }
  }, [v, me, importId, status, q]);
  async function loadMore() {
    setLoadingMore(true);
    try {
      const r = await db.leads({ view: v, me, importId, status, search: q, offset: rows.length, limit: PAGE });
      setRows(x => [...x, ...r.filter(n => !x.some(o => o.id === n.id))]); setHasMore(r.length >= PAGE);
    } catch (e) { toast(e.message, true); }
    setLoadingMore(false);
  }

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(true); }, 30000);
    const f = () => load(true);
    window.addEventListener('focus', f);
    return () => { clearInterval(t); window.removeEventListener('focus', f); };
  }, [load]);

  const byId = useMemo(() => Object.fromEntries(profiles.map(p => [p.id, p])), [profiles]);
  const impById = useMemo(() => Object.fromEntries(imports.map(i => [i.id, i])), [imports]);
  const open = (id) => go(`${view}/${id}`);
  const close = () => go(view);
  const changed = () => { load(true); onChanged?.(); };

  async function quickClaim(e, lead) {
    e.stopPropagation();
    setBusyId(lead.id);
    try {
      const ok = await db.claim(lead.id);
      if (ok) { toast('Лийдът е твой'); changed(); open(lead.id); }
      else { toast('Някой друг току-що го взе', true); load(true); }
    } catch (x) { toast(x.message, true); }
    setBusyId(null);
  }

  const [title, sub] = TITLES[view];
  const tabs = view !== 'leads' ? null : isAdmin
    ? [['all', 'Всички'], ['free', 'Свободни'], ['taken', 'Взети']]
    : [['free', 'Свободни'], ['mine', 'Моите']];
  let shown = rows || [];

  const whenCol = view === 'followups' ? 'follow_up_at' : view === 'calls' ? 'call_at' : null;
  const emptyText = {
    free: ['Няма свободни лийдове', 'Когато се импортират нови, ще се появят тук.'],
    mine: ['Още нямаш лийдове', 'Отвори „Свободни“ и натисни „Взимам“.'],
    followups: ['Няма фолоу ъпи', 'Когато отбележиш „Фолоу ъп“, ще се появи тук.'],
    calls: ['Няма записани разговори', 'Записаните разговори ще се появят тук.']
  }[view === 'leads' ? tab : view] || ['Няма лийдове', 'Опитай с други филтри.'];

  return (
    <>
      <div className="page-head">
        <div><h1>{title}</h1><p>{sub}</p></div>
        <div className="row">
        {isAdmin && rows && rows.length > 0 && <button className="btn" onClick={() => exportCsv(shown, byId, impById)}><Icon name="download" size={16} />Експорт</button>}
        {tabs && <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>}
        </div>
      </div>

      <div className="filters">
        <input className="input search" type="search" placeholder="Търси по име, телефон или имейл" value={search} onChange={e => setSearch(e.target.value)} aria-label="Търсене" />
        {view === 'leads' && (
          <select className="input" value={status} onChange={e => setStatus(e.target.value)} aria-label="Статус">
            <option value="">Всички статуси</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
        {imports.length > 0 && (
          <select className="input" value={importId} onChange={e => setImportId(e.target.value)} aria-label="Уебинар">
            <option value="">Всички уебинари</option>
            {imports.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        )}
      </div>

      {error && <div className="err" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card table-wrap">
        {rows === null ? <><div className="loading-row" /><div className="loading-row" /><div className="loading-row" /></> :
          shown.length === 0 ? <div className="empty"><b>{emptyText[0]}</b>{emptyText[1]}</div> : (
            <table className="table">
              <thead><tr>
                {whenCol && <th>{view === 'calls' ? 'Разговор' : 'Кога'}</th>}
                <th>Лийд</th><th>Статус</th><th>Уебинар</th>
                <th>{view === 'calls' ? 'Клоузър' : 'Сетър'}</th>
                {!whenCol && <th>Получен</th>}
                <th className="sr">Действие</th>
              </tr></thead>
              <tbody>
                {shown.map(r => {
                  const w = whenCol && relWhen(r[whenCol]);
                  const person = view === 'calls' ? byId[r.closer_id] : byId[r.setter_id];
                  return (
                    <tr key={r.id} className={openId === r.id ? 'sel' : ''} onClick={() => open(r.id)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') open(r.id); }}>
                      {whenCol && <td><span className={`when ${w.cls}`}>{w.text}</span></td>}
                      <td className="name-cell"><b>{r.full_name}</b><span>{maskPhone(r, me)}</span></td>
                      <td><Badge status={r.status} /></td>
                      <td className="muted">{impById[r.import_id]?.name || '—'}</td>
                      <td>{person ? <span className="setter-chip"><Av name={person.full_name} />{person.full_name}</span> : <span className="free-chip">свободен</span>}</td>
                      {!whenCol && <td className="muted">{fmtDay(r.lead_created_at || r.created_at)}</td>}
                      <td style={{ textAlign: 'right' }}>
                        {!r.setter_id && me.role === 'setter' && <button className="btn primary sm" disabled={busyId === r.id} onClick={e => quickClaim(e, r)}>Взимам</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        {hasMore && <div className="more"><button className="btn sm" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Зареждам…' : `Покажи още (показани ${rows.length})`}</button></div>}
      </div>

      <div className="cards">
        {rows === null ? <><div className="loading-row" /><div className="loading-row" /></> :
          shown.length === 0 ? <div className="card empty"><b>{emptyText[0]}</b>{emptyText[1]}</div> :
            shown.map(r => {
              const w = whenCol && relWhen(r[whenCol]);
              const person = view === 'calls' ? byId[r.closer_id] : byId[r.setter_id];
              return (
                <div key={r.id} className="lcard" role="button" tabIndex={0} onClick={() => open(r.id)} onKeyDown={e => { if (e.key === 'Enter') open(r.id); }}>
                  <div className="top-line"><b>{r.full_name}</b><Badge status={r.status} /></div>
                  {w && <span className={`when ${w.cls}`}>{view === 'calls' ? 'Разговор: ' : 'Звънни: '}{w.text}</span>}
                  <div className="meta">
                    <span>{maskPhone(r, me)}{impById[r.import_id] ? ' · ' + impById[r.import_id].name : ''}</span>
                    {!r.setter_id && me.role === 'setter'
                      ? <button className="btn primary sm" disabled={busyId === r.id} onClick={e => quickClaim(e, r)}>Взимам</button>
                      : person ? <span className="setter-chip"><Av name={person.full_name} />{person.full_name.split(' ')[0]}</span> : <span className="free-chip">свободен</span>}
                  </div>
                </div>
              );
            })}
        {hasMore && <button className="btn" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Зареждам…' : 'Покажи още'}</button>}
      </div>

      {openId && <LeadPanel key={openId} id={openId} me={me} profiles={profiles} imports={impById} onClose={close} onChanged={changed} />}
    </>
  );
}

// Сетърът вижда телефона едва след като вземе лийда
export function maskPhone(l, me) {
  if (!l.phone) return '—';
  if (me.role === 'setter' && !l.setter_id) return l.phone.slice(0, -6) + ' ••• •••';
  return l.phone;
}

function exportCsv(rows, byId, impById) {
  // защита от формули при отваряне в Excel (=, +, -, @)
  const esc = v => { let x = String(v ?? ''); if (/^[=+\-@\t\r]/.test(x) && !/^\+\d+$/.test(x)) x = "'" + x; return `"${x.replace(/"/g, '""')}"`; };
  const head = ['Име', 'Телефон', 'Имейл', 'Статус', 'Уебинар', 'Сетър', 'Клоузър', 'Фолоу ъп', 'Разговор', 'Получен'];
  const lines = rows.map(r => [r.full_name, r.phone, r.email, STATUS[r.status], impById[r.import_id]?.name, byId[r.setter_id]?.full_name, byId[r.closer_id]?.full_name,
    r.follow_up_at ? fmt(r.follow_up_at) : '', r.call_at ? fmt(r.call_at) : '', fmt(r.lead_created_at || r.created_at)].map(esc).join(','));
  const blob = new Blob(['\uFEFF' + [head.map(esc).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lidove-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
