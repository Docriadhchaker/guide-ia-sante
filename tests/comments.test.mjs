import test from 'node:test';
import assert from 'node:assert/strict';
import {commentVersion,filterComments,reviewCSV,reviewMarkdown,commentCard,ReviewComments} from '../src/comments.mjs';
import {SupabaseRepository,PreviewRepository} from '../src/api.mjs';
const thread={id:'thread',document_id:'doc',document_title:'Chapitre <script>alert(1)</script>',version_id:'v1',version_number:1,published_version:'v2',reviewer_id:'reader',reviewer_email:'reader@example.invalid',section_title:'<img onerror=alert(1)>',quote:'Une citation <b>à lire</b>',status:'accepted',created_at:'2026-10-17T00:00:00Z',updated_at:'2026-10-17T00:00:00Z',messages:[{author_email:'reader@example.invalid',body:'=HYPERLINK("evil");\nTexte arabe : ملاحظة',kind:'message',created_at:'2026-10-17T00:00:00Z'}]};
test('Version binding uses the exact reader version, not latest admin draft',()=>{
 const doc={current_version:'draft',published_version:'released'};
 assert.equal(commentVersion(doc,'reviewer'),'released');assert.equal(commentVersion(doc,'admin'),'draft');
 assert.equal(commentVersion({...doc,version_id:'historical'},'admin'),'historical');
});
test('Cards escape user content; reviewer cannot see status controls',()=>{
 const html=commentCard(thread,false);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));
 assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('class="review-status"'));assert.ok(html.includes('Version différente'));
 assert.ok(commentCard(thread,true).includes('class="review-status"'));
});
test('Exports preserve every reply, version, quote and status and neutralize spreadsheet formulas',()=>{
 const csv=reviewCSV([thread]);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=HYPERLINK(""evil"");\n'));assert.ok(csv.includes('ملاحظة'));assert.ok(csv.includes('"v1"'));assert.ok(csv.includes('"Retenu"'));
 const md=reviewMarkdown([thread]);assert.ok(md.includes('&lt;script&gt;'));assert.ok(!md.includes('<script>'));assert.ok(md.includes('**Version :** v1'));assert.ok(md.includes('ملاحظة'));
 for(const body of ['+1+1','-1+1','@SUM(A1)','\t=CMD()','  =1'])assert.ok(reviewCSV([{...thread,messages:[{...thread.messages[0],body}]}]).includes('"\''+body+'"'));
});
test('Combined filters keep reviewer, chapter and status distinct',()=>{
 const other={...thread,id:'other',reviewer_id:'b',document_id:'two',status:'pending'};
 assert.deepEqual(filterComments([thread,other],{document:'doc',reviewer:'reader',status:'accepted'}),[thread]);
 assert.deepEqual(filterComments([thread,other],{document:'doc',status:'pending'}),[]);
});
test('Repository fetches every page and sends selected version and stable request IDs',async()=>{
 const repo=new SupabaseRepository({supabaseUrl:'https://test.supabase.co',supabasePublishableKey:'public'}),calls=[];
 repo.request=async(path,options)=>{calls.push({path,body:options.body});if(path.endsWith('guide_list_comments'))return options.body.p_offset===0?Array.from({length:100},(_,i)=>({id:i})):[{id:100}];return 'ok';};
 assert.equal((await repo.comments('doc')).length,101);assert.deepEqual(calls.map(c=>c.body.p_offset),[0,100]);
 await repo.createComment({...thread,body:'Bonjour',anchor_start:12,anchor_end:20});
 const body=calls.at(-1).body;assert.equal(body.p_version,'v1');assert.equal(body.p_id,'thread');assert.equal(body.p_start,12);assert.equal(body.p_document,'doc');assert.equal(body.p_body,'Bonjour');assert.ok(!('reviewer_id' in body));
});
test('Local workflow retains original text after publishing a new version and preserves discussion',async()=>{
 const doc={id:'doc',kind:'chapter',title:'Titre initial',markdown:'# Initial\nLe passage.',source_path:'CHAPTERS/test.md',number:'1',sort_order:0};
 const repo=new PreviewRepository({documents:[doc]}),[first]=await repo.load();
 const c={id:crypto.randomUUID(),document_id:'doc',version_id:first.current_version,quote:'passage',section_title:'Initial',body:'Clarifier'};
 await repo.createComment(c);await repo.createComment(c);assert.equal((await repo.comments()).length,1);
 const v2=await repo.save({...doc,markdown:'# Nouveau'},first.current_version);await repo.release('doc',v2,v2);
 assert.equal((await repo.commentSource(c.id)).markdown,doc.markdown);
 const id=crypto.randomUUID();await repo.replyComment(c.id,id,'Merci');await repo.replyComment(c.id,id,'Merci');
 await repo.commentStatus(c.id,'resolved','pending');const [row]=await repo.comments();assert.equal(row.version_id,first.current_version);assert.equal(row.status,'resolved');assert.equal(row.messages.length,3);
});
test('A late comment fetch cannot populate the page after navigation or logout',async()=>{
 let complete;const repo={role:'admin',comments:()=>new Promise(r=>complete=r)},ui=new ReviewComments({repository:()=>repo,dirty:()=>{}});
 const root={isConnected:true,textContent:'',setAttribute(){}};const pending=ui.load(root);ui.clear();root.textContent='Login';complete([thread]);await pending;assert.equal(root.textContent,'Login');assert.deepEqual(ui.threads,[]);
});
