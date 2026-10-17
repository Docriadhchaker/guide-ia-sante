import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccessHandler,activationEmail} from '../supabase/functions/guide-reviewer-access/index.ts';
import {SupabaseRepository} from '../src/api.mjs';
import {loadAccessEmails,accessEmailSummary} from '../src/access-mail.mjs';

const uid='00000000-0000-4000-8000-000000000302';
const job={status:'send',id:'job-unique',claim_token:'lease-unique',recipient:'confirmed@example.invalid'};
const environment={SUPABASE_URL:'https://example.supabase.co',SUPABASE_ANON_KEY:'public-key',SUPABASE_SERVICE_ROLE_KEY:'private-service',RESEND_API_KEY:'private-resend'};
function fixture(overrides={}){
 const calls=[];
 const handler=createAccessHandler({env:key=>(overrides.env||environment)[key],fetcher:async(url,options)=>{
  const body=options.body?JSON.parse(options.body):null;calls.push({url,options,body});
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'admin-verified'},{status:overrides.authStatus||200});
  if(url.includes('/guide_members?'))return Response.json([{role:overrides.role||'admin'}]);
  if(url.endsWith('/guide_claim_access_email'))return Response.json(overrides.job||job,{status:overrides.claimStatus||200});
  if(url==='https://api.resend.com/emails'){
   if(overrides.network)throw Error('secret provider diagnostic');
   return Response.json({id:'provider-id'},{status:overrides.resendStatus||200});
  }
  if(url.endsWith('/guide_finish_access_email'))return Response.json(overrides.recorded!==false,{status:overrides.finishStatus||200});
  throw Error('Unexpected endpoint '+url);
 }});
 const run=(body={user_id:uid},headers={Authorization:'Bearer signed-admin',Origin:'https://guide.riadhchaker.com'})=>handler(new Request('https://edge.example/send',{method:'POST',headers,body:JSON.stringify(body)}));
 return {run,calls};
}

test('Activation email requires a verified administrator; no privileged call before authorization',async()=>{
 for(const options of [{role:'reviewer'},{authStatus:401}]){
  const f=fixture(options),res=await f.run();assert.equal(res.status,options.authStatus||403);
  assert.equal(f.calls.some(c=>c.options.headers.apikey==='private-service'),false);
 }
 const missing=fixture();assert.equal((await missing.run({user_id:uid},{})).status,401);assert.equal(missing.calls.length,0);
 const cors=fixture();assert.equal((await cors.run({user_id:uid},{Origin:'https://untrusted.example',Authorization:'Bearer signed-admin'})).status,403);assert.equal(cors.calls.length,0);
 const invalid=fixture();assert.equal((await invalid.run({user_id:'invalid'})).status,400);assert.equal(invalid.calls.length,0);
});

test('Mail uses the queued confirmed recipient, stable idempotency key and server-only credentials',async()=>{
 const f=fixture(),res=await f.run({user_id:uid,recipient:'attacker@example.invalid'}),data=await res.json();
 assert.equal(data.notification,'sent');
 assert.equal(res.headers.get('Access-Control-Allow-Origin'),'https://guide.riadhchaker.com');
 const sent=f.calls.find(c=>c.url==='https://api.resend.com/emails');
 assert.deepEqual(sent.body.to,['confirmed@example.invalid']);
 assert.equal(sent.options.headers['Idempotency-Key'],'guide-access/job-unique');
 assert.equal(sent.options.headers.Authorization,'Bearer private-resend');
 assert.equal(sent.body.reply_to,'bintelcenter@gmail.com');
 assert.match(sent.body.from,/@notifications\.riadhchaker\.com>/);
 assert.match(sent.body.html,/https:\/\/guide\.riadhchaker\.com\/#\/connexion/);
 assert.match(sent.body.text,/mot de passe choisis/);
 assert.equal(f.calls[0].options.headers.Authorization,'Bearer signed-admin');
 assert.equal(f.calls[1].options.headers.Authorization,'Bearer signed-admin');
 assert.equal(f.calls[2].options.headers.Authorization,'Bearer private-service');
 assert.match(f.calls[1].url,/user_id=eq.admin-verified$/);
 const finish=f.calls.at(-1);assert.equal(finish.body.p_claim,'lease-unique');assert.equal(finish.body.p_provider_id,'provider-id');
 assert.doesNotMatch(JSON.stringify(data),/private-service|private-resend|confirmed@example/);
});

test('Already sent, concurrent, cancelled and expired jobs never trigger another provider call',async()=>{
 for(const status of ['sent','sending','attention','cancelled','not_requested']){
  const f=fixture({job:{status}}),data=await(await f.run()).json();
  assert.equal(data.notification,status);assert.equal(f.calls.length,3);
 }
});

test('Provider failures are persisted; uncertain database outcome never reports email success',async()=>{
 for(const options of [{resendStatus:503},{network:true}]){
  const f=fixture(options),data=await(await f.run()).json();assert.equal(data.notification,'failed');
  assert.equal(f.calls.at(-1).body.p_provider_id,null);assert.ok(f.calls.at(-1).body.p_error);
  assert.doesNotMatch(f.calls.at(-1).body.p_error,/secret provider/);
 }
 for(const options of [{finishStatus:503},{recorded:false}]){
  const f=fixture(options);assert.equal((await(await f.run()).json()).notification,'unknown');
 }
});

test('Missing server secret or migration reports activation pending without attempting email',async()=>{
 const noSecret=fixture({env:{...environment,RESEND_API_KEY:undefined}});
 assert.equal((await(await noSecret.run()).json()).notification,'not_configured');assert.equal(noSecret.calls.length,2);
 const noMigration=fixture({claimStatus:404});assert.equal((await(await noMigration.run()).json()).notification,'not_configured');assert.equal(noMigration.calls.length,3);
});

test('Access is granted once and remains successful even when the mail function is missing or offline',async()=>{
 for(const failure of [Object.assign(Error('missing'),{status:404,code:'NOT_FOUND'}),Error('network'),Object.assign(Error('mail error'),{status:500})]){
  const repo=new SupabaseRepository({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public'}),calls=[];
  repo.request=async(path,options)=>{calls.push({path,options});if(path.includes('/rpc/guide_grant_reviewer'))return uid;throw failure;};
  const result=await repo.grant('confirmed@example.invalid');assert.equal(result.access_granted,true);assert.equal(result.user_id,uid);
  assert.equal(result.notification,failure.status===404?'not_configured':'unknown');assert.equal(calls.length,2);
  assert.deepEqual(calls[1].options.body,{user_id:uid});
 }
 const denied=new SupabaseRepository({supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'public'});let count=0;
 denied.request=async()=>{count++;throw Error('grant denied');};
 await assert.rejects(()=>denied.grant('unconfirmed@example.invalid'),/grant denied/);assert.equal(count,1);
});

test('Admin mail history escapes recipients/errors and hides late results after logout',async()=>{
 const root={innerHTML:'',isConnected:true};
 const repo={role:'admin',accessEmails:async()=>[{email:'<script>@example.invalid',last_error:'<img onerror=x>',user_id:uid,status:'failed'}]};
 await loadAccessEmails(root,repo);assert.match(root.innerHTML,/Réessayer l’envoi/);assert.doesNotMatch(root.innerHTML,/<script>|<img/);assert.match(root.innerHTML,/&lt;script&gt;/);
 let finish;repo.accessEmails=()=>new Promise(resolve=>finish=resolve);const loading=loadAccessEmails(root,repo);repo.role=null;finish([{email:'private@example.invalid',status:'sent'}]);await loading;
 assert.doesNotMatch(root.innerHTML,/private@example/);
 repo.role='admin';const older=loadAccessEmails(root,repo);repo.accessEmails=async()=>[];await loadAccessEmails(root,repo);finish([{email:'stale@example.invalid',status:'sent'}]);await older;
 assert.doesNotMatch(root.innerHTML,/stale@example/);assert.match(root.innerHTML,/Aucun e-mail/);
 assert.match(accessEmailSummary({access_granted:true,notification:'failed'}),/^Accès accordé\./);
 assert.match(accessEmailSummary({notification:'sent'}),/transmis au service/);
 assert.doesNotMatch(accessEmailSummary({notification:'unknown'}),/Accès accordé|transmis au service/);
});

test('Email HTML cannot interpolate a recipient into its markup',()=>{
 const mail=activationEmail('<img src=x onerror=alert(1)>@example.invalid');assert.doesNotMatch(mail.html,/onerror|alert\(1\)/);
});
