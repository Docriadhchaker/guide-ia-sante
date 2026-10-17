-- Disposable fixture; all rows and helper functions roll back.
begin;
create function pg_temp.review_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; end; $$;
create function pg_temp.review_denied(statement text,expected text default '42501') returns void language plpgsql as $$
begin
 begin execute statement; exception when others then
  if sqlstate=expected then return; else raise; end if;
 end;
 raise exception 'FAIL: operation unexpectedly allowed: %',statement;
end; $$;
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000001','comments-admin@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000002','comments-a@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000003','comments-b@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000004','comments-pending@example.invalid',now());
insert into public.guide_members(user_id,role) values
 ('10000000-0000-4000-8000-000000000001','admin'),
 ('10000000-0000-4000-8000-000000000002','reviewer'),
 ('10000000-0000-4000-8000-000000000003','reviewer');
set local role authenticated;
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select public.guide_save_draft('comments-test','chapter','1','CHAPTERS/comments-test.md',1,'Texte initial','# Titre ancien
Un passage à commenter.',null);
select public.guide_set_release('comments-test',current_version,current_version) from public.guide_documents where id='comments-test';
select public.guide_save_draft('comments-test','chapter','1','CHAPTERS/comments-test.md',1,'Texte révisé','# Texte nouveau et secret',current_version) from public.guide_documents where id='comments-test';
select public.guide_save_draft('comments-other','chapter','2','CHAPTERS/comments-other.md',2,'Autre document','# Brouillon réservé',null);
reset role;
-- Remember identifiers without granting reviewers access to the draft itself.
select set_config('test.review_v1',(select id::text from public.guide_versions where document_id='comments-test' and version_number=1),true);
select set_config('test.review_v2',(select id::text from public.guide_versions where document_id='comments-test' and version_number=2),true);
select set_config('test.review_other',(select current_version::text from public.guide_documents where id='comments-other'),true);
set local role authenticated;
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';
select public.guide_create_comment('20000000-0000-4000-8000-000000000001','comments-test',current_setting('test.review_v1')::uuid,'titre-ancien','Titre ancien','passage',20,27,'Clarifier ce passage.');
-- Idempotent retry, and changed request cannot overwrite the existing remark.
select public.guide_create_comment('20000000-0000-4000-8000-000000000001','comments-test',current_setting('test.review_v1')::uuid,'titre-ancien','Titre ancien','passage',20,27,'Clarifier ce passage.');
select pg_temp.review_assert((select count(*)=1 from public.guide_review_threads),'one thread after retry');
select pg_temp.review_assert((select count(*)=1 from public.guide_review_messages),'one initial message after retry');
select pg_temp.review_denied($q$select public.guide_create_comment('20000000-0000-4000-8000-000000000001','comments-test',current_setting('test.review_v1')::uuid,'titre-ancien','Titre ancien','passage',20,27,'Changed content')$q$);
select pg_temp.review_denied($q$select public.guide_create_comment('20000000-0000-4000-8000-000000000002','comments-test',current_setting('test.review_v2')::uuid,'','','',null,null,'Draft attack')$q$,'40001');
select pg_temp.review_denied($q$select public.guide_create_comment('20000000-0000-4000-8000-000000000003','comments-test',current_setting('test.review_other')::uuid,'','','',null,null,'Foreign version')$q$);
select pg_temp.review_denied($q$update public.guide_review_threads set status='resolved'$q$);
select pg_temp.review_denied($q$insert into public.guide_review_messages(thread_id,author_id,body) values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Spoofed')$q$);
select pg_temp.review_denied($q$select public.guide_set_comment_status('20000000-0000-4000-8000-000000000001','resolved','pending')$q$);
select pg_temp.review_assert(jsonb_array_length(public.guide_list_comments())=1,'owner list');
select pg_temp.review_assert(public.guide_comment_source('20000000-0000-4000-8000-000000000001')->>'title'='Texte initial','original version source');
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000003';
select pg_temp.review_assert((select count(*)=0 from public.guide_review_threads),'reviewer B cannot select A threads');
select pg_temp.review_assert((select count(*)=0 from public.guide_review_messages),'reviewer B cannot select A messages');
select pg_temp.review_assert(public.guide_list_comments()='[]'::jsonb,'B list does not leak email, quotes or messages');
select pg_temp.review_denied($q$select public.guide_comment_source('20000000-0000-4000-8000-000000000001')$q$);
select pg_temp.review_denied($q$select public.guide_reply_comment('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Intrusion')$q$);
select public.guide_create_comment('20000000-0000-4000-8000-000000000004','comments-test',current_setting('test.review_v1')::uuid,'','','',null,null,'Remarque de B');
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select pg_temp.review_assert(jsonb_array_length(public.guide_list_comments())=2,'admin sees both reviewers');
select public.guide_reply_comment('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Merci, correction prévue.');
select public.guide_reply_comment('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Merci, correction prévue.');
select public.guide_set_comment_status('20000000-0000-4000-8000-000000000001','accepted','pending');
select pg_temp.review_denied($q$select public.guide_set_comment_status('20000000-0000-4000-8000-000000000001','resolved','pending')$q$,'40001');
select public.guide_set_release('comments-test',current_version,current_version) from public.guide_documents where id='comments-test';
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';
select pg_temp.review_assert((select count(*)=0 from public.guide_versions where id=current_setting('test.review_v1')::uuid),'old version not generally readable');
select pg_temp.review_assert(public.guide_comment_source('20000000-0000-4000-8000-000000000001')->>'title'='Texte initial','owner can reopen exact old commented version');
select pg_temp.review_assert(public.guide_list_comments()->0->>'status'='accepted','owner sees followup');
select pg_temp.review_assert(jsonb_array_length(public.guide_list_comments()->0->'messages')=3,'reply retry is idempotent and status recorded');
select public.guide_reply_comment('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','Merci pour la réponse.');
select pg_temp.review_denied($q$select public.guide_create_comment('20000000-0000-4000-8000-000000000005','comments-test',current_setting('test.review_v1')::uuid,'','','',null,null,'Stale browser')$q$,'40001');
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000004';
select pg_temp.review_assert((select count(*)=0 from public.guide_review_threads),'pending account has no access');
select pg_temp.review_denied($q$select public.guide_list_comments()$q$);
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
select public.guide_revoke_reviewer('10000000-0000-4000-8000-000000000002');
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';
select pg_temp.review_assert((select count(*)=0 from public.guide_review_threads),'revoked owner loses access');
select pg_temp.review_assert((select count(*)=0 from public.guide_review_messages),'revoked owner cannot read replies');
select pg_temp.review_denied($q$select public.guide_comment_source('20000000-0000-4000-8000-000000000001')$q$);
select pg_temp.review_denied($q$select public.guide_reply_comment('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','Revoked')$q$);
reset role;
set local role anon;
set local request.jwt.claim.sub='';
select pg_temp.review_denied($q$select public.guide_list_comments()$q$);
select pg_temp.review_denied($q$select * from public.guide_review_threads$q$);
select pg_temp.review_denied($q$select * from public.guide_review_messages$q$);
reset role;
select 'Comment privacy, historical versions, replies, status and revocation passed.' as result;
rollback;
