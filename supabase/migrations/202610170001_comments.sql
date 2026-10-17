-- Private review threads. Safe to rerun; no manuscript or memberships changed.
begin;

create table if not exists public.guide_review_threads (
 id uuid primary key default gen_random_uuid(),
 document_id text not null,
 version_id uuid not null,
 reviewer_id uuid not null references auth.users(id) on delete cascade,
 section_id text not null default '' check (length(section_id)<=500),
 section_title text not null default '' check (length(section_title)<=1000),
 quote text not null default '' check (length(quote)<=4000),
 anchor_start integer,
 anchor_end integer,
 status text not null default 'pending' check (status in ('pending','accepted','declined','resolved')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key (document_id,version_id) references public.guide_versions(document_id,id),
 check ((anchor_start is null and anchor_end is null) or
   (anchor_start is not null and anchor_end is not null and anchor_start>=0 and anchor_end>anchor_start and anchor_end<=4000000))
);
create table if not exists public.guide_review_messages (
 id uuid primary key default gen_random_uuid(),
 thread_id uuid not null references public.guide_review_threads(id) on delete cascade,
 author_id uuid not null references auth.users(id),
 body text not null check (length(btrim(body)) between 1 and 10000),
 kind text not null default 'message' check (kind in ('message','status')),
 status text check (status in ('pending','accepted','declined','resolved')),
 created_at timestamptz not null default now()
);
create index if not exists guide_review_owner_idx on public.guide_review_threads(reviewer_id,created_at,id);
create index if not exists guide_review_document_idx on public.guide_review_threads(document_id);
create index if not exists guide_review_messages_idx on public.guide_review_messages(thread_id,created_at,id);
alter table public.guide_review_threads enable row level security;
alter table public.guide_review_messages enable row level security;
drop policy if exists review_threads_read on public.guide_review_threads;
create policy review_threads_read on public.guide_review_threads for select to authenticated
 using ((select public.guide_is_admin()) or ((select public.guide_is_member()) and reviewer_id=(select auth.uid())));
drop policy if exists review_messages_read on public.guide_review_messages;
create policy review_messages_read on public.guide_review_messages for select to authenticated
 using (exists(select 1 from public.guide_review_threads t where t.id=thread_id));
revoke all on public.guide_review_threads, public.guide_review_messages from public,anon,authenticated;
grant select on public.guide_review_threads, public.guide_review_messages to authenticated;

create or replace function public.guide_create_comment(
 p_id uuid, p_document text, p_version uuid, p_section text, p_section_title text,
 p_quote text, p_start integer, p_end integer, p_body text
) returns uuid language plpgsql security definer set search_path='' as $$
declare d public.guide_documents; previous public.guide_review_threads;
begin
 if not public.guide_is_member() then raise exception 'Accès requis' using errcode='42501'; end if;
 if p_id is null or p_body is null or length(btrim(p_body)) not between 1 and 10000 then raise exception 'Commentaire requis (10 000 caractères maximum)'; end if;
 -- Stable request id makes retry after an uncertain connection safe.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select * into previous from public.guide_review_threads where id=p_id;
 if found then
  if previous.reviewer_id=auth.uid() and previous.document_id=p_document and previous.version_id=p_version
    and previous.quote=coalesce(p_quote,'') and previous.section_id=coalesce(p_section,'')
    and previous.section_title=coalesce(p_section_title,'') and previous.anchor_start is not distinct from p_start
    and previous.anchor_end is not distinct from p_end
    and exists(select 1 from public.guide_review_messages where id=p_id and body=btrim(p_body)) then return p_id; end if;
  raise exception 'Identifiant de commentaire déjà utilisé' using errcode='42501';
 end if;
 select * into d from public.guide_documents where id=p_document for share;
 if not found or not exists(select 1 from public.guide_versions where id=p_version and document_id=p_document) then
  raise exception 'Document ou version inaccessible' using errcode='42501'; end if;
 if not public.guide_is_admin() and d.published_version is distinct from p_version then
  raise exception 'La version accessible a changé. Copiez votre remarque, puis reconnectez-vous pour relire le passage.' using errcode='40001'; end if;
 insert into public.guide_review_threads(id,document_id,version_id,reviewer_id,section_id,section_title,quote,anchor_start,anchor_end)
 values(p_id,p_document,p_version,auth.uid(),coalesce(p_section,''),coalesce(p_section_title,''),coalesce(p_quote,''),p_start,p_end);
 insert into public.guide_review_messages(id,thread_id,author_id,body) values(p_id,p_id,auth.uid(),btrim(p_body));
 return p_id;
end; $$;

create or replace function public.guide_reply_comment(p_id uuid,p_thread uuid,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare t public.guide_review_threads; m public.guide_review_messages;
begin
 if not public.guide_is_member() then raise exception 'Accès requis' using errcode='42501'; end if;
 if p_id is null or p_body is null or length(btrim(p_body)) not between 1 and 10000 then raise exception 'Réponse requise (10 000 caractères maximum)'; end if;
 select * into t from public.guide_review_threads where id=p_thread for update;
 if not found or not (public.guide_is_admin() or t.reviewer_id=auth.uid()) then raise exception 'Commentaire inaccessible' using errcode='42501'; end if;
 select * into m from public.guide_review_messages where id=p_id;
 if found then
  if m.thread_id=p_thread and m.author_id=auth.uid() and m.kind='message' and m.body=btrim(p_body) then return p_id; end if;
  raise exception 'Identifiant de réponse déjà utilisé' using errcode='42501';
 end if;
 insert into public.guide_review_messages(id,thread_id,author_id,body) values(p_id,p_thread,auth.uid(),btrim(p_body));
 update public.guide_review_threads set updated_at=clock_timestamp() where id=p_thread;
 return p_id;
end; $$;

create or replace function public.guide_set_comment_status(p_thread uuid,p_status text,p_expected text)
returns void language plpgsql security definer set search_path='' as $$
declare t public.guide_review_threads;
begin
 if not public.guide_is_admin() then raise exception 'Administration requise' using errcode='42501'; end if;
 if p_status is null or p_status not in ('pending','accepted','declined','resolved') then raise exception 'Statut invalide'; end if;
 select * into t from public.guide_review_threads where id=p_thread for update;
 if not found then raise exception 'Commentaire introuvable'; end if;
 if t.status=p_status then return; end if;
 if t.status is distinct from p_expected then raise exception 'Le statut a changé. Actualisez la liste.' using errcode='40001'; end if;
 update public.guide_review_threads set status=p_status,updated_at=clock_timestamp() where id=p_thread;
 insert into public.guide_review_messages(thread_id,author_id,body,kind,status)
 values(p_thread,auth.uid(),case p_status when 'pending' then 'À examiner' when 'accepted' then 'Retenu' when 'declined' then 'Non retenu' else 'Traité' end,'status',p_status);
end; $$;

create or replace function public.guide_list_comments(p_document text default null,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.guide_is_member() then raise exception 'Accès requis' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 then raise exception 'Pagination invalide'; end if;
 select coalesce(jsonb_agg(item order by created_at,id),'[]'::jsonb) into result from (
  select t.created_at,t.id,to_jsonb(t)||jsonb_build_object(
   'document_title',v.title,'version_number',v.version_number,'reviewer_email',u.email,
   'published_version',d.published_version,
   'messages',(select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('author_email',mu.email) order by m.created_at,m.id),'[]'::jsonb)
      from public.guide_review_messages m join auth.users mu on mu.id=m.author_id where m.thread_id=t.id)) as item
  from public.guide_review_threads t join public.guide_versions v on v.id=t.version_id
  join public.guide_documents d on d.id=t.document_id join auth.users u on u.id=t.reviewer_id
  where (public.guide_is_admin() or t.reviewer_id=auth.uid()) and (p_document is null or t.document_id=p_document)
  order by t.created_at,t.id limit 100 offset p_offset
 ) entries;
 return result;
end; $$;

-- Historical text only through a thread the member owns (or author administration).
-- Other drafts and other reviewers' historical versions remain inaccessible.
create or replace function public.guide_comment_source(p_thread uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.guide_review_threads; result jsonb;
begin
 if not public.guide_is_member() then raise exception 'Accès requis' using errcode='42501'; end if;
 select * into t from public.guide_review_threads where id=p_thread;
 if not found or not (public.guide_is_admin() or t.reviewer_id=auth.uid()) then raise exception 'Commentaire inaccessible' using errcode='42501'; end if;
 select to_jsonb(v)||jsonb_build_object('id',d.id,'version_id',v.id,'kind',d.kind,'number',d.number,'source_path',d.source_path)
 into result from public.guide_versions v join public.guide_documents d on d.id=v.document_id where v.id=t.version_id;
 return result;
end; $$;

revoke all on function public.guide_create_comment(uuid,text,uuid,text,text,text,integer,integer,text),
 public.guide_reply_comment(uuid,uuid,text),public.guide_set_comment_status(uuid,text,text),
 public.guide_list_comments(text,integer),public.guide_comment_source(uuid) from public,anon,authenticated;
grant execute on function public.guide_create_comment(uuid,text,uuid,text,text,text,integer,integer,text),
 public.guide_reply_comment(uuid,uuid,text),public.guide_set_comment_status(uuid,text,text),
 public.guide_list_comments(text,integer),public.guide_comment_source(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
