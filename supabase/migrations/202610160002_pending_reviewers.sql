-- Run in Supabase SQL Editor on the existing dedicated guide project.
-- Adds an administrator-only list; does not grant access to any account.
begin;

create or replace function public.guide_list_pending_reviewers()
returns table(user_id uuid,email text,confirmed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
 if not public.guide_is_admin() then
   raise exception 'Administration requise' using errcode='42501';
 end if;
 return query
 select u.id,u.email::text,u.email_confirmed_at
 from auth.users u
 where u.email_confirmed_at is not null
   and u.email is not null and btrim(u.email)<>''
   and not exists(select 1 from public.guide_members m where m.user_id=u.id)
   -- Withdrawing an existing access must not recreate a new pending signup.
   and not exists(select 1 from public.guide_audit a
                  where a.subject_user=u.id and a.action='revoke_reviewer')
 order by u.email_confirmed_at desc,u.id;
end; $$;

revoke all on function public.guide_list_pending_reviewers() from public,anon,authenticated;
grant execute on function public.guide_list_pending_reviewers() to authenticated;
notify pgrst, 'reload schema';
commit;
