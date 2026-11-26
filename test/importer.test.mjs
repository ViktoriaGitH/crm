import fs from 'node:fs';
import { readTable, detect, buildLeads } from '../src/importer.js';
const f = process.argv[2];
const file = new File([fs.readFileSync(f)], f.split('/').pop());
const rows = await readTable(file);
const d = detect(rows);
console.log('mapping', d.mapping, 'questions', d.questions.map(q => q.label + (q.include ? '' : '(off)')).join(' | '));
const r = buildLeads(rows, d.mapping, d.questions);
console.log('rows', rows.length - 1, 'leads', r.leads.length, 'dups', r.duplicates, 'empty', r.empty);
const bad = r.leads.filter(l => !/^\+359\d{9}$/.test(l.phone || ''));
console.log('non-normalized phones:', bad.map(l => l.phone));
console.log(r.leads[1]);
// utf-16 tab (Meta style)
const meta = 'id\tcreated_time\tfull_name\tphone_number\temail\tкакво_те_спира?\tad_name\nl:123\t2026-11-20T10:00:00+0200\tМария Тест\tp:+359888111222\tm@x.bg\tнямам_време\tAd 1\n';
const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(meta, 'utf16le')]);
const rows2 = await readTable(new File([buf], 'meta.csv'));
const d2 = detect(rows2); const r2 = buildLeads(rows2, d2.mapping, d2.questions);
console.log('meta:', JSON.stringify(r2.leads[0]));
