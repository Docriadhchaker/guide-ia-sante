import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPendingReviewers} from '../src/pending.mjs';
import {SupabaseRepository} from '../src/api.mjs';

test('Pending accounts display safely and an empty list is distinguished from a server error',async()=>{
 const root={isConnected:true,innerHTML:''};
 const email='a"<b>@example.org';
 const repo={role:'admin',pending:async()=>[{email,confirmed_at:'2026-10-16T12:00:00Z'}]};
 await loadPendingReviewers(root,repo);
 assert.ok(root.innerHTML.includes('Accorder l’accès'));
 assert.ok(root.innerHTML.includes('a&quot;&lt;b&gt;@example.org'));
 assert.ok(!root.innerHTML.includes(email));
 repo.pending=async()=>[];await loadPendingReviewers(root,repo);
 assert.match(root.innerHTML,/Aucun nouveau compte/);
 repo.pending=async()=>{throw Error('offline');};await loadPendingReviewers(root,repo);
 assert.match(root.innerHTML,/Impossible de charger/);
 assert.doesNotMatch(root.innerHTML,/Aucun nouveau compte/);
 repo.pending=async()=>{throw Object.assign(Error('missing function'),{code:'PGRST202'});};
 await loadPendingReviewers(root,repo);assert.match(root.innerHTML,/pas encore activée/);
});

test('Late requests cannot expose emails after navigation, logout or a newer refresh',async()=>{
 const root={isConnected:true,innerHTML:''};let finish;
 const repo={role:'admin',pending:()=>new Promise(resolve=>finish=resolve)};
 const old=loadPendingReviewers(root,repo);
 repo.pending=async()=>[];await loadPendingReviewers(root,repo);
 finish([{email:'old@example.org',confirmed_at:'2026-10-16'}]);await old;
 assert.match(root.innerHTML,/Aucun nouveau compte/);
 repo.pending=()=>new Promise(resolve=>finish=resolve);
 const navigating=loadPendingReviewers(root,repo);root.isConnected=false;
 finish([{email:'private@example.org',confirmed_at:'2026-10-16'}]);await navigating;
 assert.doesNotMatch(root.innerHTML,/private@example.org/);
 root.isConnected=true;
 const logout=loadPendingReviewers(root,repo);repo.role=null;
 finish([{email:'private@example.org',confirmed_at:'2026-10-16'}]);await logout;
 assert.doesNotMatch(root.innerHTML,/private@example.org/);
 let called=false;repo.role='reviewer';repo.pending=async()=>{called=true;return [];};
 await loadPendingReviewers(root,repo);assert.equal(called,false);
});

test('Pending accounts use authenticated RPC; database errors remain detectable',async()=>{
 const saved=global.fetch;const calls=[];
 global.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({code:'PGRST202',message:'Function missing'}),{status:404});};
 try{
  const repo=new SupabaseRepository({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public-example'});
  repo.setSession({access_token:'test-access',expires_in:3600});
  await assert.rejects(()=>repo.pending(),{code:'PGRST202'});
  assert.match(calls[0].url,/\/rpc\/guide_list_pending_reviewers$/);
  assert.equal(calls[0].options.headers.Authorization,'Bearer test-access');
  assert.equal(calls[0].options.method,'POST');
 }finally{global.fetch=saved;}
});
