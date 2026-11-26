-- =====================================================================
--  CRM — схема за Supabase
--  Пусни целия файл веднъж: Supabase → SQL Editor → New query → Run
-- =====================================================================


-- ---------- типове ----------
do $$ begin
  create type public.user_role as enum ('admin', 'setter', 'closer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_status as enum ('new', 'answered', 'no_answer', 'wrong_number', 'booked', 'follow_up');
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
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles) then 'setter'::public.user_role else 'admin'::public.user_role end
  )
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
    new.import_id   := old.import_id;
    new.external_id := old.external_id;
    new.setter_id   := old.setter_id;
    new.claimed_at  := old.claimed_at;
    new.closer_id   := old.closer_id;
    new.booking_uid := old.booking_uid;
    new.call_at     := old.call_at;
    -- „Записан разговор“ се поставя само от сървъра при истинско записване
    if (new.status = 'booked') <> (old.status = 'booked') then
      new.status := old.status;
    end if;
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

drop policy if exists profiles_read  on public.profiles;
drop policy if exists profiles_admin on public.profiles;
create policy profiles_read  on public.profiles for select to authenticated using (public.my_role() is not null);
create policy profiles_admin on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists imports_read  on public.imports;
drop policy if exists imports_admin on public.imports;
create policy imports_read  on public.imports for select to authenticated using (public.my_role() is not null);
create policy imports_admin on public.imports for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists leads_admin        on public.leads;
drop policy if exists leads_setter_read  on public.leads;
drop policy if exists leads_setter_write on public.leads;
drop policy if exists leads_closer_read  on public.leads;
drop policy if exists leads_closer_write on public.leads;
create policy leads_admin on public.leads for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy leads_setter_read on public.leads for select to authenticated
  using (public.my_role() = 'setter' and (setter_id is null or setter_id = auth.uid()));
create policy leads_setter_write on public.leads for update to authenticated
  using (public.my_role() = 'setter' and setter_id = auth.uid())
  with check (setter_id = auth.uid());
create policy leads_closer_read on public.leads for select to authenticated
  using (public.my_role() = 'closer' and status = 'booked' and closer_id = auth.uid());
create policy leads_closer_write on public.leads for update to authenticated
  using (public.my_role() = 'closer' and closer_id = auth.uid())
  with check (closer_id = auth.uid());

drop policy if exists events_read   on public.lead_events;
drop policy if exists events_insert on public.lead_events;
create policy events_read on public.lead_events for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));
create policy events_insert on public.lead_events for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.leads l where l.id = lead_id));

grant usage on type public.user_role, public.lead_status to authenticated;
grant execute on function public.claim_lead(uuid), public.release_lead(uuid), public.assign_lead(uuid, uuid),
                          public.my_role(), public.is_admin() to authenticated;
revoke execute on function public.claim_lead(uuid), public.release_lead(uuid), public.assign_lead(uuid, uuid) from anon;
