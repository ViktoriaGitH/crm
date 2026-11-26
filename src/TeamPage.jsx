import { useEffect, useMemo, useState } from 'react';
import { db } from './backend.js';
import { Av, Modal, ROLE, useToast } from './ui.jsx';

export default function TeamPage({ me }) {
  const toast = useToast();
  const [people, setPeople] = useState(null);
  const [st, setSt] = useState(null);
  const [edit, setEdit] = useState(null);     // {} = нов, профил = редакция

  const load = () => {
    db.profiles().then(setPeople).catch(e => toast(e.message, true));
    db.stats().then(setSt).catch(() => {});
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => Object.fromEntries(((st && st.setters) || []).map(x => [x.id, x])), [st]);
  const bs = (st && st.by_status) || {};

  return (
    <>
      <div className="page-head">
        <div><h1>Екип</h1><p>Създавай акаунти за сетъри и клоузъри. Те влизат с имейла и паролата, които им дадеш.</p></div>
        <button className="btn primary" onClick={() => setEdit({})}>+ Нов акаунт</button>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat"><b>{st ? st.total : '…'}</b><span>лийда общо</span></div>
        <div className="stat"><b>{st ? st.free : '…'}</b><span>свободни</span></div>
        <div className="stat"><b>{bs.booked || 0}</b><span>записани разговора</span></div>
        <div className="stat"><b>{bs.follow_up || 0}</b><span>фолоу ъпа</span></div>
      </div>

      <div className="card">
        {people === null && <div className="loading-row" />}
        {people?.map(p => {
          const ps = stats[p.id] || {};
          return (
            <div key={p.id} className={`box row team-row ${p.active ? '' : 'off'}`}>
              <Av name={p.full_name} />
              <div className="grow">
                <div className="row" style={{ gap: 8 }}><b>{p.full_name}</b><span className={`role-tag ${p.role}`}>{ROLE[p.role]}</span>{!p.active && <span className="role-tag">спрян</span>}{p.id === me.id && <span className="faint" style={{ fontSize: 13 }}>(ти)</span>}</div>
                <div className="faint" style={{ fontSize: 13 }}>
                  {p.email}
                  {p.role === 'setter' && ` · взети ${ps.taken || 0} · обработени ${ps.worked || 0} · записани ${ps.booked || 0}`}
                  {p.role === 'closer' && (p.cal_link ? ' · Cal.com свързан' : ' · ⚠ няма Cal.com линк')}{p.role === 'admin' && p.cal_link && ' · провежда разговори (Cal.com свързан)'}
                </div>
              </div>
              <button className="btn sm" onClick={() => setEdit(p)}>Редактирай</button>
            </div>
          );
        })}
      </div>

      <CalSync />

      {edit && <UserForm user={edit} me={me} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </>
  );
}

function UserForm({ user, me, onClose, onSaved }) {
  const toast = useToast();
  const isNew = !user.id;
  const [f, setF] = useState({ full_name: user.full_name || '', email: user.email || '', role: user.role || 'setter', cal_link: user.cal_link || '', password: '', active: user.active !== false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const genPw = () => {
    const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const r = crypto.getRandomValues(new Uint32Array(12));
    setF({ ...f, password: Array.from(r, x => a[x % a.length]).join('') });
  };

  async function save(e) {
    e.preventDefault(); setError('');
    const cl = f.cal_link.trim().replace(/^(https?:\/\/)?(www\.)?(app\.)?cal\.com\//i, '').replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '');
    if (cl && !/^[^/\s]+\/[^/\s]+$/.test(cl)) { setError('Cal.com линкът трябва да е към конкретно събитие: cal.com/потребител/събитие (например cal.com/ime/razgovor). Копирай го от Event Types → линка на събитието.'); return; }
    setBusy(true);
    try {
      if (isNew) await db.createUser({ full_name: f.full_name, email: f.email, role: f.role, cal_link: f.cal_link, password: f.password });
      else await db.updateUser({ id: user.id, full_name: f.full_name, role: f.role, cal_link: f.cal_link, active: f.active, ...(f.password ? { password: f.password } : {}) });
      toast(isNew ? 'Акаунтът е създаден' : 'Запазено');
      onSaved();
    } catch (x) { setError(x.message); }
    setBusy(false);
  }

  return (
    <Modal title={isNew ? 'Нов акаунт' : 'Редакция на акаунт'} onClose={onClose}>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="field">Име<input className="input" value={f.full_name} onChange={set('full_name')} required maxLength={120} /></label>
        <label className="field">Имейл (за вход)<input className="input" type="email" value={f.email} onChange={set('email')} required disabled={!isNew} /></label>
        <label className="field">Роля
          <select className="input" value={f.role} onChange={set('role')} disabled={user.id === me.id}>
            <option value="setter">Сетър — взима и звъни на лийдове</option>
            <option value="closer">Клоузър — провежда записаните разговори</option>
            <option value="admin">Админ — пълен достъп</option>
          </select>
        </label>
        {(f.role === 'closer' || f.role === 'admin') && (
          <label className="field">{f.role === 'admin' ? 'Cal.com линк (ако и ти провеждаш разговори)' : 'Cal.com линк на клоузъра'}
            <input className="input" value={f.cal_link} onChange={set('cal_link')} placeholder="cal.com/ime/razgovor" />
            <span className="faint" style={{ fontWeight: 400 }}>Линкът към събитието, в което сетърите записват разговори.</span>
          </label>
        )}
        <label className="field">{isNew ? 'Парола' : 'Нова парола (по желание)'}
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="input" type="text" autoComplete="new-password" value={f.password} onChange={set('password')} required={isNew} minLength={8} placeholder="поне 8 символа" />
            <button type="button" className="btn" onClick={genPw}>Генерирай</button>
          </div>
          {f.password && <span className="faint" style={{ fontWeight: 400 }}>Копирай я и я дай на човека — после няма да се вижда.</span>}
        </label>
        {!isNew && user.id !== me.id && (
          <label className="q-item"><input type="checkbox" checked={f.active} onChange={set('active')} /><span>Активен (може да влиза)</span></label>
        )}
        {error && <div className="err" role="alert">{error}</div>}
        <div className="row"><button className="btn primary grow" disabled={busy}>{busy ? 'Запазвам…' : isNew ? 'Създай акаунта' : 'Запази'}</button><button type="button" className="btn" onClick={onClose}>Отказ</button></div>
      </form>
    </Modal>
  );
}

function CalSync() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [needKey, setNeedKey] = useState(false);
  const [key, setKey] = useState('');
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  async function sync() {
    setBusy(true); setErr('');
    try { const r = await db.calSync(); setRes(r); toast(`Отбелязани ${r.marked + r.updated} лийда`); }
    catch (e) { if (e.code === 'no_key') setNeedKey(true); else setErr(e.message); }
    setBusy(false);
  }
  async function saveKey(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await db.calKey(key); setKey(''); setNeedKey(false); setBusy(false); return sync(); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  }
  const fmtD = s => new Intl.DateTimeFormat('bg-BG', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(s));
  return (
    <div className="card box" style={{ marginTop: 16 }}>
      <div className="row"><div className="grow"><b>Синхронизация с Cal.com</b><div className="faint" style={{ fontSize: 13 }}>Намира разговорите, записани в Cal.com, и по телефон или имейл отбелязва лийдовете като „Записан разговор“ с датата и часа им.</div></div>
        <button className="btn primary" disabled={busy} onClick={sync}>{busy ? 'Синхронизирам…' : 'Синхронизирай'}</button></div>
      {(needKey) && (
        <form onSubmit={saveKey} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <span style={{ fontSize: 14 }}>Трябва Cal.com API ключ (веднъж): Cal.com → Settings → Developer → API Keys → „New“ → копирай ключа (започва с <code>cal_live_</code>). Пази се само на сървъра.</span>
          <div className="row" style={{ flexWrap: 'nowrap' }}><input className="input" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="cal_live_…" required /><button className="btn primary" disabled={busy}>Запази</button></div>
        </form>
      )}
      {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
      {res && (
        <div style={{ marginTop: 12 }}>
          <div className="stats">
            <div className="stat"><b>{res.total}</b><span>разговора в Cal.com</span></div>
            <div className="stat"><b>{res.marked}</b><span>нови отбелязани</span></div>
            <div className="stat"><b>{res.updated}</b><span>с обновен час</span></div>
            <div className="stat"><b>{res.same}</b><span>вече бяха точни</span></div>
          </div>
          {res.unmatched_count > 0 && (
            <details style={{ marginTop: 10 }}><summary className="muted" style={{ cursor: 'pointer', fontSize: 14 }}>{res.unmatched_count} разговора без лийд в CRM-а (друг телефон/имейл или не са от уебинара)</summary>
              <div style={{ fontSize: 13, marginTop: 6 }}>{res.unmatched.map((u, i) => <div key={i} className="faint">{fmtD(u.start)} · {u.name || '—'} {u.email && `· ${u.email}`} {u.phone && `· тел. ${u.phone}`}</div>)}</div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
