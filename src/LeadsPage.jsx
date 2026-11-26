import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from './backend.js';
import { Av, Badge, Icon, Modal, STATUS, fmt, money, relWhen, useToast } from './ui.jsx';
import { normPhone } from './importer.js';
import LeadPanel from './LeadPanel.jsx';
import { go } from './App.jsx';

const TITLES = {
  leads: ['Лийдове', 'Вземи лийд, звънни и отбележи какво стана.'],
  followups: ['Фолоу ъпи', 'Кого да потърсиш отново и кога.'],
  calls: ['Срещи · клоузър', 'Записаните срещи. Отбележи какво стана: затворена, какъв пакет, не се яви.']
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
  const [layout, setLayout] = useState(() => { try { return localStorage.getItem('crm-layout') || 'board'; } catch { return 'board'; } });
  useEffect(() => { try { localStorage.setItem('crm-layout', layout); } catch { /* ignore */ } }, [layout]);
  const board = view === 'leads' || view === 'calls';
  const [newLead, setNewLead] = useState(false);
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
    e.preventDefault(); e.stopPropagation();
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
    ? [['all', 'Всички'], ['free', 'Свободни'], ['mine', 'Моите'], ['taken', 'Взети']]
    : [['free', 'Свободни'], ['mine', 'Моите']];
  let shown = rows || [];

  const whenCol = view === 'followups' ? 'follow_up_at' : view === 'calls' ? 'call_at' : null;
  const emptyText = {
    free: ['Няма свободни лийдове', 'Когато се импортират нови, ще се появят тук.'],
    mine: ['Още нямаш лийдове', 'Отвори „Свободни“ и натисни „Взимам“.'],
    followups: ['Няма фолоу ъпи', 'Когато отбележиш „Фолоу ъп“, ще се появи тук.'],
    calls: ['Няма записани разговори', 'Записаните разговори ще се появят тук.']
  }[view === 'leads' ? tab : view] || ['Няма лийдове', 'Опитай с други филтри.'];

  if (openId) {
    return <LeadPanel key={openId} id={openId} me={me} profiles={profiles} imports={impById} onClose={close} onChanged={changed} page />;
  }

  const claimBtn = (r, cls = '') => !r.setter_id && r.status !== 'booked' && me.role !== 'closer'
    ? <button className={`btn primary sm ${cls}`} disabled={busyId === r.id} onClick={e => quickClaim(e, r)}>Взимам лийда</button> : null;

  return (
    <>
      <div className="page-head">
        <div><h1>{title}</h1><p>{sub}</p></div>
        <div className="row">
        {isAdmin && (view === 'leads' || view === 'calls') && <div className="tabs" role="tablist" aria-label="Роля"><button role="tab" aria-selected={view === 'leads'} className={view === 'leads' ? 'on' : ''} onClick={() => go('leads')}>Сетър</button><button role="tab" aria-selected={view === 'calls'} className={view === 'calls' ? 'on' : ''} onClick={() => go('calls')}>Клоузър</button></div>}
        {tabs && <select className="input" style={{ width: 'auto' }} value={tab} onChange={e => setTab(e.target.value)} aria-label="Кои лийдове">{tabs.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
        </div>
      </div>

      <div className="filters">
        <input className="input search" type="search" placeholder="Търси по име, телефон или имейл" value={search} onChange={e => setSearch(e.target.value)} aria-label="Търсене" />
        {view === 'leads' && !board && (
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

      {board && (
        <div className="board">
          {(view === 'calls' ? CLOSER_COLS : BOARD).map(st => {
            const list = (rows || []).filter(view === 'calls' ? r => closerStage(r) === st : r => r.status === st);
            return (
              <div key={st} className={`col st-${st}`}>
                <div className="col-head"><span className="dot" /><b>{view === 'calls' ? STAGE[st] : st === 'booked' ? 'Записан' : STATUS[st]}</b><span className="cnt">{rows ? list.length : '…'}</span></div>
                <div className="col-body">
                  {rows === null ? <div className="loading-row" /> : list.length === 0 ? <div className="col-empty">—</div> : list.map(r => {
                    const person = byId[r.setter_id];
                    const wait = !r.setter_id && r.status === 'new' ? waited(r.lead_created_at || r.created_at) : null;
                    const when = st === 'follow_up' ? r.follow_up_at : (st === 'booked' || st === 'upcoming' || st === 'await') ? r.call_at : null;
                    const src = r.source || impById[r.import_id]?.name;
                    return (
                      <a key={r.id} className="kcard" href={`#/${view}/${r.id}`}>
                        <div className="k-top"><b>{r.full_name}</b>
                          {person ? <span className="k-av" title={person.full_name}>{initials2(person.full_name)}</span> : wait && <span className="k-wait">чака {wait}</span>}</div>
                        <span className="k-contact">{maskPhone(r, me)}{r.email ? ' · ' + r.email : ''}</span>
                        {when && <span className={`when ${relWhen(when).cls}`}>{st === 'follow_up' ? 'Звънни: ' : 'Среща: '}{relWhen(when).text}</span>}
                        {r.outcome === 'closed' && <span className="k-money">{money(r.sale_price - (r.discount || 0))}{+r.discount ? <s> {money(r.sale_price)}</s> : null}</span>}
                        {src && <span className="k-src"><span>Източник</span><b>{src}</b></span>}
                        {claimBtn(r, 'k-claim')}
                      </a>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {board && hasMore && <div className="more"><button className="btn sm" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Зареждам…' : `Покажи още (показани ${rows.length})`}</button></div>}

      {!board && <>
      <div className="card table-wrap">
        {rows === null ? <><div className="loading-row" /><div className="loading-row" /><div className="loading-row" /></> :
          shown.length === 0 ? <div className="empty"><b>{emptyText[0]}</b>{emptyText[1]}</div> : (
            <table className="table">
              <thead><tr>
                {whenCol && <th>{view === 'calls' ? 'Разговор' : 'Кога'}</th>}
                <th>Лийд</th><th>Имейл · телефон</th><th className="sr">Действие</th><th>Статус</th>
                {view === 'calls' && <th>Клоузър</th>}
              </tr></thead>
              <tbody>
                {shown.map(r => {
                  const w = whenCol && relWhen(r[whenCol]);
                  const person = view === 'calls' ? byId[r.closer_id] : byId[r.setter_id];
                  return (
                    <tr key={r.id} onClick={e => { if (e.ctrlKey || e.metaKey) window.open(`#/${view}/${r.id}`, '_blank'); else open(r.id); }} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') open(r.id); }}>
                      {whenCol && <td><span className={`when ${w.cls}`}>{w.text}</span></td>}
                      <td className="name-cell"><a href={`#/${view}/${r.id}`} onClick={e => e.stopPropagation()}><b>{r.full_name}</b></a></td>
                      <td className="muted contact-cell">{r.email || ''}{r.email && r.phone ? ' · ' : ''}{r.phone ? maskPhone(r, me) : ''}</td>
                      <td>{claimBtn(r) || (person && view !== 'calls' ? <span className="setter-chip"><Av name={person.full_name} />{person.full_name.split(' ')[0]}</span> : null)}</td>
                      <td><Badge status={r.status} /></td>
                      {view === 'calls' && <td>{person?.full_name || '—'}</td>}
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
                    {!r.setter_id && me.role !== 'closer'
                      ? <button className="btn primary sm" disabled={busyId === r.id} onClick={e => quickClaim(e, r)}>Взимам</button>
                      : person ? <span className="setter-chip"><Av name={person.full_name} />{person.full_name.split(' ')[0]}</span> : <span className="free-chip">свободен</span>}
                  </div>
                </div>
              );
            })}
        {hasMore && <button className="btn" disabled={loadingMore} onClick={loadMore}>{loadingMore ? 'Зареждам…' : 'Покажи още'}</button>}
      </div>
      </>}
    </>
  );
}

const CLOSER_COLS = ['upcoming', 'await', 'closed', 'not_closed', 'no_show', 'rescheduled'];
const STAGE = { upcoming: 'Предстоящи', await: 'Чака резултат', closed: 'Затворени', not_closed: 'Не затворени', no_show: 'Не се яви', rescheduled: 'Пренасрочени' };
const closerStage = r => r.outcome || (r.call_at && new Date(r.call_at) > new Date() ? 'upcoming' : 'await');

function NewLead({ onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ full_name: '', phone: '', email: '', source: '' });
  const [busy, setBusy] = useState(false); const [e, setE] = useState('');
  const set = k => ev => setF({ ...f, [k]: ev.target.value });
  async function save(ev) {
    ev.preventDefault(); setE('');
    if (!f.phone.trim() && !f.email.trim()) { setE('Въведи телефон или имейл'); return; }
    setBusy(true);
    try { const id = await db.createLead({ ...f, phone: normPhone(f.phone), email: f.email.trim().toLowerCase() }); toast('Лийдът е добавен'); onDone(id); }
    catch (x) { setE(x.message); setBusy(false); }
  }
  return (
    <Modal title="Нов лийд" onClose={onClose}>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="field">Име<input className="input" value={f.full_name} onChange={set('full_name')} required maxLength={200} autoFocus /></label>
        <label className="field">Телефон<input className="input" value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="0888 123 456" /></label>
        <label className="field">Имейл<input className="input" type="email" value={f.email} onChange={set('email')} /></label>
        <label className="field">Откъде е дошъл<input className="input" value={f.source} onChange={set('source')} list="src-list" placeholder="Instagram, препоръка, TikTok…" maxLength={80} />
          <datalist id="src-list">{['Instagram', 'Facebook', 'TikTok', 'Препоръка', 'Уебинар', 'Сайт'].map(x => <option key={x} value={x} />)}</datalist></label>
        {e && <div className="err">{e}</div>}
        <div className="row"><button className="btn primary grow" disabled={busy}>{busy ? 'Добавям…' : 'Добави'}</button><button type="button" className="btn" onClick={onClose}>Отказ</button></div>
      </form>
    </Modal>
  );
}

const BOARD = ['new', 'answered', 'no_answer', 'wrong_number', 'follow_up', 'booked'];
const initials2 = n => String(n || '').split(/\s+/).map(w => (w.match(/\p{L}/u) || [''])[0]).join('').slice(0, 2).toUpperCase();
function waited(t) {
  const h = (Date.now() - new Date(t)) / 36e5;
  if (!(h >= 0)) return null;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} мин` : h < 48 ? `${Math.round(h)} ч` : `${Math.round(h / 24)} дни`;
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
