import { useCallback, useEffect, useState } from 'react';
import { db, DEMO } from './backend.js';
import { Av, Icon, ROLE, useToast } from './ui.jsx';
import LeadsPage from './LeadsPage.jsx';
import ImportPage from './ImportPage.jsx';
import TeamPage from './TeamPage.jsx';
import HomePage from './HomePage.jsx';
import SalesPage from './SalesPage.jsx';

function useHash() {
  const get = () => (location.hash.replace(/^#\/?/, '') || '').split('/');
  const [h, setH] = useState(get);
  useEffect(() => { const f = () => setH(get()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return h;
}
export const go = (path) => { location.hash = '/' + path; };

function useTheme() {
  const [t, setT] = useState(() => document.documentElement.dataset.theme || 'dark');
  const toggle = () => {
    const n = t === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = n;
    try { localStorage.setItem('crm-theme', n); } catch { /* ignore */ }
    setT(n);
  };
  return [t, toggle];
}

const NAV = {
  admin: [['home', 'Табло', 'home'], ['leads', 'Лийдове', 'leads'], ['followups', 'Фолоу ъпи', 'clock'], ['calls', 'Срещи', 'cal'], ['sales', 'Продажби', 'chart'], ['import', 'Импорт', 'upload'], ['team', 'Екип', 'team']],
  setter: [['home', 'Табло', 'home'], ['leads', 'Лийдове', 'leads'], ['followups', 'Фолоу ъпи', 'clock'], ['calls', 'Разговори', 'cal']],
  closer: [['calls', 'Срещи', 'cal']]
};

export default function App() {
  const [me, setMe] = useState(undefined);
  const [theme, toggleTheme] = useTheme();
  const load = useCallback(async () => { try { setMe(await db.me()); } catch { setMe(null); } }, []);
  useEffect(() => { load(); return db.onAuth(() => load()); }, [load]);

  if (me === undefined) return <div className="login"><div className="brand"><span className="brand-mark">C</span>CRM</div></div>;
  if (!me) return <Login theme={theme} toggleTheme={toggleTheme} />;
  if (!me.role) return <NoAccess />;
  return <Shell me={me} theme={theme} toggleTheme={toggleTheme} />;
}

function Login({ theme, toggleTheme }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [setup, setSetup] = useState(false);
  useEffect(() => { db.needsSetup().then(setSetup); }, []);
  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      if (setup) {
        if (pw.length < 8) throw new Error('Паролата трябва да е поне 8 символа');
        await db.setup({ full_name: name.trim(), email: email.trim(), password: pw });
      } else await db.signIn(email, pw);
    } catch (x) { setError(x.message); setBusy(false); }
  }
  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="row"><div className="brand grow"><span className="brand-mark">C</span>CRM</div>
          <button type="button" className="icon-btn" onClick={toggleTheme} aria-label="Смени темата"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button></div>
        <h1>{setup ? 'Създай админ акаунта' : 'Вход'}</h1>
        {setup && <p className="muted" style={{ margin: '-6px 0 0', fontSize: 14 }}>Първоначална настройка. Това ще е твоят акаунт с пълен достъп. После от „Екип“ създаваш сетъри и клоузъри.</p>}
        {setup && <label className="field">Твоето име<input className="input" value={name} onChange={e => setName(e.target.value)} required autoComplete="name" /></label>}
        <label className="field">Имейл<input className="input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></label>
        <label className="field">Парола<input className="input" type="password" autoComplete={setup ? 'new-password' : 'current-password'} minLength={setup ? 8 : undefined} value={pw} onChange={e => setPw(e.target.value)} required /></label>
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn primary big" disabled={busy}>{busy ? 'Момент…' : setup ? 'Създай и влез' : 'Влез'}</button>
        <p className="faint" style={{ margin: 0, fontSize: 13, textAlign: 'center' }}>Ще останеш влязъл на това устройство, докато не излезеш.</p>
        {DEMO && (
          <div className="demo-box">
            <b>Демо режим.</b> Влез като:{' '}
            {[['admin@demo.bg', 'админ'], ['setter@demo.bg', 'сетър'], ['closer@demo.bg', 'клоузър']].map(([e, l], i) => (
              <span key={e}>{i ? ', ' : ''}<button type="button" onClick={() => { setEmail(e); setPw('demo1234'); }}>{l}</button></span>
            ))} (парола demo1234)
          </div>
        )}
      </form>
    </div>
  );
}

function NoAccess() {
  return (
    <div className="login"><div className="login-card">
      <div className="brand"><span className="brand-mark">C</span>CRM</div>
      <h1>Нямаш достъп</h1>
      <p className="muted" style={{ margin: 0 }}>Акаунтът ти е спрян или още не е настроен. Свържи се с администратора.</p>
      <button className="btn" onClick={() => db.signOut()}>Излез</button>
    </div></div>
  );
}

function Shell({ me, theme, toggleTheme }) {
  const [page, param] = useHash();
  const nav = NAV[me.role] || [];
  const current = nav.some(n => n[0] === page) ? page : nav[0][0];
  const [fuCount, setFuCount] = useState(0);
  const toast = useToast();

  useEffect(() => { if (page !== current) go(current); }, [page, current]);
  const refreshCounts = useCallback(async () => {
    if (me.role === 'closer') return;
    try {
      const rows = await db.leads({ view: 'followups', me });
      setFuCount(rows.filter(r => new Date(r.follow_up_at) <= new Date()).length);
    } catch { /* ignore */ }
  }, [me]);
  useEffect(() => { refreshCounts(); const t = setInterval(refreshCounts, 60000); return () => clearInterval(t); }, [refreshCounts]);

  const link = ([k, label, icon]) => (
    <a key={k} href={`#/${k}`} className={current === k ? 'on' : ''} aria-current={current === k ? 'page' : undefined}>
      <Icon name={icon} />{label}{k === 'followups' && fuCount > 0 && <span className="count" aria-label={`${fuCount} за днес`}>{fuCount}</span>}
    </a>
  );

  const signOut = async () => { await db.signOut(); toast('Излезе успешно'); };
  const themeLabel = theme === 'dark' ? 'Светла тема' : 'Тъмна тема';

  return (
    <div className="shell">
      <aside className="side" aria-label="Странично меню">
        <div className="brand side-brand"><span className="brand-mark">C</span><span>CRM</span></div>
        <nav className="side-nav" aria-label="Меню">{nav.map(link)}</nav>
        <div className="side-foot">
          <div className="me-card"><Av name={me.full_name} /><div className="grow"><b>{me.full_name}</b><span>{ROLE[me.role]}</span></div></div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn ghost sm grow" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />{themeLabel}</button>
            <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={signOut} aria-label="Излез" title="Излез"><Icon name="out" size={16} /></button>
          </div>
        </div>
      </aside>
      <div className="content">
        {DEMO && <div className="demo-banner">Демо режим — данните се пазят само в този браузър. <button onClick={() => db.resetDemo?.()}>Нулирай демото</button></div>}
        <header className="top">
          <div className="brand"><span className="brand-mark">C</span><span>CRM</span></div>
          <div className="top-right">
            <button className="icon-btn" onClick={toggleTheme} aria-label={themeLabel} title={themeLabel}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
            <button className="icon-btn" onClick={signOut} aria-label="Излез" title="Излез"><Icon name="out" /></button>
          </div>
        </header>
        <main className="main">
          {current === 'home' && <HomePage me={me} />}
          {['leads', 'followups', 'calls'].includes(current) && <LeadsPage key={current} me={me} view={current} openId={param} onChanged={refreshCounts} />}
          {current === 'import' && <ImportPage me={me} />}
          {current === 'team' && <TeamPage me={me} />}
          {current === 'sales' && <SalesPage />}
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Меню">{nav.map(link)}</nav>
    </div>
  );
}
