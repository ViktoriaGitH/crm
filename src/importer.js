import Papa from 'papaparse';

// ---------- четене на файла (CSV в UTF-8/UTF-16, TSV или Excel) ----------
export async function readTable(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xlsx')) {
    const { default: readXlsxFile } = await import('read-excel-file');
    const rows = await readXlsxFile(file);
    return rows.map(r => r.map(c => (c == null ? '' : c instanceof Date ? c.toISOString() : String(c))));
  }
  if (name.endsWith('.xls')) throw new Error('Стар .xls формат не се поддържа. Запиши файла като .xlsx или .csv.');
  const buf = new Uint8Array(await file.arrayBuffer());
  const text = decode(buf);
  const parsed = Papa.parse(text, { skipEmptyLines: 'greedy' });
  return parsed.data.map(r => r.map(c => String(c ?? '')));
}

function decode(b) {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  let zeros = 0; const n = Math.min(b.length, 400);
  for (let i = 1; i < n; i += 2) if (b[i] === 0) zeros++;
  if (n > 10 && zeros > n / 4) return new TextDecoder('utf-16le').decode(b);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(b);
  if (!utf8.includes('\uFFFD')) return utf8;
  return new TextDecoder('windows-1251').decode(b);   // стари български CSV-та
}

// ---------- разпознаване на колоните ----------
const norm = h => String(h || '').trim().toLowerCase().replace(/[\s\-]+/g, '_');
const NAME = ['full_name', 'name', 'име', 'имена', 'име_и_фамилия', 'contact_name'];
const FIRST = ['first_name', 'собствено_име', 'firstname'];
const LAST = ['last_name', 'фамилия', 'lastname', 'surname'];
const PHONE = ['phone_number', 'phone', 'телефон', 'телефонен_номер', 'tel', 'mobile', 'gsm', 'телефон_за_връзка'];
const EMAIL = ['email', 'e_mail', 'имейл', 'email_address', 'мейл', 'e-mail'];
const ID = ['id', 'lead_id', 'leadgen_id'];
const CREATED = ['created_time', 'created_at', 'date', 'дата', 'записан_на', 'timestamp', 'submitted_at'];
// технически колони от Meta, които не са въпроси
const SKIP = ['ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name', 'form_id', 'form_name',
  'is_organic', 'platform', 'lead_status', 'inbox_url', 'retailer_item_id', 'vehicle', 'is_test', 'partner_name'];

function findCol(headers, keys) {
  const h = headers.map(norm);
  for (const k of keys) { const i = h.indexOf(k); if (i >= 0) return i; }
  return -1;
}

export function detect(rows) {
  const headers = (rows[0] || []).map(h => String(h).trim());
  const mapping = {
    name: findCol(headers, NAME),
    first: findCol(headers, FIRST),
    last: findCol(headers, LAST),
    phone: findCol(headers, PHONE),
    email: findCol(headers, EMAIL),
    id: findCol(headers, ID),
    created: findCol(headers, CREATED)
  };
  const used = new Set(Object.values(mapping).filter(i => i >= 0));
  const body = rows.slice(1);
  const questions = headers.map((h, i) => {
    const empty = body.every(r => !String(r[i] || '').trim());
    return { index: i, label: prettyQuestion(h), include: !used.has(i) && !SKIP.includes(norm(h)) && !empty };
  }).filter(q => !used.has(q.index));
  return { headers, mapping, questions };
}

export function prettyQuestion(h) {
  let s = String(h || '').trim();
  if (/_/.test(s) && !/\s/.test(s)) s = s.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- изчистване на стойности ----------
export function normPhone(v) {
  let s = String(v || '').trim().replace(/^p:/i, '').replace(/[\s\-().\/]/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = '+' + s.slice(2);
  else if (s.startsWith('359')) s = '+' + s;
  else if (s.startsWith('0')) s = '+359' + s.slice(1);
  else if (/^[89]\d{8}$/.test(s)) s = '+359' + s;       // 894667233 → +359894667233
  return /^\+\d{8,15}$/.test(s) ? s : String(v || '').trim();
}

const cleanAnswer = v => {
  let s = String(v ?? '').trim();
  if (/_/.test(s) && !/\s/.test(s) && !/@/.test(s)) s = s.replace(/_/g, ' ');
  return s;
};

function parseDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString();
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?/);   // 25.11.2026 14:30
  if (m) { const x = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)); if (!isNaN(x)) return x.toISOString(); }
  return null;
}

// ---------- превръщане в лийдове ----------
export function buildLeads(rows, mapping, questions) {
  const get = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  const out = [];
  const seen = new Set();
  let duplicates = 0, empty = 0;
  for (const r of rows.slice(1)) {
    let full_name = get(r, mapping.name);
    if (!full_name) full_name = [get(r, mapping.first), get(r, mapping.last)].filter(Boolean).join(' ');
    full_name = full_name.replace(/\s+/g, ' ');
    const phone = normPhone(get(r, mapping.phone));
    const email = get(r, mapping.email).toLowerCase();
    if (!full_name && !phone && !email) { empty++; continue; }
    const rawId = get(r, mapping.id);
    const external_id = rawId ? 'id:' + rawId : phone ? 'tel:' + phone : email ? 'mail:' + email : null;
    const key = phone || email || external_id;
    if (key && seen.has(key)) { duplicates++; continue; }
    if (key) seen.add(key);
    const answers = questions.filter(q => q.include)
      .map(q => ({ q: q.label, a: cleanAnswer(r[q.index]) }))
      .filter(x => x.a);
    out.push({ external_id, full_name: full_name || '(без име)', phone: phone || null, email: email || null, answers, lead_created_at: parseDate(get(r, mapping.created)) });
  }
  return { leads: out, duplicates, empty };
}
