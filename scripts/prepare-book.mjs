import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {titleOf,validateMarkdown,renderMarkdown} from '../src/content.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), book=path.resolve(root,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(book,'PUBLICATION','publication.json'),'utf8'));
const selected=manifest.pages.filter(p=>p.local&&['chapter','notice','index'].includes(p.kind));
if(selected.filter(p=>p.kind==='chapter').length!==12)throw Error('Le dossier attendu comporte exactement 12 chapitres.');
const bundle={format:'guide-import-v1',title:manifest.title,prepared_at:new Date().toISOString(),status:'Version de travail pour relecture',documents:[]};
for(const [i,p] of selected.entries()){
 const source=path.resolve(book,p.source);
 if(!source.startsWith(book+path.sep)||!/^(CHAPTERS|FRONT_MATTER|INDEX)\//.test(p.source))throw Error('Source hors périmètre');
 const bytes=fs.readFileSync(source), markdown=bytes.toString('utf8');validateMarkdown(markdown,p.source);
 bundle.documents.push({id:p.id,kind:p.kind,number:p.number||'',source_path:p.source,sort_order:i,title:titleOf(markdown,p.id),markdown,source_sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
for(const doc of bundle.documents)renderMarkdown(doc,bundle.documents);
const dest=path.join(root,'private');fs.mkdirSync(dest,{recursive:true});
fs.writeFileSync(path.join(dest,'guide-import.json'),JSON.stringify(bundle,null,2));
const json=JSON.stringify(bundle.documents);const delimiter='$guide_'+crypto.randomBytes(8).toString('hex')+'$';
fs.writeFileSync(path.join(dest,'seed-book.sql'),`-- PRIVATE manuscript: run only in the dedicated Supabase SQL editor after the migration.\n-- First import only; existing database content is never overwritten.\nbegin;\ndo $seed$\ndeclare doc jsonb; v uuid;\nbegin\n if exists(select 1 from public.guide_documents) then raise exception 'La base contient déjà des documents. Utilisez l’import administrateur pour les mises à jour.'; end if;\n for doc in select * from jsonb_array_elements(${delimiter}${json}${delimiter}::jsonb) loop\n  insert into public.guide_documents(id,kind,number,source_path,sort_order) values(doc->>'id',doc->>'kind',doc->>'number',doc->>'source_path',(doc->>'sort_order')::integer);\n  insert into public.guide_versions(document_id,title,markdown,version_number) values(doc->>'id',doc->>'title',doc->>'markdown',1) returning id into v;\n  update public.guide_documents set current_version=v,published_version=v where id=doc->>'id';\n  insert into public.guide_audit(action,document_id,version_id) values('initial_private_review_import',doc->>'id',v);\n end loop;\nend; $seed$;\ncommit;\n`);
fs.mkdirSync(path.join(root,'reports'),{recursive:true});
fs.writeFileSync(path.join(root,'reports','source-integrity.json'),JSON.stringify(bundle.documents.map(({id,source_path,source_sha256,markdown})=>({id,source_path,source_sha256,bytes:Buffer.byteLength(markdown)})),null,2));
console.log(`${bundle.documents.length} documents préparés : 12 chapitres, mode d’emploi, index, parcours et abréviations. Sources inchangées.`);
