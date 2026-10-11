begin;

-- Multiplayer data cannot be inferred from the legacy single-player history.
truncate table public.match_entries;

revoke all on function public.record_match(uuid, text, text) from public, anon, authenticated;
revoke all on function public.delete_match(uuid) from public, anon, authenticated;
revoke all on function public.set_starting_points(numeric) from public, anon, authenticated;
revoke all on function public.import_legacy_rankpoint(jsonb) from public, anon, authenticated;
revoke all on function public.complete_initial_setup() from public, anon, authenticated;
revoke all on function public.toggle_point_rule(uuid) from public, anon, authenticated;

drop function if exists public.record_match(uuid, text, text);
drop function if exists public.delete_match(uuid);
drop function if exists public.set_starting_points(numeric);
drop function if exists public.import_legacy_rankpoint(jsonb);
drop function if exists public.complete_initial_setup();
drop function if exists public.toggle_point_rule(uuid);

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_settings'
  ) then
    alter publication supabase_realtime drop table public.app_settings;
  end if;
end;
$$;

revoke all on table public.app_settings from public, anon, authenticated;
drop table public.app_settings;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  name varchar(80) not null check (length(btrim(name)) between 1 and 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger players_updated_at
before update on public.players
for each row execute function public.set_updated_at();

alter table public.players enable row level security;

create policy "Players are publicly readable"
on public.players for select
using (true);

alter table public.match_entries
  add column player_id uuid not null,
  add column player_name varchar(80) not null
    check (length(btrim(player_name)) between 1 and 80),
  add constraint match_entries_player_id_fkey
    foreign key (player_id) references public.players(id) on delete restrict;

alter table public.match_entries
  drop constraint match_entries_source_check,
  add constraint match_entries_source_check check (source in ('ui', 'webmcp'));

create index players_active_name_idx
  on public.players(active, name, created_at, id);
create index match_entries_player_recorded_idx
  on public.match_entries(player_id, recorded_at desc, id desc);

create view public.player_standings
with (security_invoker = true)
as
select
  p.id,
  p.name,
  p.active,
  coalesce(sum(me.point_delta), 0::numeric) as points,
  count(me.id) as result_count,
  count(me.id) filter (where me.point_delta > 0) as positive_count,
  count(me.id) filter (where me.point_delta < 0) as negative_count,
  avg(me.point_delta) as average_delta,
  coalesce(
    sum(me.point_delta) filter (
      where me.recorded_at >= current_timestamp - interval '7 days'
    ),
    0::numeric
  ) as weekly_points,
  count(me.id) filter (
    where (me.recorded_at at time zone 'Asia/Jakarta')::date =
      (current_timestamp at time zone 'Asia/Jakarta')::date
  ) as today_count,
  max(me.recorded_at) as last_result_at
from public.players p
left join public.match_entries me on me.player_id = p.id
group by p.id, p.name, p.active;

create function public.create_player(p_name text)
returns public.players
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text := btrim(p_name);
  result public.players;
begin
  if clean_name is null or length(clean_name) not between 1 and 80 then
    raise exception 'Nama pemain harus berisi 1-80 karakter.';
  end if;

  insert into public.players (name)
  values (clean_name)
  returning * into result;

  return result;
end;
$$;

create function public.update_player(p_id uuid, p_name text)
returns public.players
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_name text := btrim(p_name);
  result public.players;
begin
  if p_id is null then
    raise exception 'ID pemain wajib diisi.';
  end if;
  if clean_name is null or length(clean_name) not between 1 and 80 then
    raise exception 'Nama pemain harus berisi 1-80 karakter.';
  end if;

  select * into result
  from public.players
  where id = p_id
  for update;

  if not found then
    raise exception 'Pemain tidak ditemukan.';
  end if;

  update public.players
  set name = clean_name
  where id = p_id
  returning * into result;

  return result;
end;
$$;

create function public.set_player_active(p_id uuid, p_active boolean)
returns public.players
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.players;
begin
  if p_id is null or p_active is null then
    raise exception 'Pemain dan status aktif wajib diisi.';
  end if;

  select * into result
  from public.players
  where id = p_id
  for update;

  if not found then
    raise exception 'Pemain tidak ditemukan.';
  end if;

  update public.players
  set active = p_active
  where id = p_id
  returning * into result;

  return result;
end;
$$;

create function public.record_result(
  p_player_id uuid,
  p_rule_id uuid,
  p_entry_id uuid,
  p_note text default null,
  p_source text default 'ui'
)
returns public.match_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_player public.players;
  selected_rule public.point_rules;
  result public.match_entries;
  clean_note text := nullif(btrim(p_note), '');
begin
  if p_player_id is null or p_rule_id is null or p_entry_id is null then
    raise exception 'Pemain, aturan, dan ID hasil wajib diisi.';
  end if;
  if clean_note is not null and char_length(clean_note) > 120 then
    raise exception 'Catatan maksimal 120 karakter.';
  end if;
  if p_source is null or p_source not in ('ui', 'webmcp') then
    raise exception 'Sumber input tidak valid.';
  end if;

  select * into result
  from public.match_entries
  where id = p_entry_id
  for update;

  if found then
    if result.player_id is distinct from p_player_id
      or result.rule_id is distinct from p_rule_id
      or result.note is distinct from clean_note
      or result.source is distinct from p_source then
      raise exception 'ID hasil sudah digunakan dengan data berbeda.';
    end if;
    return result;
  end if;

  select * into selected_player
  from public.players
  where id = p_player_id and active
  for update;

  if not found then
    raise exception 'Pemain aktif tidak ditemukan.';
  end if;

  select * into selected_rule
  from public.point_rules
  where id = p_rule_id and enabled
  for update;

  if not found then
    raise exception 'Aturan aktif tidak ditemukan.';
  end if;

  insert into public.match_entries (
    id,
    player_id,
    player_name,
    rule_id,
    rule_name,
    point_delta,
    note,
    source
  )
  values (
    p_entry_id,
    selected_player.id,
    selected_player.name,
    selected_rule.id,
    selected_rule.name,
    selected_rule.delta,
    clean_note,
    p_source
  )
  on conflict (id) do nothing
  returning * into result;

  if result.id is null then
    select * into result
    from public.match_entries
    where id = p_entry_id
    for update;

    if result.player_id is distinct from p_player_id
      or result.rule_id is distinct from p_rule_id
      or result.note is distinct from clean_note
      or result.source is distinct from p_source then
      raise exception 'ID hasil sudah digunakan dengan data berbeda.';
    end if;
  end if;

  return result;
end;
$$;

create function public.delete_result(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_id uuid;
begin
  if p_id is null then
    raise exception 'ID hasil wajib diisi.';
  end if;

  select id into locked_id
  from public.match_entries
  where id = p_id
  for update;

  if not found then
    return false;
  end if;

  delete from public.match_entries where id = p_id;
  return true;
end;
$$;

create or replace function public.create_point_rule(
  p_name text,
  p_delta numeric,
  p_icon text default 'mvp'
)
returns public.point_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.point_rules;
  clean_name text := btrim(p_name);
begin
  if clean_name is null or length(clean_name) not between 1 and 80 then
    raise exception 'Nama aturan harus berisi 1-80 karakter.';
  end if;
  if p_delta is null or p_delta < -9999999999.99 or p_delta > 9999999999.99 then
    raise exception 'Nilai poin tidak valid.';
  end if;
  if p_icon is null or p_icon not in ('bronze', 'silver', 'gold', 'mvp') then
    raise exception 'Ikon tidak valid.';
  end if;

  lock table public.point_rules in share row exclusive mode;

  insert into public.point_rules (name, delta, icon, sort_order)
  values (
    clean_name,
    p_delta,
    p_icon,
    coalesce((select max(sort_order) + 1 from public.point_rules), 0)
  )
  returning * into result;

  return result;
end;
$$;

create or replace function public.update_point_rule(
  p_id uuid,
  p_name text,
  p_delta numeric
)
returns public.point_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.point_rules;
  clean_name text := btrim(p_name);
begin
  if p_id is null then
    raise exception 'ID aturan wajib diisi.';
  end if;
  if clean_name is null or length(clean_name) not between 1 and 80 then
    raise exception 'Nama aturan harus berisi 1-80 karakter.';
  end if;
  if p_delta is null or p_delta < -9999999999.99 or p_delta > 9999999999.99 then
    raise exception 'Nilai poin tidak valid.';
  end if;

  select * into result
  from public.point_rules
  where id = p_id
  for update;

  if not found then
    raise exception 'Aturan tidak ditemukan.';
  end if;

  update public.point_rules
  set name = clean_name, delta = p_delta
  where id = p_id
  returning * into result;

  return result;
end;
$$;

create function public.set_point_rule_enabled(p_id uuid, p_enabled boolean)
returns public.point_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.point_rules;
begin
  if p_id is null or p_enabled is null then
    raise exception 'Aturan dan status aktif wajib diisi.';
  end if;

  select * into result
  from public.point_rules
  where id = p_id
  for update;

  if not found then
    raise exception 'Aturan tidak ditemukan.';
  end if;

  update public.point_rules
  set enabled = p_enabled
  where id = p_id
  returning * into result;

  return result;
end;
$$;

revoke all on table public.players, public.point_rules, public.match_entries,
  public.player_standings from public, anon, authenticated;
grant select on table public.players, public.point_rules, public.match_entries,
  public.player_standings to anon, authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.create_player(text) from public, anon, authenticated;
revoke all on function public.update_player(uuid, text) from public, anon, authenticated;
revoke all on function public.set_player_active(uuid, boolean) from public, anon, authenticated;
revoke all on function public.record_result(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.delete_result(uuid) from public, anon, authenticated;
revoke all on function public.create_point_rule(text, numeric, text) from public, anon, authenticated;
revoke all on function public.update_point_rule(uuid, text, numeric) from public, anon, authenticated;
revoke all on function public.set_point_rule_enabled(uuid, boolean) from public, anon, authenticated;

grant execute on function public.create_player(text) to anon, authenticated;
grant execute on function public.update_player(uuid, text) to anon, authenticated;
grant execute on function public.set_player_active(uuid, boolean) to anon, authenticated;
grant execute on function public.record_result(uuid, uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.delete_result(uuid) to anon, authenticated;
grant execute on function public.create_point_rule(text, numeric, text) to anon, authenticated;
grant execute on function public.update_point_rule(uuid, text, numeric) to anon, authenticated;
grant execute on function public.set_point_rule_enabled(uuid, boolean) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'players'
    ) then
      alter publication supabase_realtime add table public.players;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'point_rules'
    ) then
      alter publication supabase_realtime add table public.point_rules;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'match_entries'
    ) then
      alter publication supabase_realtime add table public.match_entries;
    end if;
  end if;
end;
$$;

commit;
