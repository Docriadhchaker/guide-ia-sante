-- Activation e-mails: run in the existing guide project. Safe to run twice.
-- No retrospective mailing: only future reviewer grants create notifications.
begin;
create table if not exists public.guide_access_emails (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 grant_created_at timestamptz not null,
 recipient text not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','attention','cancelled')),
 attempts integer not null default 0,
 first_attempt_at timestamptz,
 last_attempt_at timestamptz,
 claim_token uuid,
 provider_id text,
 last_error text,
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 unique(user_id,grant_created_at)
);
alter table public.guide_access_emails enable row level security;
revoke all on public.guide_access_emails from public,anon,authenticated;

create or replace function public.guide_queue_access_email() returns trigger
language plpgsql security definer set search_path='' as $$
declare address text;
begin
 if new.role='reviewer' then
  select email into address from auth.users where id=new.user_id and email_confirmed_at is not null;
  if address is not null then
   insert into public.guide_access_emails(user_id,grant_created_at,recipient)
   values(new.user_id,new.created_at,address) on conflict(user_id,grant_created_at) do nothing;
  end if;
 end if;
 return new;
end; $$;
revoke all on function public.guide_queue_access_email() from public,anon,authenticated;
drop trigger if exists guide_queue_access_email on public.guide_members;
create trigger guide_queue_access_email after insert on public.guide_members
for each row execute function public.guide_queue_access_email();

create or replace function public.guide_list_access_emails()
returns table(id uuid,user_id uuid,email text,status text,attempts integer,created_at timestamptz,sent_at timestamptz,last_error text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.guide_is_admin() then raise exception 'Administration requise' using errcode='42501'; end if;
 return query select e.id,e.user_id,e.recipient,e.status,e.attempts,e.created_at,e.sent_at,e.last_error
 from public.guide_access_emails e join public.guide_members m on m.user_id=e.user_id
 where m.role='reviewer' and m.created_at=e.grant_created_at
 order by e.created_at desc limit 100;
end; $$;
revoke all on function public.guide_list_access_emails() from public,anon,authenticated;
grant execute on function public.guide_list_access_emails() to authenticated;

-- Only the server may claim/finish an e-mail; the browser never receives this role.
create or replace function public.guide_claim_access_email(p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.guide_access_emails; token uuid;
begin
 select * into e from public.guide_access_emails where user_id=p_user order by created_at desc,id desc limit 1 for update;
 if not found then return jsonb_build_object('status','not_requested'); end if;
 if not exists(select 1 from public.guide_members m join auth.users u on u.id=m.user_id
   where m.user_id=e.user_id and m.role='reviewer' and m.created_at=e.grant_created_at
   and u.email_confirmed_at is not null and u.email=e.recipient) then
  update public.guide_access_emails set status='cancelled',claim_token=null where id=e.id;
  return jsonb_build_object('status','cancelled');
 end if;
 if e.status in ('sent','attention','cancelled') then return jsonb_build_object('status',e.status); end if;
 -- Resend retains idempotency keys for 24 h. Stop before that window expires.
 if e.first_attempt_at is not null and e.first_attempt_at < clock_timestamp()-interval '23 hours' then
  update public.guide_access_emails set status='attention',last_error='Vérifier l’envoi dans Resend avant toute nouvelle tentative.' where id=e.id;
  return jsonb_build_object('status','attention');
 end if;
 if e.last_attempt_at > clock_timestamp()-interval '60 seconds' then return jsonb_build_object('status','sending'); end if;
 token=gen_random_uuid();
 update public.guide_access_emails set status='sending',attempts=attempts+1,claim_token=token,
 first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),last_attempt_at=clock_timestamp(),last_error=null where id=e.id;
 return jsonb_build_object('status','send','id',e.id,'recipient',e.recipient,'claim_token',token);
end; $$;

create or replace function public.guide_finish_access_email(p_id uuid,p_claim uuid,p_provider_id text,p_error text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.guide_access_emails set
 status=case when p_provider_id is not null then 'sent' else 'failed' end,
 provider_id=p_provider_id,sent_at=case when p_provider_id is not null then clock_timestamp() else null end,
 last_error=case when p_provider_id is null then left(coalesce(p_error,'Envoi non confirmé.'),300) else null end,
 claim_token=null
 where id=p_id and claim_token=p_claim and status='sending';
 return found;
end; $$;
revoke all on function public.guide_claim_access_email(uuid),public.guide_finish_access_email(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.guide_claim_access_email(uuid),public.guide_finish_access_email(uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
