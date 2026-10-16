export function validateConfig(config,{required=false}={}){
 const {title='IA en santé',supabaseUrl='',supabasePublishableKey=''}=config;
 if(required&&(!supabaseUrl||!supabasePublishableKey))throw Error('Configurer les variables SUPABASE_URL et SUPABASE_PUBLISHABLE_KEY.');
 if(supabaseUrl){const u=new URL(supabaseUrl);if(u.protocol!=='https:'||!/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('URL Supabase attendue : https://<projet>.supabase.co');}
 if(supabasePublishableKey){
  if(supabasePublishableKey.startsWith('sb_publishable_')){if(!/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabasePublishableKey))throw Error('Clé publique invalide');}
  else{let payload;try{payload=JSON.parse(Buffer.from(supabasePublishableKey.split('.')[1],'base64url'));}catch{throw Error('Utiliser une clé publishable/anon, jamais une clé secrète.');}if(payload.role!=='anon')throw Error('Clé secrète refusée : seul le rôle anon est autorisé dans le site.');}
 }
 return {title,supabaseUrl:supabaseUrl.replace(/\/$/,''),supabasePublishableKey};
}
