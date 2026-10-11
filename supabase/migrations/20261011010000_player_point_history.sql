begin;

create function public.get_player_point_history(p_limit integer default 20)
returns table (
  player_id uuid,
  entry_id uuid,
  point_delta numeric(12, 2),
  recorded_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id as player_id,
    recent.id as entry_id,
    recent.point_delta,
    recent.recorded_at
  from public.players p
  join lateral (
    select me.id, me.point_delta, me.recorded_at
    from public.match_entries me
    where me.player_id = p.id
    order by me.recorded_at desc, me.id desc
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
  ) recent on true
  order by
    p.active desc,
    lower(p.name),
    p.created_at,
    p.id,
    recent.recorded_at desc,
    recent.id desc;
$$;

revoke all on function public.get_player_point_history(integer)
from public, anon, authenticated;

grant execute on function public.get_player_point_history(integer)
to anon, authenticated;

commit;
