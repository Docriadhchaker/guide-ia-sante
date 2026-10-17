import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewEvents,ReviewReadState,ReviewInbox} from '../src/inbox.mjs';
import {initTheme,preferredTheme} from '../src/theme.mjs';
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),values};};
const message=(id,author_id,kind='message',status)=>({id,author_id,kind,status,created_at:'2026-10-17T00:00:0'+id+'Z'});
const thread={id:'thread',document_title:'Chapitre privé',version_number:2,messages:[message('1','reviewer'),message('2','admin'),message('3','admin','status','resolved')]};
test('Reviewer notifications distinguish incoming replies and status, excluding their own messages',()=>{
 const events=reviewEvents([thread],'reviewer');assert.deepEqual(events.map(e=>e.label),['Remarque traitée','Réponse reçue']);assert.ok(events.every(e=>e.threadId==='thread'&&e.version===2));
 assert.deepEqual(reviewEvents([thread],'admin').map(e=>e.label),['Nouvelle remarque']);assert.deepEqual(reviewEvents([thread],''),[]);
 assert.deepEqual(reviewEvents([{...thread,messages:[{id:'x',created_at:'now'}]}],'reviewer'),[]);
});
test('Read markers persist per account and project, contain no content, and never mark a later reply read',()=>{
 const local=storage(),events=reviewEvents([thread],'reviewer'),read=new ReviewReadState('project:reviewer',local);read.mark(events);
 const renewed=new ReviewReadState('project:reviewer',local);assert.equal(renewed.unread(events).length,0);
 assert.equal(new ReviewReadState('project:other',local).unread(events).length,2);assert.equal(new ReviewReadState('elsewhere:reviewer',local).unread(events).length,2);
 const next=reviewEvents([{...thread,messages:[...thread.messages,message('4','admin')]}],'reviewer');assert.deepEqual(renewed.unread(next).map(e=>e.id),['4']);
 assert.deepEqual(JSON.parse(local.getItem('project:reviewer')),['3','2']);assert.ok(!local.getItem('project:reviewer').includes('Chapitre'));
});
test('Blocked or malformed local storage cannot prevent reading notifications',()=>{
 for(const local of [{getItem:()=>'{broken',setItem:()=>{}},{getItem:()=>{throw Error();},setItem:()=>{throw Error();}}]){
  const read=new ReviewReadState('key',local),events=reviewEvents([thread],'reviewer');read.mark(events);assert.equal(read.unread(events).length,0);
 }
});
test('A pending inbox request is ignored after logout or switching accounts',async()=>{
 let complete,repo={url:'project',role:'reviewer',session:{user:{id:'reviewer'}},comments:()=>new Promise(r=>complete=r)};
 const inbox=new ReviewInbox({repository:()=>repo,storage:storage()});inbox.draw=()=>{};inbox.mount(null);const finish=complete;
 repo={url:'project',role:'admin',session:{user:{id:'admin'}},comments:async()=>[]};inbox.mount(null);finish([thread]);await new Promise(r=>setImmediate(r));
 assert.equal(inbox.userId,'admin');assert.deepEqual(inbox.events,[]);
 inbox.accept([thread]);assert.equal(inbox.unread().length,1);repo.role=null;inbox.mount(null);assert.deepEqual(inbox.events,[]);assert.equal(inbox.key,'');
});
test('An older polling response cannot erase a newly loaded discussion and failed access clears the inbox',async()=>{
 let complete;const repo={role:'reviewer',url:'project',session:{user:{id:'reviewer'}},comments:()=>new Promise(r=>complete=r)};
 const inbox=new ReviewInbox({repository:()=>repo,storage:storage()});inbox.draw=()=>{};inbox.mount(null);inbox.accept([thread]);complete([]);await new Promise(r=>setImmediate(r));assert.equal(inbox.unread().length,2);
 repo.comments=async()=>{throw Error('Access revoked');};await inbox.refresh();assert.deepEqual(inbox.events,[]);assert.ok(inbox.error);
});
test('Theme uses saved preference, falls back to the system, and persists an accessible toggle',()=>{
 const local=storage();assert.equal(preferredTheme(local,true),'dark');local.setItem('guide-theme','light');assert.equal(preferredTheme(local,true),'light');
 const root={dataset:{}},attributes={},button={setAttribute:(k,v)=>attributes[k]=v},media={matches:true,addEventListener:(event,fn)=>media.change=fn};
 initTheme({root,button,storage:local,media});assert.equal(root.dataset.theme,'light');button.onclick();assert.equal(root.dataset.theme,'dark');assert.equal(local.getItem('guide-theme'),'dark');assert.equal(attributes['aria-pressed'],'true');assert.equal(attributes['aria-label'],'Passer en mode jour');
 media.change({matches:false});assert.equal(root.dataset.theme,'dark');assert.equal(preferredTheme({getItem:()=>{throw Error();}},false),'light');
});
