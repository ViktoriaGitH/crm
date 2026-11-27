-- =====================================================================
--  CRM — схема за Supabase
--  Пусни целия файл веднъж: Supabase → SQL Editor → New query → Run
--  (можеш да го пуснеш и повторно — нищо не се дублира)
-- =====================================================================


-- ---------- типове ----------
do $$ begin
  create type public.user_role as enum ('admin', 'setter', 'closer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_status as enum ('new', 'answered', 'no_answer', 'wrong_number', 'disqualified', 'booked', 'follow_up');
exception when duplicate_object then null; end $$;

-- ---------- таблици ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  email       text,
  role        public.user_role not null default 'setter',
  active      boolean not null default true,
  cal_link    text,               -- за клоузър: "потребител/събитие" в Cal.com
  created_at  timestamptz not null default now()
);

create table if not exists public.imports (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  file_name   text,
  lead_count  integer not null default 0,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  import_id        uuid references public.imports (id) on delete cascade,
  external_id      text unique,
  full_name        text not null default '',
  phone            text,
  email            text,
  answers          jsonb not null default '[]'::jsonb,   -- [{ "q": "...", "a": "..." }]
  lead_created_at  timestamptz,
  status           public.lead_status not null default 'new',
  setter_id        uuid references public.profiles (id) on delete set null,
  claimed_at       timestamptz,
  follow_up_at     timestamptz,
  call_at          timestamptz,
  closer_id        uuid references public.profiles (id) on delete set null,
  booking_uid      text,
  notes            text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists leads_status_idx    on public.leads (status);
create index if not exists leads_setter_idx    on public.leads (setter_id);
create index if not exists leads_import_idx    on public.leads (import_id);
create index if not exists leads_closer_idx    on public.leads (closer_id);
create index if not exists leads_created_idx   on public.leads (lead_created_at desc nulls last, created_at desc);
create index if not exists leads_follow_up_idx on public.leads (follow_up_at) where status = 'follow_up';
create index if not exists leads_call_idx      on public.leads (call_at) where status = 'booked';

create table if not exists public.lead_events (
  id          bigint generated always as identity primary key,
  lead_id     uuid not null references public.leads (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,
  type        text not null,           -- claimed | released | status | note
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists lead_events_lead_idx on public.lead_events (lead_id, created_at desc);
create index if not exists lead_events_user_idx on public.lead_events (user_id);
create index if not exists imports_created_by_idx on public.imports (created_by);

-- ---------- помощни функции ----------
create or replace function public.my_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid() and active), false)
$$;

-- нов потребител в auth → профил (първият става админ)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  first_user := not exists (select 1 from public.profiles);
  -- само първият потребител е активен автоматично (админ); всички останали ги активира админът
  insert into public.profiles (id, email, full_name, role, active)
  values (new.id, new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when first_user then 'admin'::public.user_role else 'setter'::public.user_role end,
    first_user)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- защита на полетата: само админ (или сървърът) пренасочва лийдове и сменя импорта/данните на клоузъра
create or replace function public.leads_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if auth.uid() is not null and not public.is_admin()
     and coalesce(current_setting('crm.trusted', true), '') <> 'on' then
    -- сетър/клоузър могат да сменят само статус, фолоу ъп и бележки
    new.import_id   := old.import_id;
    new.external_id := old.external_id;
    new.full_name   := old.full_name;
    new.phone       := old.phone;
    new.email       := old.email;
    new.answers     := old.answers;
    new.lead_created_at := old.lead_created_at;
    new.created_at  := old.created_at;
    new.setter_id   := old.setter_id;
    new.claimed_at  := old.claimed_at;
    new.closer_id   := old.closer_id;
    new.booking_uid := old.booking_uid;
    new.call_at     := old.call_at;
    -- „Записан разговор“ се поставя само от сървъра при истинско записване
    if (new.status = 'booked') <> (old.status = 'booked') then
      new.status := old.status;
    end if;
    if length(new.notes) > 5000 then new.notes := left(new.notes, 5000); end if;
  end if;
  if new.status <> 'follow_up' then new.follow_up_at := null; end if;
  return new;
end $$;

drop trigger if exists leads_guard on public.leads;
create trigger leads_guard before update on public.leads
  for each row execute function public.leads_guard();

-- история: автоматичен запис при смяна на статус
create or replace function public.leads_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and (new.status is distinct from old.status
     or (new.status = 'follow_up' and new.follow_up_at is distinct from old.follow_up_at)) then
    insert into public.lead_events (lead_id, user_id, type, data)
    values (new.id, auth.uid(), 'status',
            jsonb_build_object('from', old.status, 'to', new.status,
                               'follow_up_at', new.follow_up_at, 'call_at', new.call_at));
  end if;
  return new;
end $$;

drop trigger if exists leads_log on public.leads;
create trigger leads_log after update on public.leads
  for each row execute function public.leads_log();

-- сетърът взима лийд (атомарно: само ако е свободен)
create or replace function public.claim_lead(p_lead uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  if public.my_role() not in ('setter', 'admin') then raise exception 'not allowed'; end if;
  perform set_config('crm.trusted', 'on', true);
  update public.leads set setter_id = auth.uid(), claimed_at = now()
   where id = p_lead and setter_id is null;
  ok := found;
  perform set_config('crm.trusted', 'off', true);
  if ok then
    insert into public.lead_events (lead_id, user_id, type) values (p_lead, auth.uid(), 'claimed');
  end if;
  return ok;
end $$;

-- сетърът освобождава свой лийд
create or replace function public.release_lead(p_lead uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  perform set_config('crm.trusted', 'on', true);
  update public.leads set setter_id = null, claimed_at = null
   where id = p_lead and (setter_id = auth.uid() or public.is_admin()) and status <> 'booked';
  ok := found;
  perform set_config('crm.trusted', 'off', true);
  if ok then
    insert into public.lead_events (lead_id, user_id, type) values (p_lead, auth.uid(), 'released');
  end if;
  return ok;
end $$;

-- админ: прехвърля лийд на сетър (или null)
create or replace function public.assign_lead(p_lead uuid, p_setter uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  perform set_config('crm.trusted', 'on', true);
  update public.leads set setter_id = p_setter, claimed_at = case when p_setter is null then null else now() end
   where id = p_lead;
  perform set_config('crm.trusted', 'off', true);
  insert into public.lead_events (lead_id, user_id, type, data)
  values (p_lead, auth.uid(), 'assigned', jsonb_build_object('setter_id', p_setter));
end $$;

-- ---------- достъп (Row Level Security) ----------
alter table public.profiles    enable row level security;
alter table public.imports     enable row level security;
alter table public.leads       enable row level security;
alter table public.lead_events enable row level security;

drop policy if exists profiles_read on public.profiles;
drop policy if exists profiles_admin on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using ((select public.my_role()) is not null);
create policy profiles_admin on public.profiles for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

drop policy if exists imports_read on public.imports;
drop policy if exists imports_admin_ins on public.imports;
drop policy if exists imports_admin_upd on public.imports;
drop policy if exists imports_admin_del on public.imports;
create policy imports_read on public.imports for select to authenticated using ((select public.my_role()) is not null);
create policy imports_admin_ins on public.imports for insert to authenticated with check ((select public.is_admin()));
create policy imports_admin_upd on public.imports for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy imports_admin_del on public.imports for delete to authenticated using ((select public.is_admin()));

drop policy if exists leads_read on public.leads;
drop policy if exists leads_insert on public.leads;
drop policy if exists leads_delete on public.leads;
drop policy if exists leads_update on public.leads;
create policy leads_read on public.leads for select to authenticated using (
  (select public.is_admin())
  or ((select public.my_role()) = 'setter' and (setter_id is null or setter_id = (select auth.uid())))
  or ((select public.my_role()) = 'closer' and status = 'booked' and closer_id = (select auth.uid())));
create policy leads_insert on public.leads for insert to authenticated with check ((select public.is_admin()));
create policy leads_delete on public.leads for delete to authenticated using ((select public.is_admin()));
create policy leads_update on public.leads for update to authenticated using (
  (select public.is_admin())
  or ((select public.my_role()) = 'setter' and setter_id = (select auth.uid()))
  or ((select public.my_role()) = 'closer' and closer_id = (select auth.uid())))
  with check (
  (select public.is_admin())
  or ((select public.my_role()) = 'setter' and setter_id = (select auth.uid()))
  or ((select public.my_role()) = 'closer' and closer_id = (select auth.uid())));

drop policy if exists events_read on public.lead_events;
drop policy if exists events_insert on public.lead_events;
create policy events_read on public.lead_events for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
-- потребителите добавят ръчно само бележки; останалото го пише системата
create policy events_insert on public.lead_events for insert to authenticated
  with check (user_id = (select auth.uid()) and type = 'note'
              and exists (select 1 from public.leads l where l.id = lead_id));

-- бързи показатели за таблото (спазва правата на потребителя)
create or replace function public.crm_stats()
returns jsonb language sql stable security invoker set search_path = public as $$
  with l as (select * from public.leads),
  me as (select auth.uid() as id)
  select jsonb_build_object(
    'total', (select count(*) from l),
    'free', (select count(*) from l where setter_id is null),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from l group by status) s), '{}'::jsonb),
    'mine_by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from l, me where l.setter_id = me.id group by status) s), '{}'::jsonb),
    'setters', coalesce((select jsonb_agg(x) from (
        select setter_id as id, count(*) as taken,
               count(*) filter (where status <> 'new') as worked,
               count(*) filter (where status = 'booked') as booked
        from l where setter_id is not null group by setter_id) x), '[]'::jsonb),
    'imports', coalesce((select jsonb_agg(x) from (
        select import_id as id, count(*) as total,
               count(*) filter (where setter_id is null) as free,
               count(*) filter (where status <> 'new') as worked,
               count(*) filter (where status = 'booked') as booked
        from l where import_id is not null group by import_id) x), '[]'::jsonb)
  )
$$;

-- ---------- права върху функциите ----------
revoke execute on function public.claim_lead(uuid), public.release_lead(uuid), public.assign_lead(uuid, uuid),
                           public.my_role(), public.is_admin(),
                           public.handle_new_user(), public.leads_guard(), public.leads_log() from public;
do $$ begin
  revoke execute on function public.claim_lead(uuid), public.release_lead(uuid), public.assign_lead(uuid, uuid),
                             public.my_role(), public.is_admin(),
                             public.handle_new_user(), public.leads_guard(), public.leads_log() from anon;
  revoke execute on function public.handle_new_user(), public.leads_guard(), public.leads_log() from authenticated;
exception when undefined_object then null; end $$;
grant usage on type public.user_role, public.lead_status to authenticated;
grant execute on function public.claim_lead(uuid), public.release_lead(uuid), public.assign_lead(uuid, uuid),
                          public.my_role(), public.is_admin(), public.crm_stats() to authenticated;
revoke execute on function public.crm_stats() from public;

-- права върху таблиците (сигурността идва от правилата по-горе)
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.imports, public.leads, public.lead_events to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- анонимни посетители нямат достъп до нищо
revoke all on public.profiles, public.imports, public.leads, public.lead_events from anon;

-- тайни на сървъра (Cal.com API ключ); само Edge Function с service role ги вижда
create table if not exists public.crm_secrets (key text primary key, value text not null, updated_at timestamptz not null default now());
alter table public.crm_secrets enable row level security;
revoke all on public.crm_secrets from anon, authenticated;
grant select, insert, update on public.crm_secrets to service_role;

-- без повторени лийдове: същият телефон (последните 9 цифри) или имейл не влиза втори път
create or replace function public.phone_key(p text) returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(p,''),'\D','','g')) >= 8 then right(regexp_replace(p,'\D','','g'), 9) end $$;
create index if not exists leads_phone_key_idx on public.leads (public.phone_key(phone));
create index if not exists leads_email_lower_idx on public.leads (lower(email));
create or replace function public.leads_skip_dupes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('leads_dedupe'));
  if (public.phone_key(new.phone) is not null and exists (select 1 from leads where public.phone_key(phone) = public.phone_key(new.phone)))
     or (coalesce(trim(new.email),'') <> '' and exists (select 1 from leads where lower(email) = lower(trim(new.email)))) then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists leads_skip_dupes on public.leads;
create trigger leads_skip_dupes before insert on public.leads for each row execute function public.leads_skip_dupes();

-- ---------- продажби: пакети и резултат от срещата ----------
-- (пуснато като миграция sales_pipeline; актуалните leads_guard, leads_log и crm_stats са в нея)
create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  price numeric(12,2) not null default 0 check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.leads
  add column if not exists source text,
  add column if not exists outcome text check (outcome in ('closed','not_closed','no_show','rescheduled','disqualified')),
  add column if not exists package_id uuid references public.packages(id) on delete set null,
  add column if not exists sale_price numeric(12,2) check (sale_price >= 0),
  add column if not exists discount numeric(12,2) not null default 0 check (discount >= 0),
  add column if not exists outcome_at timestamptz,
  add column if not exists closer_notes text;

-- записване на разговор ръчно (без Cal.com): дата, час и клоузър
create or replace function public.book_manual(p_lead uuid, p_call_at timestamptz, p_closer uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  if public.my_role() not in ('setter', 'admin') then raise exception 'not allowed'; end if;
  if p_call_at is null or p_call_at < now() - interval '1 day' or p_call_at > now() + interval '1 year' then raise exception 'invalid time'; end if;
  if not exists (select 1 from public.profiles where id = p_closer and active and role in ('closer', 'admin')) then raise exception 'invalid closer'; end if;
  perform set_config('crm.trusted', 'on', true);
  update public.leads set status = 'booked', call_at = p_call_at, closer_id = p_closer, follow_up_at = null,
         outcome = null, setter_id = coalesce(setter_id, auth.uid()), claimed_at = coalesce(claimed_at, now())
   where id = p_lead and (setter_id = auth.uid() or public.is_admin() or (setter_id is null and public.my_role() = 'setter'));
  ok := found;
  perform set_config('crm.trusted', 'off', true);
  if ok then
    insert into public.lead_events (lead_id, user_id, type, data) values (p_lead, auth.uid(), 'booked', jsonb_build_object('call_at', p_call_at, 'closer_id', p_closer));
  end if;
  return ok;
end $$;
revoke execute on function public.book_manual(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.book_manual(uuid, timestamptz, uuid) to authenticated;

-- пренасрочване на среща с нова дата и час (клоузърът на срещата, сетърът или админ)
create or replace function public.reschedule_call(p_lead uuid, p_call_at timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  if p_call_at is null or p_call_at < now() - interval '1 hour' or p_call_at > now() + interval '1 year' then raise exception 'invalid time'; end if;
  perform set_config('crm.trusted', 'on', true);
  update public.leads set call_at = p_call_at, outcome = 'rescheduled'
   where id = p_lead and status = 'booked' and (public.is_admin() or closer_id = auth.uid() or setter_id = auth.uid());
  ok := found;
  perform set_config('crm.trusted', 'off', true);
  if ok then insert into public.lead_events (lead_id, user_id, type, data) values (p_lead, auth.uid(), 'rescheduled', jsonb_build_object('call_at', p_call_at)); end if;
  return ok;
end $$;
revoke execute on function public.reschedule_call(uuid, timestamptz) from public, anon;
grant execute on function public.reschedule_call(uuid, timestamptz) to authenticated;
