// Read-only smoke checks. Passwords are supplied interactively, hidden on stdin.
// This does not replace supabase/tests/access.sql, which tests authorization in Postgres.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SupabaseRepository} from '../src/api.mjs';
import {validateConfig} from './config.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=validateConfig(JSON.parse(fs.readFileSync(path.join(root,'config.local.json'),'utf8')),{required:true});
if(!process.stdin.isTTY)throw Error('Exécuter depuis un terminal interactif pour saisir le mot de passe sans l’afficher.');
async function prompt(label,hidden=false){process.stdout.write(label);process.stdin.setRawMode(true);process.stdin.resume();return new Promise((resolve,reject)=>{let text='';const onData=buffer=>{for(const ch of buffer.toString()){if(ch==='\u0003'){cleanup();reject(Error('Annulé'));return;}if(ch==='\r'||ch==='\n'){cleanup();process.stdout.write('\n');resolve(text);return;}if(ch==='\u007f'||ch==='\b'){text=text.slice(0,-1);}else if(ch>=' '){text+=ch;if(!hidden)process.stdout.write(ch);}}};const cleanup=()=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();};process.stdin.on('data',onData);});}
const anon=await fetch(config.supabaseUrl+'/rest/v1/guide_versions?select=id&limit=1',{headers:{apikey:config.supabasePublishableKey},signal:AbortSignal.timeout(20000)});
if(anon.ok)throw Error('La lecture anonyme ne devrait pas être autorisée.');
if(![401,403].includes(anon.status))throw Error('Le contrôle anonyme a reçu une réponse inattendue : HTTP '+anon.status);
console.log('Lecture anonyme refusée : OK.');
const email=await prompt('Email administrateur : '),password=await prompt('Mot de passe (masqué) : ',true);
const repo=new SupabaseRepository(config);
try{const role=await repo.login(email,password);if(role!=='admin')throw Error('Ce compte n’est pas administrateur.');const docs=await repo.load();const count=docs.filter(d=>d.kind==='chapter').length;if(count!==12)throw Error('12 chapitres attendus, '+count+' retrouvés.');console.log('Connexion administrateur, accès aux 12 chapitres : OK.');}finally{await repo.logout();}
