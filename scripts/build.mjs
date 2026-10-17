import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateConfig} from './config.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const preview=process.argv.includes('--preview'), out=path.join(root,preview?'preview':'dist');
let config={title:'Le Guide de l’IA en santé pour les législateurs',supabaseUrl:'',supabasePublishableKey:''};
const local=path.join(root,'config.local.json');if(fs.existsSync(local))config={...config,...JSON.parse(fs.readFileSync(local,'utf8'))};
if(process.env.SUPABASE_URL)config.supabaseUrl=process.env.SUPABASE_URL;
if(process.env.SUPABASE_PUBLISHABLE_KEY)config.supabasePublishableKey=process.env.SUPABASE_PUBLISHABLE_KEY;
config=validateConfig(config,{required:!preview&&process.argv.includes('--require-config')});
if(preview)config={title:config.title,preview:true};
// Only these two generated child directories can ever be replaced.
if(path.dirname(out)!==root||!['preview','dist'].includes(path.basename(out)))throw Error('Destination interdite');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
for(const dir of ['src','vendor'])fs.cpSync(path.join(root,dir),path.join(out,dir),{recursive:true});
for(const file of ['index.html','icon.svg'])fs.copyFileSync(path.join(root,file),path.join(out,file));
fs.writeFileSync(path.join(out,'config.json'),JSON.stringify(config,null,2));
fs.writeFileSync(path.join(out,'.nojekyll'),'');
fs.writeFileSync(path.join(out,'robots.txt'),'User-agent: *\nDisallow: /\n');
if(preview){
 const bundle=JSON.parse(fs.readFileSync(path.join(root,'private','guide-import.json'),'utf8'));
 fs.writeFileSync(path.join(out,'book-preview.json'),JSON.stringify(bundle));
 // Standalone local preview works from a double-click, without localhost/npm.
 const source=fs.readFileSync(path.join(root,'vendor','marked.mjs'),'utf8').replace(/^\/\/# sourceMappingURL=.*$/gm,'').trim();
 const match=source.match(/export\s*\{([^}]+)\}\s*;?\s*$/);
 if(!match)throw Error('Format du parseur inattendu');
 const markedName=match[1].split(',').map(x=>x.trim()).find(x=>/ as marked$/.test(x))?.split(' as ')[0];
 if(!markedName)throw Error('Export marked absent');
 const vendor=`const marked=(()=>{${source.slice(0,match.index)};return ${markedName};})();\n`;
 const strip=text=>text.replace(/^import[^\n]+;\r?\n/gm,'').replace(/^export\s+/gm,'');
 const content=strip(fs.readFileSync(path.join(root,'src/content.mjs'),'utf8'))+'\nconst esc=escapeHTML;\n';
 const api=strip(fs.readFileSync(path.join(root,'src/api.mjs'),'utf8'));
 const pending=strip(fs.readFileSync(path.join(root,'src/pending.mjs'),'utf8'));
 const comments=strip(fs.readFileSync(path.join(root,'src/comments.mjs'),'utf8'));
 const inbox=strip(fs.readFileSync(path.join(root,'src/inbox.mjs'),'utf8'));
 const theme=strip(fs.readFileSync(path.join(root,'src/theme.mjs'),'utf8'));
 const access=strip(fs.readFileSync(path.join(root,'src/access.mjs'),'utf8'));
 const accessMail=strip(fs.readFileSync(path.join(root,'src/access-mail.mjs'),'utf8'));
 const app=strip(fs.readFileSync(path.join(root,'src/app.mjs'),'utf8'));
 const jsonSafe=x=>JSON.stringify(x).replace(/</g,'\\u003c');
 const js=`(()=>{window.__GUIDE_CONFIG__=${jsonSafe(config)};window.__GUIDE_BOOK__=${jsonSafe(bundle)};${vendor}${content}\n${api}\n${pending}\n${comments}\n${inbox}\n${theme}\n${access}\n${accessMail}\n${app}\n})();`.replace(/<\/script/gi,'<\\/script').replace(/\r\n/g,'\n');
 const hash=crypto.createHash('sha256').update(js).digest('base64');
 let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/,`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">`).replace(/<link rel="icon"[^>]+>/,'').replace(/<link rel="stylesheet" href="\.\/src\/style\.css(?:\?[^"]*)?">/,'<style>'+fs.readFileSync(path.join(root,'src/style.css'),'utf8')+'</style>').replace(/<script type="module" src="\.\/src\/app\.mjs(?:\?[^"]*)?"><\/script>/,'');
 html=html.replace('</body>',()=>`<script>${js}</script></body>`);
 fs.writeFileSync(path.join(out,'apercu-autonome.html'),html);
}
console.log(preview?'Aperçu privé construit avec les 12 chapitres.':'Site public construit : interface seule, aucun texte du manuscrit.');
