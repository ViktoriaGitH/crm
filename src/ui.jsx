import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export const STATUS = {
  new: 'Нов',
  answered: 'Вдигна',
  no_answer: 'Не вдигна',
  wrong_number: 'Грешен номер',
  booked: 'Записан разговор',
  follow_up: 'Фолоу ъп'
};
export const ROLE = { admin: 'Админ', setter: 'Сетър', closer: 'Клоузър' };

export const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Sofia'; } catch { return 'Europe/Sofia'; } })();

const dtf = new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dtfLong = new Intl.DateTimeFormat('bg-BG', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('bg-BG', { day: 'numeric', month: 'short' });
export const fmt = (d) => (d ? dtf.format(new Date(d)) : '—');
export const fmtLong = (d) => (d ? dtfLong.format(new Date(d)) : '—');
export const fmtDay = (d) => (d ? df.format(new Date(d)) : '—');

export function relWhen(d) {
  if (!d) return { text: '—', cls: '' };
  const t = new Date(d).getTime(), now = Date.now(), diff = t - now;
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const day = Math.floor((t - startToday.getTime()) / 864e5);
  const hm = new Intl.DateTimeFormat('bg-BG', { hour: '2-digit', minute: '2-digit' }).format(new Date(d));
  let text = day === 0 ? `Днес, ${hm}` : day === 1 ? `Утре, ${hm}` : day === -1 ? `Вчера, ${hm}` : fmt(d);
  return { text, cls: diff < 0 ? 'over' : diff < 2 * 3600e3 ? 'soon' : '' };
}

// за <input type="datetime-local">
export function toLocalInput(d) {
  const x = new Date(d); const p = n => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
}

export const initials = (n) => (String(n || '').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('') || '?').toUpperCase();

export function Badge({ status }) { return <span className={`badge st-${status}`}>{STATUS[status] || status}</span>; }
export function Av({ name }) { return <span className="av" aria-hidden="true">{initials(name)}</span>; }

export function Icon({ name, size = 18 }) {
  const p = {
    home: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5M12 15V3" /></>,
    leads: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />,
    cal: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5M12 3v12" /></>,
    team: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 12 0v1" /><path d="M19 8v6M22 11h-6" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></>,
    moon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
    out: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>,
    x: <path d="M18 6L6 18M6 6l12 12" />,
    copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
    mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 6l-10 7L2 6" /></>,
    key: <><circle cx="7.5" cy="15.5" r="4.5" /><path d="M10.7 12.3L21 2M16 7l3 3M18 5l2 2" /></>,
    chat: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  }[name];
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p}</svg>;
}

/* toasts */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, bad = false) => {
    const id = Math.random();
    setItems(x => [...x.slice(-1), { id, text, bad }]);
    setTimeout(() => setItems(x => x.filter(t => t.id !== id)), bad ? 5000 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(t => <div key={t.id} className={`toast${t.bad ? ' bad' : ''}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

export function useEsc(fn, on = true) {
  useEffect(() => {
    if (!on) return;
    const h = (e) => { if (e.key === 'Escape') fn(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fn, on]);
}

export function Modal({ title, onClose, children }) {
  useEsc(onClose);
  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row"><h3 className="grow">{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Затвори"><Icon name="x" /></button></div>
        {children}
      </div>
    </>
  );
}
