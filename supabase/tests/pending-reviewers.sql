-- Run after both migrations. Test accounts and grants are rolled back.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-000000000101','pending-admin@example.invalid',now()),
 ('00000000-0000-4000-8000-000000000102','pending-reviewer@example.invalid',now()),
 ('00000000-0000-4000-8000-000000000103','pending-new@example.invalid',now()),
 ('00000000-0000-4000-8000-000000000104','pending-unconfirmed@example.invalid',null),
 ('00000000-0000-4000-8000-000000000105','pending-revoked@example.invalid',now());
insert into public.guide_members(user_id,role) values
 ('00000000-0000-4000-8000-000000000101','admin'),
 ('00000000-0000-4000-8000-000000000102','reviewer');
insert into public.guide_audit(actor,action,subject_user) values
 ('00000000-0000-4000-8000-000000000101','revoke_reviewer','00000000-0000-4000-8000-000000000105');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
do $$begin
 if not exists(select 1 from public.guide_list_pending_reviewers() where email='pending-new@example.invalid') then
   raise exception 'FAIL: confirmed new account missing'; end if;
 if exists(select 1 from public.guide_list_pending_reviewers() where email in
   ('pending-admin@example.invalid','pending-reviewer@example.invalid','pending-unconfirmed@example.invalid','pending-revoked@example.invalid')) then
   raise exception 'FAIL: ineligible account listed'; end if;
 begin perform public.guide_grant_reviewer('pending-unconfirmed@example.invalid');
   raise exception 'FAIL: unconfirmed account granted';
 exception when raise_exception then
   if SQLERRM not like 'Compte confirmé introuvable.%' then raise; end if;
 end;
end;$$;

-- Reviewers, unapproved users and anonymous visitors cannot enumerate emails.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000102',true);
do $$begin
 begin perform * from public.guide_list_pending_reviewers();
   raise exception 'FAIL: reviewer enumerated emails';
 exception when insufficient_privilege then null; end;
end;$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000103',true);
do $$begin
 begin perform * from public.guide_list_pending_reviewers();
   raise exception 'FAIL: pending user enumerated emails';
 exception when insufficient_privilege then null; end;
 if exists(select 1 from public.guide_documents) then raise exception 'FAIL: pending user reads book'; end if;
end;$$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$begin
 begin perform * from public.guide_list_pending_reviewers();
   raise exception 'FAIL: anonymous enumerated emails';
 exception when insufficient_privilege then null; end;
end;$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',true);
do $$begin
 perform public.guide_grant_reviewer('pending-new@example.invalid');
 if exists(select 1 from public.guide_list_pending_reviewers() where email='pending-new@example.invalid') then
   raise exception 'FAIL: accepted account remains pending'; end if;
 if not exists(select 1 from public.guide_members where user_id='00000000-0000-4000-8000-000000000103' and role='reviewer') then
   raise exception 'FAIL: grant not recorded'; end if;
 perform public.guide_revoke_reviewer('00000000-0000-4000-8000-000000000103');
 if exists(select 1 from public.guide_list_pending_reviewers() where email='pending-new@example.invalid') then
   raise exception 'FAIL: revoked account reappeared'; end if;
end;$$;
reset role;
rollback;
select 'Pending reviewer tests passed; all temporary data rolled back.' as result;
