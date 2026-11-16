begin;
insert into auth.users(id,email) values
 ('60000000-0000-4000-8000-000000000001','quota-admin@example.invalid'),
 ('60000000-0000-4000-8000-000000000002','quota-reviewer@example.invalid');
insert into public.guide_members(user_id,role) values
 ('60000000-0000-4000-8000-000000000001','admin'),
 ('60000000-0000-4000-8000-000000000002','reviewer');
set local role authenticated;
set local request.jwt.claim.sub='60000000-0000-4000-8000-000000000001';
select public.guide_save_draft('quota-test','chapter','01','CHAPTERS/quota-test.md',0,'Test','# Test',null);
select public.guide_set_release(id,current_version,current_version) from public.guide_documents where id='quota-test';
set local request.jwt.claim.sub='60000000-0000-4000-8000-000000000002';
do $$
declare v uuid; i integer; last_id uuid;
begin
 select published_version into strict v from public.guide_documents where id='quota-test';
 for i in 1..30 loop
    last_id:=gen_random_uuid();
    perform public.guide_create_comment(last_id,'quota-test',v,'','','',null,null,'Test');
 end loop;
 perform public.guide_create_comment(last_id,'quota-test',v,'','','',null,null,'Test');
 begin
   perform public.guide_reply_comment(gen_random_uuid(),last_id,'Remarque suivante');
   raise exception 'Le quota attendu ne fonctionne pas';
 exception when sqlstate 'PT429' then null; end;
 begin
   perform public.guide_review_activity();
   raise exception 'La vue doit être réservée à l’administration';
 exception when insufficient_privilege then null; end;
end; $$;
set local request.jwt.claim.sub='60000000-0000-4000-8000-000000000001';
do $$ begin
 if public.guide_review_activity()<>1 then raise exception 'Signal absent'; end if;
end; $$;
reset role;
update guide_private.review_quota set window_start=now()-interval '2 minutes';
set local role authenticated;
set local request.jwt.claim.sub='60000000-0000-4000-8000-000000000002';
select public.guide_create_comment(gen_random_uuid(),'quota-test',published_version,'','','',null,null,'Nouvelle fenêtre')
 from public.guide_documents where id='quota-test';
rollback;
