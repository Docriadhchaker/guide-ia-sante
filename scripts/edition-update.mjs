import crypto from 'node:crypto';

const md5=text=>crypto.createHash('md5').update(text,'utf8').digest('hex');
const quote=text=>"'"+text.replaceAll("'","''")+"'";
export function editionSQL(documents, baseline, release='edition_20261017') {
  if(!/^[a-z0-9_]+$/.test(release)||!documents.length)throw Error('Invalid release');
  const old=new Map(baseline.map(d=>[d.id,d])), seen=new Set();
  const rows=documents.map(d=>{
    if(seen.has(d.id)||!/^[a-z0-9-]+$/.test(d.id)||!['chapter','notice','index'].includes(d.kind))throw Error('Invalid identity');
    if(!/^(CHAPTERS|FRONT_MATTER|INDEX)\/[^/\\]+\.md$/.test(d.source_path)||d.source_path.includes('..'))throw Error('Invalid source');
    if(!d.markdown||!d.title||Buffer.byteLength(d.markdown)>2097152)throw Error('Invalid content');
    seen.add(d.id);
    const prev=old.get(d.id);
    if(prev&&(prev.kind!==d.kind||prev.source_path!==d.source_path))throw Error('Identity mismatch');
    return {...d,baseline_md5:prev?md5(prev.markdown):null,baseline_title:prev?.title??null,new_md5:md5(d.markdown)};
  });
  const json=JSON.stringify(rows);
  let delimiter='$guide_edition$';while(json.includes(delimiter))delimiter=delimiter.slice(0,-1)+'x$';
  const expected=rows.map(d=>`(${quote(d.id)},${quote(d.new_md5)},${quote(d.title)})`).join(',\n');
  return `-- PRIVATE: run only in project wxwnfsazykszohtjcjhg, Supabase SQL Editor.
-- Updates existing documents without deleting their history or changing member access.
-- Unexpected online edits abort the entire transaction. Running the same edition twice is harmless.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.guide_documents, public.guide_versions in share row exclusive mode;
create temporary table guide_edition_input on commit drop as
select * from jsonb_to_recordset(${delimiter}${json}${delimiter}::jsonb)
 as x(id text,kind text,number text,source_path text,sort_order integer,title text,markdown text,baseline_md5 text,baseline_title text,new_md5 text);
do $apply$
declare item record; doc public.guide_documents; current_text public.guide_versions;
 released_text public.guide_versions; next_version uuid; next_number integer;
begin
 for item in select * from guide_edition_input loop
  select * into doc from public.guide_documents where id=item.id;
  if not found then
   if item.baseline_md5 is not null then raise exception 'Document attendu absent : %. Aucune mise a jour appliquee.', item.id; end if;
  else
   if doc.kind<>item.kind or doc.source_path<>item.source_path then raise exception 'Identite differente : %',item.id; end if;
   select * into current_text from public.guide_versions where id=doc.current_version and document_id=item.id;
   if not found then raise exception 'Version courante absente : %',item.id; end if;
   if not ((md5(current_text.markdown)=item.new_md5 and current_text.title=item.title)
      or (item.baseline_md5 is not null and md5(current_text.markdown)=item.baseline_md5 and current_text.title=item.baseline_title))
      then raise exception 'Modification en ligne inattendue : %. Aucune mise a jour appliquee.',item.id; end if;
   if doc.published_version is not null then
    select * into released_text from public.guide_versions where id=doc.published_version and document_id=item.id;
    if not found then raise exception 'Version diffusee absente : %',item.id; end if;
    if not ((md5(released_text.markdown)=item.new_md5 and released_text.title=item.title)
      or (item.baseline_md5 is not null and md5(released_text.markdown)=item.baseline_md5 and released_text.title=item.baseline_title))
      then raise exception 'Version diffusee inattendue : %. Aucune mise a jour appliquee.',item.id; end if;
   end if;
  end if;
 end loop;
 for item in select * from guide_edition_input order by sort_order,id loop
  select * into doc from public.guide_documents where id=item.id;
  if not found then
   insert into public.guide_documents(id,kind,number,source_path,sort_order)
    values(item.id,item.kind,item.number,item.source_path,item.sort_order);
   select * into doc from public.guide_documents where id=item.id;
  end if;
  select * into current_text from public.guide_versions where id=doc.current_version;
  if current_text.id is not null and current_text.markdown=item.markdown and current_text.title=item.title then
   next_version:=current_text.id;
  else
   if doc.current_version is not null then
    insert into public.guide_audit(action,document_id,version_id) values('${release}_before_draft',item.id,doc.current_version);
   end if;
   select coalesce(max(version_number),0)+1 into next_number from public.guide_versions where document_id=item.id;
   insert into public.guide_versions(document_id,title,markdown,version_number)
    values(item.id,item.title,item.markdown,next_number) returning id into next_version;
  end if;
  if doc.published_version is distinct from next_version then
   insert into public.guide_audit(action,document_id,version_id) values('${release}_before_release',item.id,doc.published_version);
   insert into public.guide_audit(action,document_id,version_id) values('${release}_release',item.id,next_version);
  end if;
  update public.guide_documents set current_version=next_version,published_version=next_version,
    number=item.number,sort_order=item.sort_order,updated_at=case when current_version is distinct from next_version
    or published_version is distinct from next_version then now() else updated_at end where id=item.id;
 end loop;
 if exists(select 1 from guide_edition_input i left join public.guide_documents d on d.id=i.id
   left join public.guide_versions v on v.id=d.current_version
   where v.id is null or v.markdown is distinct from i.markdown or v.title is distinct from i.title
      or d.published_version is distinct from d.current_version) then
   raise exception 'Controle final non conforme. Aucune mise a jour appliquee.';
 end if;
end; $apply$;
commit;
with expected(id,hash,title) as (values
${expected}
)
select count(*) as documents_attendus,
 count(d.id) as documents_presents,
 count(*) filter(where d.kind='chapter') as chapitres,
 count(*) filter(where md5(v.markdown)=e.hash and v.title=e.title) as textes_identiques,
 count(*) filter(where d.published_version=d.current_version) as documents_accessibles
from expected e left join public.guide_documents d on d.id=e.id
left join public.guide_versions v on v.id=d.current_version;
`;
}

