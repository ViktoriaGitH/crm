import { useEffect, useMemo, useState } from 'react';
import { db } from './backend.js';
import { Modal, money, useToast } from './ui.jsx';

export default function SalesPage({ st, reload }) {
  const toast = useToast();
  const [pk, setPk] = useState([]);
  const [edit, setEdit] = useState(null);
  const [costPct, setCostPct] = useState(() => { try { return localStorage.getItem('crm-cost-pct') || ''; } catch { return ''; } });
  const [costFix, setCostFix] = useState(() => { try { return localStorage.getItem('crm-cost-fix') || ''; } catch { return ''; } });
  useEffect(() => { try { localStorage.setItem('crm-cost-pct', costPct); localStorage.setItem('crm-cost-fix', costFix); } catch { /* ignore */ } }, [costPct, costFix]);

  const load = () => {
    db.packages().then(setPk).catch(() => {});
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const s = st?.sales || {};
  const pkName = useMemo(() => Object.fromEntries(pk.map(p => [p.id, p.name])), [pk]);
  const costs = (+s.net || 0) * (+costPct || 0) / 100 + (+costFix || 0);
  const profit = (+s.net || 0) - costs;

  return (
    <>

      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat"><b>{money(s.gross)}</b><span>оборот (по цена)</span></div>
        <div className="stat"><b>−{money(s.discount)}</b><span>отстъпки</span></div>
        <div className="stat"><b>{money(s.net)}</b><span>реално платено</span></div>
        <div className="stat"><b style={{ color: profit < 0 ? 'var(--accent)' : '#2E9E6A' }}>{money(profit)}</b><span>печалба</span></div>
      </div>
      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat"><b>{s.closed || 0}</b><span>продажби</span></div>
        <div className="stat"><b>{s.closed ? money(s.net / s.closed) : '—'}</b><span>среден чек</span></div>
      </div>
      <div className="card box" style={{ marginBottom: 16 }}>
        <p className="sec-t">Разходи (за сметката на печалбата)</p>
        <div className="map-grid">
          <label className="field">Процент от платеното (комисионни, такси) %<input className="input" type="number" min="0" max="100" value={costPct} onChange={e => setCostPct(e.target.value)} placeholder="напр. 20" /></label>
          <label className="field">Фиксирани разходи (€) — реклама и др.<input className="input" type="number" min="0" value={costFix} onChange={e => setCostFix(e.target.value)} placeholder="напр. 500" /></label>
        </div>
        <span className="faint" style={{ fontSize: 13 }}>Разходи: {money(costs)} · Печалба = платено − разходи. Тези две полета се помнят на това устройство.</span>
      </div>

      <div className="card">
        <div className="box"><p className="sec-t" style={{ margin: 0 }}>По пакет</p></div>
        <div className="box"><table className="table compact"><thead><tr><th>Пакет</th><th>Бр.</th><th>Оборот</th><th>Отстъпки</th><th>Платено</th></tr></thead><tbody>
          {(st?.by_package || []).length === 0 ? <tr><td colSpan={5} className="faint">Още няма затворени сделки.</td></tr> :
            st.by_package.map(x => <tr key={x.id || 'none'}><td>{pkName[x.id] || 'Без пакет'}</td><td>{x.n}</td><td>{money(x.gross)}</td><td>−{money(x.discount)}</td><td><b>{money(x.net)}</b></td></tr>)}
        </tbody></table></div>
      </div>

      <div style={{ marginTop: 24 }}>
        <div className="row"><p className="sec-t grow">Пакети</p><button className="btn sm" onClick={() => setEdit({})}>+ Пакет</button></div>
        <div className="card">
          {pk.length === 0 && <div className="box faint">Добави пакетите, които продавате, за да ги избира клоузърът при затваряне.</div>}
          {pk.map(p => (
            <div key={p.id} className="box row">
              <div className="grow"><b>{p.name}</b>{!p.active && <span className="role-tag" style={{ marginLeft: 8 }}>скрит</span>}<div className="faint" style={{ fontSize: 13 }}>{money(p.price)}</div></div>
              <button className="btn sm" onClick={() => setEdit(p)}>Редактирай</button>
            </div>
          ))}
        </div>
      </div>

      {edit && <PackageForm pk={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); reload(); }} />}
    </>
  );
}

function PackageForm({ pk, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ name: pk.name || '', price: pk.price ?? '', active: pk.active !== false });
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault(); setBusy(true);
    try { await db.savePackage({ id: pk.id, name: f.name.trim(), price: +f.price || 0, active: f.active }); toast('Запазено'); onSaved(); }
    catch (x) { toast(x.message, true); setBusy(false); }
  }
  return (
    <Modal title={pk.id ? 'Пакет' : 'Нов пакет'} onClose={onClose}>
      <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="field">Име<input className="input" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} required maxLength={120} autoFocus /></label>
        <label className="field">Цена (€)<input className="input" type="number" min="0" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} required /></label>
        {pk.id && <label className="q-item"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /><span>Активен (вижда се при затваряне)</span></label>}
        <div className="row"><button className="btn primary grow" disabled={busy}>Запази</button><button type="button" className="btn" onClick={onClose}>Отказ</button></div>
      </form>
    </Modal>
  );
}
