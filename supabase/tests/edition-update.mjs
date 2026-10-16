// Run only against the disposable guide_test PostgreSQL database used by CI.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {editionSQL} from '../../scripts/edition-update.mjs';
if(process.env.PGDATABASE!=='guide_test')throw Error('Disposable guide_test database required');
function query(sql,ok=true){
 const result=spawnSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
 if(result.error)throw result.error;
 if(ok)assert.equal(result.status,0,result.stderr);
 else assert.notEqual(result.status,0,'Unexpected write succeeded');
 return result.stdout.trim();
}
const before={id:'edition-test-a',kind:'chapter',number:'01',source_path:'CHAPTERS/edition-test-a.md',sort_order:0,title:'Titre ancien',markdown:'# Titre ancien\n\nTexte antérieur.'};
const after={...before,title:'Titre révisé',markdown:"# Titre révisé\n\nArabe : الموافقة. Apostrophe ' et $guide_edition$."};
const added={id:'edition-test-b',kind:'notice',number:'',source_path:'FRONT_MATTER/edition-test-b.md',sort_order:1,title:'Parcours',markdown:'# Parcours\n\nQuatre parties.'};
const initial=editionSQL([before],[],'test_initial');
const update=editionSQL([after,added],[before],'test_revision');
query(initial);
assert.equal(query("select count(*) from public.guide_versions where document_id='edition-test-a';"),'1');
query(update);
assert.equal(query("select count(*) from public.guide_versions where document_id in ('edition-test-a','edition-test-b');"),'3');
assert.equal(query("select count(*) from public.guide_documents where id like 'edition-test-%' and current_version=published_version;"),'2');
query(update);
assert.equal(query("select count(*) from public.guide_versions where document_id in ('edition-test-a','edition-test-b');"),'3','Idempotent rerun must not duplicate history');
query("update public.guide_versions set markdown='An unexpected online edit' where id=(select current_version from public.guide_documents where id='edition-test-a');");
const newTitle={...added,title:'Should not be written'};
query(editionSQL([newTitle,after],[added,before],'test_conflict'),false);
assert.equal(query("select title from public.guide_versions where id=(select current_version from public.guide_documents where id='edition-test-b');"),'Parcours','Conflict must roll back the entire edition');
assert.equal(query("select markdown from public.guide_versions where id=(select current_version from public.guide_documents where id='edition-test-a');"),'An unexpected online edit');
console.log('Edition update: history, exact Unicode content, idempotence and atomic conflict rejection passed.');

