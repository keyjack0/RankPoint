begin;

create function public.delete_player(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_id uuid;
begin
  if p_id is null then
    raise exception 'ID pemain wajib diisi.';
  end if;

  select id into locked_id
  from public.players
  where id = p_id
  for update;

  if not found then
    raise exception 'Pemain tidak ditemukan.';
  end if;

  delete from public.match_entries where player_id = p_id;
  delete from public.players where id = p_id;

  return true;
end;
$$;

revoke all on function public.delete_player(uuid)
  from public, anon, authenticated;

grant execute on function public.delete_player(uuid)
  to anon, authenticated;

commit;
