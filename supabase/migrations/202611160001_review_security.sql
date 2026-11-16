-- Bound authenticated review writes and expose a one-day aggregate to guide administrators.
begin;
create schema if not exists guide_private;
revoke all on schema guide_private from public, anon, authenticated;
create table if not exists guide_private.review_quota (
  actor uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  writes integer not null,
  last_threshold timestamptz
);
alter table guide_private.review_quota enable row level security;
revoke all on guide_private.review_quota from public, anon, authenticated;

create or replace function guide_private.count_review_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  observed timestamptz := clock_timestamp();
  total integer;
begin
  if auth.uid() is null then return new; end if;
  -- A single row per account serializes concurrent writes and needs no cleanup job.
  insert into guide_private.review_quota as q (actor,window_start,writes)
    values (new.author_id,observed,1)
  on conflict (actor) do update set
    writes = case when q.window_start <= observed - interval '1 minute' then 1 else q.writes+1 end,
    window_start = case when q.window_start <= observed - interval '1 minute' then observed else q.window_start end,
    last_threshold = case when q.window_start > observed - interval '1 minute' and q.writes=29 then observed else q.last_threshold end
  where q.window_start <= observed - interval '1 minute' or q.writes < 30
  returning writes into total;
  if total is null then
    raise exception using errcode='PT429',message='Limite de remarques atteinte. Réessayez dans une minute.';
  end if;
  if total=30 then raise log 'guide_review_quota_reached'; end if;
  return new;
end;
$$;
revoke all on function guide_private.count_review_write() from public, anon, authenticated;
drop trigger if exists guide_count_review_write on public.guide_review_messages;
create trigger guide_count_review_write after insert on public.guide_review_messages
  for each row execute function guide_private.count_review_write();

create or replace function public.guide_review_activity()
returns integer language plpgsql stable security definer set search_path='' as $$
begin
  if not public.guide_is_admin() then
    raise exception using errcode='42501',message='Administration requise';
  end if;
  return (select count(*)::integer from guide_private.review_quota
          where last_threshold >= statement_timestamp() - interval '24 hours');
end;
$$;
revoke all on function public.guide_review_activity() from public, anon, authenticated;
grant execute on function public.guide_review_activity() to authenticated;
commit;
