import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from './backend.js';
import { readTable, detect, buildLeads } from './importer.js';
import { Icon, Modal, fmt, useToast } from './ui.jsx';
import { go } from './App.jsx';

export default function ImportPage({ me }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState(null);
  const [map, setMap] = useState(null);
  const [qs, setQs] = useState([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [imports, setImports] = useState([]);
  const [del, setDel] = useState(null);
  const input = useRef();

  const loadImports = () => db.imports().then(setImports).catch(() => {});
  useEffect(() => { loadImports(); }, []);

  async function pickFile(f) {
    if (!f) return;
    setError(''); setResult(null); setRows(null);
    try {
      const r = await readTable(f);
      if (r.length < 2) throw new Error('Файлът е празен или няма редове с лийдове.');
      const d = detect(r);
      setFile(f); setRows(r); setMap(d.mapping); setQs(d.questions);
      const base = f.name.replace(/\.(csv|tsv|txt|xlsx)$/i, '');
      setName(`Уебинар ${new Intl.DateTimeFormat('bg-BG', { day: '2-digit', month: '2-digit' }).format(new Date())} · ${base}`.slice(0, 80));
    } catch (e) { setError(e.message || 'Не успях да прочета файла.'); }
  }

  const headers = rows ? rows[0].map(h => String(h).trim()) : [];
  const built = useMemo(() => (rows && map ? buildLeads(rows, map, qs) : null), [rows, map, qs]);
  const sample = rows ? rows[1] || [] : [];

  const noCols = map && map.name < 0 && map.first < 0 && map.phone < 0 && map.email < 0;
  async function doImport() {
    if (!built?.leads.length || noCols) return;
    if (map.phone < 0 && map.email < 0) { toast('Избери колона за телефон или имейл', true); return; }
    setProgress([0, built.leads.length]);
    try {
      const r = await db.importLeads(me, { name: name.trim() || file.name, fileName: file.name }, built.leads, (a, b) => setProgress([a, b]));
      setResult(r); setRows(null); setFile(null); loadImports();
      toast(`Импортирани: ${r.inserted}`);
    } catch (e) { setError(e.message); }
    setProgress(null);
  }

  const colSelect = (key, label) => (
    <label className="field">{label}
      <select className="input" value={map[key]} onChange={e => {
        const v = Number(e.target.value);
        setMap(m => ({ ...m, [key]: v }));
        setQs(q => q.map(x => (x.index === v ? { ...x, include: false } : x)));
      }}>
        <option value={-1}>— няма —</option>
        {headers.map((h, i) => <option key={i} value={i}>{h || `Колона ${i + 1}`}</option>)}
      </select>
    </label>
  );

  return (
    <>
      <div className="page-head"><div><h1>Импорт на лийдове</h1><p>Качи CSV или Excel файла от уебинара. Дубликатите се пропускат автоматично.</p></div></div>

      {result && (
        <div className="card box" style={{ marginBottom: 16 }}>
          <div className="stats">
            <div className="stat"><b>{result.inserted}</b><span>нови лийда</span></div>
            <div className="stat"><b>{result.skipped}</b><span>вече ги имаше</span></div>
          </div>
          <div className="row" style={{ marginTop: 14 }}><button className="btn primary" onClick={() => go('leads')}>Към лийдовете</button><button className="btn" onClick={() => setResult(null)}>Още един файл</button></div>
        </div>
      )}

      {!rows && !result && (
        <div className={`drop ${over ? 'over' : ''}`} role="button" tabIndex={0}
          onClick={() => input.current.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') input.current.click(); }}
          onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); pickFile(e.dataTransfer.files[0]); }}>
          <Icon name="upload" size={30} />
          <b>Пусни файла тук или натисни, за да избереш</b>
          <span className="muted" style={{ fontSize: 14 }}>CSV или Excel (.xlsx), например експорт от Meta</span>
          <input ref={input} type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv" hidden onChange={e => { pickFile(e.target.files[0]); e.target.value = ''; }} />
        </div>
      )}
      {error && <div className="err" style={{ marginTop: 12 }}>{error}</div>}

      {rows && built && (
        <div className="card">
          <div className="box">
            <div className="row"><b className="grow">{file.name}</b><button className="btn ghost sm" onClick={() => { setRows(null); setFile(null); }}>Друг файл</button></div>
            <div className="stats" style={{ marginTop: 12 }}>
              <div className="stat"><b>{built.leads.length}</b><span>лийда за импорт</span></div>
              <div className="stat"><b>{built.duplicates}</b><span>дубликата във файла</span></div>
              {built.empty > 0 && <div className="stat"><b>{built.empty}</b><span>празни реда</span></div>}
            </div>
          </div>
          {noCols && <div className="box"><div className="err">Не разпознах колони за име, телефон или имейл. Провери дали това е правилният файл или избери колоните ръчно по-долу.</div></div>}
          <div className="box">
            <label className="field">Име на уебинара<input className="input" value={name} onChange={e => setName(e.target.value)} maxLength={80} /></label>
          </div>
          <div className="box">
            <p className="sec-t">Колони</p>
            <div className="map-grid">
              {map.first >= 0 && map.name < 0 ? <>{colSelect('first', 'Име')}{colSelect('last', 'Фамилия')}</> : colSelect('name', 'Име')}
              {colSelect('phone', 'Телефон')}
              {colSelect('email', 'Имейл')}
            </div>
          </div>
          <div className="box">
            <p className="sec-t">Въпроси от анкетата (показват се на сетъра)</p>
            {qs.length === 0 ? <span className="faint" style={{ fontSize: 14 }}>Няма други колони.</span> : (
              <div className="q-list">
                {qs.map(q => (
                  <label key={q.index} className="q-item">
                    <input type="checkbox" checked={q.include} onChange={e => setQs(x => x.map(y => (y.index === q.index ? { ...y, include: e.target.checked } : y)))} />
                    <span>{q.label}</span><span className="ex">{String(sample[q.index] || '').slice(0, 60)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="box">
            <p className="sec-t">Преглед</p>
            {built.leads.slice(0, 3).map((l, i) => (
              <div key={i} className="contact-row" style={{ marginBottom: 6 }}>
                <span className="val">{l.full_name}</span><span className="muted" style={{ fontSize: 13 }}>{l.phone || '—'}</span>
              </div>
            ))}
            {progress && <div className="progress" style={{ margin: '12px 0' }}><div style={{ width: `${(progress[0] / progress[1]) * 100}%` }} /></div>}
            <button className="btn primary big" style={{ marginTop: 10 }} disabled={!built.leads.length || !!progress || noCols || (map.phone < 0 && map.email < 0)} onClick={doImport}>
              {progress ? `Импортирам… ${progress[0]}/${progress[1]}` : `Импортирай ${built.leads.length} лийда`}
            </button>
          </div>
        </div>
      )}

      {imports.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <p className="sec-t">Досегашни импорти</p>
          <div className="card">
            {imports.map(i => (
              <div key={i.id} className="box row">
                <div className="grow"><b>{i.name}</b><div className="faint" style={{ fontSize: 13 }}>{fmt(i.created_at)} · {i.lead_count} лийда</div></div>
                <button className="btn ghost sm danger" onClick={() => setDel(i)}>Изтрий</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {del && (
        <Modal title="Изтриване на импорт" onClose={() => setDel(null)}>
          <p style={{ margin: 0 }}>Ще изтриеш <b>{del.name}</b> и всичките му <b>{del.lead_count}</b> лийда, заедно със статусите и бележките. Това не може да се върне.</p>
          <div className="row"><button className="btn primary grow" onClick={async () => { try { await db.deleteImport(del.id); toast('Изтрито'); loadImports(); } catch (e) { toast(e.message, true); } setDel(null); }}>Да, изтрий</button><button className="btn" onClick={() => setDel(null)}>Отказ</button></div>
        </Modal>
      )}
    </>
  );
}
