import test from 'node:test';
import assert from 'node:assert/strict';
import {PreviewRepository,SupabaseRepository} from '../src/api.mjs';
const sample={id:'test',kind:'chapter',title:'Titre',markdown:'# Initial',source_path:'CHAPTERS/01_test.md',number:'01',sort_order:0};
test('Saving creates history, does not overwrite the released version, rejects stale writes',async()=>{
 const repo=new PreviewRepository({documents:[sample]});const [first]=await repo.load();
 const v2=await repo.save({...sample,markdown:'# Nouvelle version'},first.current_version);
 const [second]=await repo.load();assert.equal(second.current_version,v2);assert.equal(second.published_version,first.current_version);assert.equal((await repo.history('test')).length,2);
 await assert.rejects(()=>repo.save(sample,first.current_version),/VERSION_CONFLICT/);
 await repo.release('test',v2,v2);assert.equal((await repo.load())[0].published_version,v2);
 await repo.release('test',first.current_version,v2);assert.equal((await repo.load())[0].published_version,first.current_version);
 await repo.release('test',null,v2);assert.equal((await repo.load())[0].published_version,null);
});
test('A chapter cannot release a version from another chapter',async()=>{
 const repo=new PreviewRepository({documents:[sample,{...sample,id:'other'}]});const docs=await repo.load();await assert.rejects(()=>repo.release('test',docs[1].current_version,docs[0].current_version),/étrangère/);
});
test('Supabase requests send the access token, never save secrets in browser storage',async()=>{
 const old=global.fetch;const calls=[];
 global.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.includes('token?')?{access_token:'access',refresh_token:'refresh',expires_in:3600,user:{id:'uid'}}:[{role:'admin'}]),{status:200});};
 try{const repo=new SupabaseRepository({supabaseUrl:'https://abc.supabase.co',supabasePublishableKey:'sb_publishable_demo'});await repo.login('author@example.org','password');assert.equal(repo.role,'admin');assert.equal(calls[1].options.headers.Authorization,'Bearer access');assert.equal(calls[0].options.headers.Authorization,undefined);await repo.logout();assert.equal(repo.session,null);}finally{global.fetch=old;}
});
