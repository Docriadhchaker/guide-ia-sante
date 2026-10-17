// Deploy this single file as guide-reviewer-access. Keep JWT verification enabled.
// RESEND_API_KEY is an Edge Function secret, never a browser/GitHub variable.
const guideLogin='https://guide.riadhchaker.com/#/connexion';
const emailSender='Guide IA en santé <acces@notifications.riadhchaker.com>';
const authorReply='bintelcenter@gmail.com';
const allowedOrigins=new Set(['https://guide.riadhchaker.com','https://docriadhchaker.github.io']);

export function activationEmail(recipient){
 return {
  from:emailSender,to:[recipient],reply_to:authorReply,
  subject:'Votre accès au guide de l’IA en santé est activé',
  text:`Bonjour,\n\nVotre demande de relecture a été acceptée. Vous pouvez maintenant vous connecter avec l’adresse e-mail et le mot de passe choisis lors de votre inscription pour consulter les chapitres et déposer vos remarques.\n\nAccéder au guide : ${guideLogin}\n\nMerci pour votre contribution à la relecture.\n\nRiadh Chaker\n${authorReply}`,
  html:`<!doctype html><html lang="fr"><body style="font-family:Arial,sans-serif;color:#202a30;line-height:1.7;background:#f6f2ea;padding:28px"><main style="max-width:560px;margin:auto;background:#fffcf7;padding:28px"><p style="color:#24575b;letter-spacing:1px">LE GUIDE TUNISIEN · IA EN SANTÉ</p><h1 style="font-family:Georgia,serif;font-size:28px;font-weight:400">Votre accès est activé.</h1><p>Bonjour,</p><p>Votre demande de relecture a été acceptée. Connectez-vous avec l’adresse e-mail et le mot de passe choisis lors de votre inscription pour consulter les chapitres et déposer vos remarques.</p><p><a href="${guideLogin}" style="display:inline-block;background:#24575b;color:white;padding:12px 20px;text-decoration:none;border-radius:3px">Accéder au guide →</a></p><p>Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><a href="${guideLogin}">${guideLogin}</a></p><p>Merci pour votre contribution à la relecture.</p><p>Riadh Chaker<br><a href="mailto:${authorReply}">${authorReply}</a></p></main></body></html>`
 };
}

export function createAccessHandler({env,fetcher=fetch}){
 return async function handler(request){
  const origin=request.headers.get('Origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(allowedOrigins.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(origin&&!allowedOrigins.has(origin))return reply({message:'Origine non autorisée.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply({message:'Méthode non autorisée.'},405);
  const authorization=request.headers.get('Authorization')||'';
  if(!/^Bearer \S+$/i.test(authorization))return reply({message:'Connexion requise.'},401);
  const url=env('SUPABASE_URL')?.replace(/\/$/,''),anon=env('SUPABASE_ANON_KEY'),service=env('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!anon||!service)return reply({message:'Configuration du serveur incomplète.'},503);
  let input;
  try{const raw=await request.text();if(raw.length>2000)throw Error();input=JSON.parse(raw);}catch{return reply({message:'Demande invalide.'},400);}
  if(!input||typeof input!=='object'||Array.isArray(input)||
    typeof input.user_id!=='string'||! /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.user_id))return reply({message:'Demande invalide.'},400);
  async function jsonFetch(endpoint,options={}){
   const response=await fetcher(endpoint,{...options,signal:AbortSignal.timeout(8000)});
   let data;try{data=await response.json();}catch{data=null;}
   if(!response.ok)throw Object.assign(Error('Requête refusée'),{status:response.status,code:data?.code});
   return data;
  }
  const userHeaders={apikey:anon,Authorization:authorization,'Content-Type':'application/json'};
  const serviceHeaders={apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'};
  const rpc=(name,body,privileged=false)=>jsonFetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:privileged?serviceHeaders:userHeaders,body:JSON.stringify(body)});
  const userId=input.user_id;
  // Verify the token with Auth, then verify the administrator role before any write.
  try{
   const user=await jsonFetch(url+'/auth/v1/user',{headers:userHeaders});
   if(!user?.id)return reply({message:'Session invalide.'},401);
   const memberships=await jsonFetch(url+'/rest/v1/guide_members?select=role&user_id=eq.'+encodeURIComponent(user.id),{headers:userHeaders});
   if(!memberships?.some(m=>m.role==='admin'))return reply({message:'Administration requise.'},403);
  }catch(error){return reply({message:error.status===401?'Reconnectez-vous pour continuer.':'L’envoi n’a pas pu être lancé. Actualisez le suivi avant de réessayer.'},error.status===401?401:400);}
  const result=notification=>reply({user_id:userId,notification});
  const resend=env('RESEND_API_KEY');
  if(!resend)return result('not_configured');
  let job;
  try{job=await rpc('guide_claim_access_email',{p_user:userId},true);}catch{return result('not_configured');}
  if(job?.status!=='send')return result(['sent','sending','attention','cancelled','not_requested'].includes(job?.status)?job.status:'unknown');
  let providerId=null,errorText=null;
  try{
   const data=await jsonFetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+resend,'Content-Type':'application/json','Idempotency-Key':'guide-access/'+job.id},body:JSON.stringify(activationEmail(job.recipient))});
   if(typeof data?.id!=='string'||!data.id)throw Error('Réponse sans identifiant');
   providerId=data.id;
  }catch(error){errorText=error.status?`Le service d’envoi a refusé la demande (HTTP ${error.status}).`:'L’envoi n’a pas pu être confirmé. Réessayez après une minute.';}
  let recorded=false;
  try{recorded=await rpc('guide_finish_access_email',{p_id:job.id,p_claim:job.claim_token,p_provider_id:providerId,p_error:errorText},true);}catch{}
  return result(recorded?(providerId?'sent':'failed'):'unknown');
 };
}

if(typeof Deno!=='undefined')Deno.serve(createAccessHandler({env:name=>Deno.env.get(name)}));
