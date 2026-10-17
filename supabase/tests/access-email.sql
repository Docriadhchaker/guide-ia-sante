-- Disposable database only. No external email is sent; fixtures are rolled back.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-000000000301','mail-admin@example.invalid',now()),
 ('00000000-0000-4000-8000-000000000302','mail-reviewer@example.invalid',now()),
 ('00000000-0000-4000-8000-000000000303','mail-retry@example.invalid',now()),
 ('00000000-0000-4000-8000-000000000304','mail-revoked@example.invalid',now()),
 ('00000000-0000-4000-8000-000000000305','mail-changed@example.invalid',now()),
 ('00000000-0000-4000-8000-000000000306','mail-unconfirmed@example.invalid',null);
insert into public.guide_members(user_id,role) values('00000000-0000-4000-8000-000000000301','admin');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000301',true);
do $$begin
 perform public.guide_grant_reviewer('mail-reviewer@example.invalid');
 perform public.guide_grant_reviewer('mail-reviewer@example.invalid');
 perform public.guide_grant_reviewer('mail-retry@example.invalid');
 perform public.guide_grant_reviewer('mail-revoked@example.invalid');
 perform public.guide_grant_reviewer('mail-changed@example.invalid');
 if (select count(*) from public.guide_list_access_emails())<>4 then raise exception 'FAIL: grant queued duplicate or missing notifications'; end if;
 begin perform public.guide_grant_reviewer('mail-unconfirmed@example.invalid');raise exception 'FAIL: unconfirmed grant';
 exception when raise_exception then if SQLERRM not like 'Compte confirmé introuvable.%' then raise; end if;end;
 begin perform public.guide_claim_access_email('00000000-0000-4000-8000-000000000302');raise exception 'FAIL: client claimed mail';
 exception when insufficient_privilege then null;end;
 begin perform public.guide_finish_access_email(gen_random_uuid(),gen_random_uuid(),'fake',null);raise exception 'FAIL: client marked sent';
 exception when insufficient_privilege then null;end;
 begin perform * from public.guide_access_emails;raise exception 'FAIL: client reads raw outbox';
 exception when insufficient_privilege then null;end;
 perform public.guide_revoke_reviewer('00000000-0000-4000-8000-000000000304');
end;$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000302',true);
do $$begin
 begin perform * from public.guide_list_access_emails();raise exception 'FAIL: reviewer enumerates recipients';
 exception when insufficient_privilege then null;end;
end;$$;
set local role anon;
do $$begin
 begin perform * from public.guide_list_access_emails();raise exception 'FAIL: anonymous enumerates recipients';
 exception when insufficient_privilege then null;end;
 begin perform public.guide_claim_access_email('00000000-0000-4000-8000-000000000302');raise exception 'FAIL: anonymous sends mail';
 exception when insufficient_privilege then null;end;
end;$$;
reset role;
update auth.users set email='different@example.invalid' where id='00000000-0000-4000-8000-000000000305';
set local role service_role;
do $$declare j jsonb;again jsonb;begin
 j=public.guide_claim_access_email('00000000-0000-4000-8000-000000000302');
 if j->>'status'<>'send' or j->>'recipient'<>'mail-reviewer@example.invalid' then raise exception 'FAIL: wrong claim';end if;
 again=public.guide_claim_access_email('00000000-0000-4000-8000-000000000302');
 if again->>'status'<>'sending' then raise exception 'FAIL: duplicate concurrent claim';end if;
 if public.guide_finish_access_email((j->>'id')::uuid,gen_random_uuid(),'fake',null) then raise exception 'FAIL: wrong lease accepted';end if;
 if not public.guide_finish_access_email((j->>'id')::uuid,(j->>'claim_token')::uuid,'provider-1',null) then raise exception 'FAIL: valid result rejected';end if;
 if public.guide_claim_access_email('00000000-0000-4000-8000-000000000302')->>'status'<>'sent' then raise exception 'FAIL: sent mail retried';end if;
 if public.guide_claim_access_email('00000000-0000-4000-8000-000000000301')->>'status'<>'not_requested' then raise exception 'FAIL: admin mail queued';end if;
 if public.guide_claim_access_email('00000000-0000-4000-8000-000000000304')->>'status'<>'cancelled' then raise exception 'FAIL: revoked access mailed';end if;
 if public.guide_claim_access_email('00000000-0000-4000-8000-000000000305')->>'status'<>'cancelled' then raise exception 'FAIL: changed email mailed';end if;
 j=public.guide_claim_access_email('00000000-0000-4000-8000-000000000303');
 perform public.guide_finish_access_email((j->>'id')::uuid,(j->>'claim_token')::uuid,null,'Temporary outage');
 if public.guide_claim_access_email('00000000-0000-4000-8000-000000000303')->>'status'<>'sending' then raise exception 'FAIL: cooldown not enforced';end if;
 perform set_config('test.mail_job',j->>'id',true);
end;$$;
reset role;
update public.guide_access_emails set last_attempt_at=clock_timestamp()-interval '2 minutes' where user_id='00000000-0000-4000-8000-000000000303';
set local role service_role;
do $$declare j jsonb;begin
 j=public.guide_claim_access_email('00000000-0000-4000-8000-000000000303');
 if j->>'status'<>'send' or j->>'id'<>current_setting('test.mail_job') then raise exception 'FAIL: retry changed idempotency identity';end if;
end;$$;
reset role;
update public.guide_access_emails set first_attempt_at=clock_timestamp()-interval '25 hours',last_attempt_at=clock_timestamp()-interval '2 minutes' where user_id='00000000-0000-4000-8000-000000000303';
set local role service_role;
do $$begin
 if public.guide_claim_access_email('00000000-0000-4000-8000-000000000303')->>'status'<>'attention' then raise exception 'FAIL: duplicate risk after expiry';end if;
end;$$;
reset role;
rollback;
select 'Access email tests passed; no external email sent.' as result;
