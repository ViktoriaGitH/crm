import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const db = new PGlite();
const q = (s, p) => db.query(s, p);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
await db.exec(`
create role authenticated; create role anon; create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to authenticated; grant execute on function auth.uid() to authenticated;
`);
await db.exec(fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;`);
const A='00000000-0000-0000-0000-00000000000a', S1='00000000-0000-0000-0000-0000000000s1'.replace('s1','01'), S2='00000000-0000-0000-0000-000000000002', C='00000000-0000-0000-0000-00000000000c';
for (const [id,e] of [[A,'a@x'],[S1,'s1@x'],[S2,'s2@x'],[C,'c@x']]) await q(`insert into auth.users(id,email,raw_user_meta_data) values($1,$2,'{"role":"admin"}')`,[id,e]);
let threw;
const roles = (await q(`select email, role from public.profiles order by email`)).rows;
ok(roles.find(r=>r.email==='a@x').role==='admin' && roles.find(r=>r.email==='s1@x').role==='setter', 'first user admin, others setter, metadata role ignored');
ok((await q(`select count(*)::int n from public.profiles where not active`)).rows[0].n===3, 'new non-first users start inactive');
await q(`update public.profiles set active=true`);
await q(`update public.profiles set role='closer' where id=$1`,[C]);
const imp=(await q(`insert into public.imports(name) values('W1') returning id`)).rows[0].id;
const L1=(await q(`insert into public.leads(import_id,external_id,full_name) values($1,'e1','Лийд 1') returning id`,[imp])).rows[0].id;
const L2=(await q(`insert into public.leads(import_id,external_id,full_name) values($1,'e2','Лийд 2') returning id`,[imp])).rows[0].id;
async function as(uid, fn){ await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`); try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false);`);} }
const cnt = async () => (await q(`select count(*)::int n from public.leads`)).rows[0].n;

ok(await as(S1, cnt) === 2, 'setter sees free leads');
ok((await as(S1, () => q(`select public.claim_lead($1) r`,[L1]))).rows[0].r === true, 'setter1 claims L1');
ok((await as(S2, () => q(`select public.claim_lead($1) r`,[L1]))).rows[0].r === false, 'setter2 cannot claim taken L1');
ok(await as(S2, cnt) === 1, 'setter2 no longer sees L1');
await as(S2, () => q(`update public.leads set notes='hack' where id=$1`,[L1]));
ok((await q(`select notes from public.leads where id=$1`,[L1])).rows[0].notes === '', 'setter2 cannot edit L1');
await as(S1, () => q(`update public.leads set status='follow_up', follow_up_at=now()+interval '1 day', notes='звъни утре' where id=$1`,[L1]));
let r=(await q(`select status,follow_up_at,notes from public.leads where id=$1`,[L1])).rows[0];
ok(r.status==='follow_up' && r.follow_up_at && r.notes==='звъни утре', 'setter sets follow up + note');
await as(S1, () => q(`update public.leads set full_name='X', phone='0', answers='[]' where id=$1`,[L1]));
r=(await q(`select full_name,phone from public.leads where id=$1`,[L1])).rows[0];
ok(r.full_name==='Лийд 1' && r.phone===null, 'setter cannot edit name/phone');
threw=false; try { await as(S1, () => q(`insert into public.lead_events(lead_id,user_id,type) values($1,$2,'booked')`,[L1,S1])); } catch { threw=true; }
ok(threw, 'setter cannot fake system events');
await as(S1, () => q(`insert into public.lead_events(lead_id,user_id,type,data) values($1,$2,'note','{}')`,[L1,S1]));
ok(true, 'setter can add note event');
ok((await as(S1, () => q(`select public.crm_stats() s`))).rows[0].s.total===2, 'stats visible to setter respect RLS');
await as(S1, () => q(`update public.leads set status='booked', setter_id=$2 where id=$1`,[L1,S2]));
r=(await q(`select status,setter_id from public.leads where id=$1`,[L1])).rows[0];
ok(r.status==='follow_up' && r.setter_id===S1, 'setter cannot fake booked or reassign');
await as(S1, () => q(`update public.leads set status='no_answer' where id=$1`,[L1]));
ok((await q(`select follow_up_at from public.leads where id=$1`,[L1])).rows[0].follow_up_at===null, 'follow_up_at cleared when status changes');
const ev=(await as(S1, () => q(`select type from public.lead_events where lead_id=$1 order by id`,[L1]))).rows.map(x=>x.type);
ok(ev.join(',')==='claimed,status,note,status', 'events logged: '+ev.join(','));
// server books (no auth.uid)
await q(`update public.leads set status='booked', closer_id=$2, call_at=now()+interval '2 day' where id=$1`,[L1,C]);
ok(await as(C, cnt) === 1, 'closer sees booked lead');
await as(S1, () => q(`update public.leads set status='no_answer' where id=$1`,[L1]));
ok((await q(`select status from public.leads where id=$1`,[L1])).rows[0].status==='booked', 'setter cannot un-book');
ok((await as(S1, () => q(`select public.release_lead($1) r`,[L1]))).rows[0].r===false, 'cannot release booked lead');
ok((await as(S1, () => q(`select count(*)::int n from public.imports`))).rows[0].n===1, 'setter reads imports');
threw=false; try { await as(S1, () => q(`insert into public.imports(name) values('x')`)); } catch { threw=true; }
ok(threw, 'setter cannot create import');
threw=false; try { await as(S1, () => q(`select public.assign_lead($1,$2)`,[L2,S1])); } catch { threw=true; }
ok(threw, 'setter cannot assign');
await as(A, () => q(`select public.assign_lead($1,$2)`,[L2,S2]));
ok((await q(`select setter_id from public.leads where id=$1`,[L2])).rows[0].setter_id===S2, 'admin assigns');
ok(await as(A, cnt) === 2, 'admin sees all');
await q(`update public.profiles set active=false where id=$1`,[S2]);
ok(await as(S2, cnt) === 0, 'inactive user sees nothing');
await as(S1, () => q(`update public.profiles set role='admin' where id=$1`,[S1]));
ok((await q(`select role from public.profiles where id=$1`,[S1])).rows[0].role==='setter', 'setter cannot promote self');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails?1:0);
