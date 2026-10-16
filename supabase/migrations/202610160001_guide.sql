-- Guide IA en santé. Execute once in a dedicated Supabase project.
-- No manuscript or credentials in this migration. No public reading policy.
begin;

create table public.guide_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','reviewer')),
  created_at timestamptz not null default now()
);
create table public.guide_documents (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  kind text not null check (kind in ('chapter','notice','index')),
  number text not null default '',
  source_path text not null unique,
  sort_order integer not null default 0,
  current_version uuid,
  published_version uuid,
  updated_at timestamptz not null default now()
);
create table public.guide_versions (
  id uuid primary key default gen_random_uuid(),
  document_id text not null references public.guide_documents(id),
  title text not null check (length(title) between 1 and 500),
  markdown text not null check (octet_length(markdown) between 1 and 2097152),
  version_number integer not null check (version_number > 0),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (document_id, version_number),
  unique (document_id, id)
);
alter table public.guide_documents add constraint guide_current_fk
 foreign key (id,current_version) references public.guide_versions(document_id,id) deferrable initially deferred;
alter table public.guide_documents add constraint guide_published_fk
 foreign key (id,published_version) references public.guide_versions(document_id,id) deferrable initially deferred;
create table public.guide_audit (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id),
  action text not null,
  document_id text references public.guide_documents(id),
  version_id uuid references public.guide_versions(id),
  subject_user uuid,
  created_at timestamptz not null default now()
);

create function public.guide_is_admin() returns boolean
 language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.guide_members where user_id=(select auth.uid()) and role='admin');
$$;
create function public.guide_is_member() returns boolean
 language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.guide_members where user_id=(select auth.uid()));
$$;

alter table public.guide_members enable row level security;
alter table public.guide_documents enable row level security;
alter table public.guide_versions enable row level security;
alter table public.guide_audit enable row level security;

create policy members_read on public.guide_members for select to authenticated
 using (user_id=(select auth.uid()) or (select public.guide_is_admin()));
create policy documents_read on public.guide_documents for select to authenticated
 using ((select public.guide_is_admin()) or ((select public.guide_is_member()) and published_version is not null));
create policy versions_read on public.guide_versions for select to authenticated
 using ((select public.guide_is_admin()) or ((select public.guide_is_member()) and exists
  (select 1 from public.guide_documents d where d.id=document_id and d.published_version=guide_versions.id)));
create policy audit_read on public.guide_audit for select to authenticated using ((select public.guide_is_admin()));

revoke all on public.guide_members, public.guide_documents, public.guide_versions, public.guide_audit from anon, authenticated;
grant select on public.guide_members, public.guide_documents, public.guide_versions, public.guide_audit to authenticated;
-- Clients cannot insert/update/delete tables, even with an administrator session.
-- Mutations go through functions that check the role and lock the document.
create function public.guide_save_draft(
 p_id text, p_kind text, p_number text, p_source_path text, p_sort_order integer,
 p_title text, p_markdown text, p_expected_version uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.guide_documents; v uuid; n integer;
begin
 if not public.guide_is_admin() then raise exception 'Administration requise' using errcode='42501'; end if;
 if p_id is null or p_kind is null or p_source_path is null or p_title is null or p_markdown is null
    or btrim(p_markdown)='' or btrim(p_title)='' then raise exception 'Contenu incomplet'; end if;
 if p_source_path !~ '^(CHAPTERS|FRONT_MATTER|INDEX)/[^/\\]+\.md$' or position('..' in p_source_path)>0
    then raise exception 'Chemin de source non autorisé'; end if;
 insert into public.guide_documents(id,kind,number,source_path,sort_order)
 values(p_id,p_kind,coalesce(p_number,''),p_source_path,p_sort_order) on conflict(id) do nothing;
 select * into d from public.guide_documents where id=p_id for update;
 if d.current_version is distinct from p_expected_version then
   raise exception 'VERSION_CONFLICT: rechargez le chapitre avant de le modifier' using errcode='40001';
 end if;
 if d.source_path<>p_source_path or d.kind<>p_kind then raise exception 'Identité du document différente'; end if;
 select coalesce(max(version_number),0)+1 into n from public.guide_versions where document_id=p_id;
 insert into public.guide_versions(document_id,title,markdown,version_number,created_by)
 values(p_id,p_title,p_markdown,n,auth.uid()) returning id into v;
 update public.guide_documents set current_version=v,number=coalesce(p_number,''),sort_order=p_sort_order,updated_at=now() where id=p_id;
 insert into public.guide_audit(actor,action,document_id,version_id) values(auth.uid(),'save_draft',p_id,v);
 return v;
end; $$;

create function public.guide_set_release(p_id text, p_version uuid, p_expected_version uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.guide_documents;
begin
 if not public.guide_is_admin() then raise exception 'Administration requise' using errcode='42501'; end if;
 select * into d from public.guide_documents where id=p_id for update;
 if not found then raise exception 'Document introuvable'; end if;
 if d.current_version is distinct from p_expected_version then raise exception 'VERSION_CONFLICT: rechargez le chapitre' using errcode='40001'; end if;
 if p_version is not null and not exists(select 1 from public.guide_versions where id=p_version and document_id=p_id)
   then raise exception 'Version étrangère au document'; end if;
 update public.guide_documents set published_version=p_version,updated_at=now() where id=p_id;
 insert into public.guide_audit(actor,action,document_id,version_id)
 values(auth.uid(),case when p_version is null then 'unpublish' else 'release' end,p_id,p_version);
end; $$;

create function public.guide_grant_reviewer(p_email text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
 if not public.guide_is_admin() then raise exception 'Administration requise' using errcode='42501'; end if;
 select id into target from auth.users where lower(email)=lower(btrim(p_email)) and email_confirmed_at is not null;
 if target is null then raise exception 'Compte confirmé introuvable. Le reviewer doit créer et confirmer son compte.'; end if;
 insert into public.guide_members(user_id,role) values(target,'reviewer') on conflict(user_id) do nothing;
 insert into public.guide_audit(actor,action,subject_user) values(auth.uid(),'grant_reviewer',target);
 return target;
end; $$;

create function public.guide_revoke_reviewer(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if not public.guide_is_admin() then raise exception 'Administration requise' using errcode='42501'; end if;
 delete from public.guide_members where user_id=p_user and role='reviewer';
 if found then insert into public.guide_audit(actor,action,subject_user) values(auth.uid(),'revoke_reviewer',p_user); end if;
end; $$;

create function public.guide_list_members() returns table(user_id uuid,email text,role text)
language plpgsql security definer set search_path = '' as $$
begin
 if not public.guide_is_admin() then raise exception 'Administration requise' using errcode='42501'; end if;
 return query select m.user_id,u.email::text,m.role from public.guide_members m join auth.users u on u.id=m.user_id order by m.created_at;
end; $$;

revoke all on function public.guide_is_admin(),public.guide_is_member(),
 public.guide_save_draft(text,text,text,text,integer,text,text,uuid),
 public.guide_set_release(text,uuid,uuid),public.guide_grant_reviewer(text),
 public.guide_revoke_reviewer(uuid),public.guide_list_members() from public,anon,authenticated;
grant execute on function public.guide_is_admin(),public.guide_is_member(),
 public.guide_save_draft(text,text,text,text,integer,text,text,uuid),
 public.guide_set_release(text,uuid,uuid),public.guide_grant_reviewer(text),
 public.guide_revoke_reviewer(uuid),public.guide_list_members() to authenticated;

commit;
