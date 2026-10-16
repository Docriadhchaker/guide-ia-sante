-- Run in SQL Editor AFTER migration. Entire test is rolled back, including users.
-- This checks actual Postgres permissions; unit tests of the UI do not replace it.
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-4000-8000-000000000001','guide-test-admin@example.invalid',now()),
 ('00000000-0000-4000-8000-000000000002','guide-test-reviewer@example.invalid',now()),
 ('00000000-0000-4000-8000-000000000003','guide-test-stranger@example.invalid',now());
insert into public.guide_members(user_id,role) values
 ('00000000-0000-4000-8000-000000000001','admin'),
 ('00000000-0000-4000-8000-000000000002','reviewer');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$declare v uuid; begin
 v:=public.guide_save_draft('test-access','chapter','99','CHAPTERS/99_test_access.md',99,'Titre','# Première version',null);
 if (select count(*) from public.guide_versions where document_id='test-access')<>1 then raise exception 'FAIL: admin save'; end if;
end;$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$begin
 if exists(select 1 from public.guide_documents where id='test-access') then raise exception 'FAIL: reviewer sees draft'; end if;
 if exists(select 1 from public.guide_versions where document_id='test-access') then raise exception 'FAIL: reviewer sees draft body'; end if;
 begin perform public.guide_save_draft('test-forbidden','chapter','','CHAPTERS/forbidden.md',99,'Titre','Texte',null);raise exception 'FAIL: reviewer wrote';exception when insufficient_privilege then null;end;
 begin insert into public.guide_members(user_id,role) values(auth.uid(),'admin');raise exception 'FAIL: self promotion';exception when insufficient_privilege then null;end;
end;$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$declare v uuid; begin
 select current_version into v from public.guide_documents where id='test-access';
 perform public.guide_set_release('test-access',v,v);
 perform public.guide_save_draft('test-access','chapter','99','CHAPTERS/99_test_access.md',99,'Titre','# Deuxième version privée',v);
 begin perform public.guide_save_draft('test-access','chapter','99','CHAPTERS/99_test_access.md',99,'Titre','Écrasement obsolète',v);raise exception 'FAIL: stale overwrite';exception when serialization_failure then null;end;
end;$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
do $$begin
 if (select count(*) from public.guide_versions where document_id='test-access')<>1 then raise exception 'FAIL: reviewer version isolation'; end if;
 if (select markdown from public.guide_versions where document_id='test-access')<>'# Première version' then raise exception 'FAIL: reviewer sees unpublished revision'; end if;
 begin perform public.guide_set_release('test-access',null,null);raise exception 'FAIL: reviewer unpublished';exception when insufficient_privilege then null;end;
end;$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
do $$begin
 if exists(select 1 from public.guide_documents where id='test-access') or exists(select 1 from public.guide_versions where document_id='test-access') then raise exception 'FAIL: unapproved user sees content'; end if;
end;$$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$begin
 begin perform 1 from public.guide_versions;raise exception 'FAIL: anonymous table access';exception when insufficient_privilege then null;end;
 begin perform public.guide_set_release('test-access',null,null);raise exception 'FAIL: anonymous function access';exception when insufficient_privilege then null;end;
end;$$;
reset role;
rollback;
select 'Access tests passed; all temporary data rolled back.' as result;
