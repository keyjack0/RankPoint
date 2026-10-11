create extension if not exists pgcrypto;

create table public.app_settings (
  id boolean primary key default true check (id),
  starting_points numeric(12, 2) not null default 24,
  migration_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.point_rules (
  id uuid primary key default gen_random_uuid(),
  name varchar(80) not null check (length(btrim(name)) > 0),
  delta numeric(12, 2) not null,
  icon text not null default 'mvp' check (icon in ('bronze', 'silver', 'gold', 'mvp')),
  enabled boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.match_entries (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.point_rules(id) on delete restrict,
  rule_name varchar(80) not null check (length(btrim(rule_name)) > 0),
  point_delta numeric(12, 2) not null,
  note varchar(120),
  recorded_at timestamptz not null default now(),
  source text not null default 'ui' check (source in ('ui', 'webmcp', 'import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index point_rules_order_idx on public.point_rules(sort_order, created_at);
create index point_rules_enabled_idx on public.point_rules(sort_order) where enabled;
create index match_entries_recorded_idx on public.match_entries(recorded_at desc, id desc);
create index match_entries_rule_idx on public.match_entries(rule_id, recorded_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger app_settings_updated_at before update on public.app_settings
for each row execute function public.set_updated_at();
create trigger point_rules_updated_at before update on public.point_rules
for each row execute function public.set_updated_at();
create trigger match_entries_updated_at before update on public.match_entries
for each row execute function public.set_updated_at();

insert into public.app_settings (id, starting_points, migration_open)
values (true, 24, true);

insert into public.point_rules (name, delta, icon, sort_order) values
  ('Bronze', -4, 'bronze', 0),
  ('Silver', -1, 'silver', 1),
  ('Gold', 0, 'gold', 2),
  ('MVP Kalah', 0.5, 'mvp', 3),
  ('MVP Menang', 1, 'mvp', 4);

alter table public.app_settings enable row level security;
alter table public.point_rules enable row level security;
alter table public.match_entries enable row level security;

create policy "Settings are publicly readable" on public.app_settings for select using (true);
create policy "Rules are publicly readable" on public.point_rules for select using (true);
create policy "Entries are publicly readable" on public.match_entries for select using (true);

grant usage on schema public to anon, authenticated;
revoke all on public.app_settings, public.point_rules, public.match_entries from public, anon, authenticated;
grant select on public.app_settings, public.point_rules, public.match_entries to anon, authenticated;

create function public.record_match(p_rule_id uuid, p_note text default null, p_source text default 'ui')
returns public.match_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_rule public.point_rules;
  result public.match_entries;
  clean_note text := nullif(btrim(p_note), '');
begin
  if clean_note is not null and char_length(clean_note) > 120 then
    raise exception 'Catatan maksimal 120 karakter.';
  end if;
  if p_source not in ('ui', 'webmcp') then
    raise exception 'Sumber input tidak valid.';
  end if;

  select * into selected_rule
  from public.point_rules
  where id = p_rule_id and enabled
  for share;

  if not found then
    raise exception 'Aturan aktif tidak ditemukan.';
  end if;

  insert into public.match_entries (rule_id, rule_name, point_delta, note, source)
  values (selected_rule.id, selected_rule.name, selected_rule.delta, clean_note, p_source)
  returning * into result;
  return result;
end;
$$;

create function public.create_point_rule(p_name text, p_delta numeric, p_icon text default 'mvp')
returns public.point_rules
language plpgsql
security definer
set search_path = ''
as $$
declare result public.point_rules;
begin
  if length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'Nama aturan harus berisi 1-80 karakter.';
  end if;
  if p_delta is null or p_delta < -9999999999.99 or p_delta > 9999999999.99 then
    raise exception 'Nilai poin tidak valid.';
  end if;
  if p_icon not in ('bronze', 'silver', 'gold', 'mvp') then
    raise exception 'Ikon tidak valid.';
  end if;

  lock table public.point_rules in share row exclusive mode;
  insert into public.point_rules (name, delta, icon, sort_order)
  values (
    btrim(p_name),
    p_delta,
    p_icon,
    coalesce((select max(sort_order) + 1 from public.point_rules), 0)
  )
  returning * into result;
  return result;
end;
$$;

create function public.update_point_rule(p_id uuid, p_name text, p_delta numeric)
returns public.point_rules
language plpgsql
security definer
set search_path = ''
as $$
declare result public.point_rules;
begin
  if length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'Nama aturan harus berisi 1-80 karakter.';
  end if;
  if p_delta is null or p_delta < -9999999999.99 or p_delta > 9999999999.99 then
    raise exception 'Nilai poin tidak valid.';
  end if;

  update public.point_rules set name = btrim(p_name), delta = p_delta where id = p_id
  returning * into result;
  if not found then raise exception 'Aturan tidak ditemukan.'; end if;
  return result;
end;
$$;

create function public.toggle_point_rule(p_id uuid)
returns public.point_rules
language plpgsql
security definer
set search_path = ''
as $$
declare result public.point_rules;
begin
  update public.point_rules set enabled = not enabled where id = p_id returning * into result;
  if not found then raise exception 'Aturan tidak ditemukan.'; end if;
  return result;
end;
$$;

create function public.set_starting_points(p_value numeric)
returns public.app_settings
language plpgsql
security definer
set search_path = ''
as $$
declare result public.app_settings;
begin
  if p_value is null or p_value < -9999999999.99 or p_value > 9999999999.99 then
    raise exception 'Poin awal tidak valid.';
  end if;
  update public.app_settings set starting_points = p_value where id returning * into result;
  return result;
end;
$$;

create function public.delete_match(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare affected integer;
begin
  delete from public.match_entries where id = p_id;
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

create function public.import_legacy_rankpoint(p_data jsonb)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  settings public.app_settings;
  item jsonb;
  old_id text;
  new_id uuid;
  id_map jsonb := '{}'::jsonb;
  item_name text;
  item_delta numeric;
  item_icon text;
  item_time timestamptz;
  position integer := 0;
begin
  select * into settings from public.app_settings where id for update;
  if not settings.migration_open then
    return false;
  end if;
  if jsonb_typeof(p_data) <> 'object'
    or jsonb_typeof(p_data->'rules') <> 'array'
    or jsonb_typeof(p_data->'entries') <> 'array' then
    raise exception 'Format data lokal tidak valid.';
  end if;

  delete from public.match_entries;
  delete from public.point_rules;

  for item in select value from jsonb_array_elements(p_data->'rules') loop
    old_id := item->>'id';
    item_name := btrim(coalesce(item->>'name', ''));
    item_delta := (item->>'delta')::numeric;
    item_icon := coalesce(item->>'icon', 'mvp');
    if old_id is null or length(item_name) not between 1 and 80
      or item_icon not in ('bronze', 'silver', 'gold', 'mvp') then
      raise exception 'Aturan lokal tidak valid.';
    end if;
    insert into public.point_rules (name, delta, icon, enabled, sort_order)
    values (item_name, item_delta, item_icon, coalesce((item->>'enabled')::boolean, true), position)
    returning id into new_id;
    id_map := id_map || jsonb_build_object(old_id, new_id::text);
    position := position + 1;
  end loop;

  for item in select value from jsonb_array_elements(p_data->'entries') loop
    old_id := item->>'ruleId';
    new_id := (id_map->>old_id)::uuid;
    item_name := btrim(coalesce(item->>'name', ''));
    item_delta := (item->>'delta')::numeric;
    item_time := coalesce((item->>'time')::timestamptz, now());
    if new_id is null or length(item_name) not between 1 and 80 then
      raise exception 'Riwayat lokal tidak valid.';
    end if;
    insert into public.match_entries (rule_id, rule_name, point_delta, note, recorded_at, source)
    values (new_id, item_name, item_delta, nullif(left(btrim(item->>'note'), 120), ''), item_time, 'import');
  end loop;

  update public.app_settings
  set starting_points = coalesce((p_data->>'start')::numeric, 24), migration_open = false
  where id;
  return true;
end;
$$;

create function public.complete_initial_setup()
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.app_settings set migration_open = false where id and migration_open returning true;
$$;

revoke all on function public.record_match(uuid, text, text) from public;
revoke all on function public.create_point_rule(text, numeric, text) from public;
revoke all on function public.update_point_rule(uuid, text, numeric) from public;
revoke all on function public.toggle_point_rule(uuid) from public;
revoke all on function public.set_starting_points(numeric) from public;
revoke all on function public.delete_match(uuid) from public;
revoke all on function public.import_legacy_rankpoint(jsonb) from public;
revoke all on function public.complete_initial_setup() from public;

grant execute on function public.record_match(uuid, text, text) to anon, authenticated;
grant execute on function public.create_point_rule(text, numeric, text) to anon, authenticated;
grant execute on function public.update_point_rule(uuid, text, numeric) to anon, authenticated;
grant execute on function public.toggle_point_rule(uuid) to anon, authenticated;
grant execute on function public.set_starting_points(numeric) to anon, authenticated;
grant execute on function public.delete_match(uuid) to anon, authenticated;
grant execute on function public.import_legacy_rankpoint(jsonb) to anon, authenticated;
grant execute on function public.complete_initial_setup() to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_settings'
  ) then
    alter publication supabase_realtime add table public.app_settings;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'point_rules'
  ) then
    alter publication supabase_realtime add table public.point_rules;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_entries'
  ) then
    alter publication supabase_realtime add table public.match_entries;
  end if;
end $$;
