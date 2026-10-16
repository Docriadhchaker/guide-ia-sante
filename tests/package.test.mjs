import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {renderMarkdown,partsOf} from '../src/content.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bundlePath=path.join(root,'private','guide-import.json');
test('Private import contains 12 complete chapters and matches source hashes',{skip:!fs.existsSync(bundlePath)},()=>{
 const bundle=JSON.parse(fs.readFileSync(bundlePath));assert.equal(bundle.documents.filter(d=>d.kind==='chapter').length,12);assert.equal(bundle.documents.length,16);
 for(const d of bundle.documents){assert.equal(crypto.createHash('sha256').update(d.markdown).digest('hex'),d.source_sha256);const bytes=fs.readFileSync(path.join(root,'..',d.source_path));assert.equal(d.markdown,bytes.toString('utf8'));const r=renderMarkdown(d,bundle.documents);assert.ok(r.html.length>500);assert.ok(r.headings.length>0);}
});
test('Standalone preview is valid JavaScript and has a matching CSP hash',{skip:!fs.existsSync(path.join(root,'preview','apercu-autonome.html'))},()=>{
 const html=fs.readFileSync(path.join(root,'preview','apercu-autonome.html'),'utf8');const js=html.match(/<script>([\s\S]+)<\/script>/)[1];new vm.Script(js);
 const hash=crypto.createHash('sha256').update(js).digest('base64');assert.ok(html.includes('sha256-'+hash));
});
test('All chapter and citation links resolve inside the complete private book',{skip:!fs.existsSync(bundlePath)},()=>{
 const b=JSON.parse(fs.readFileSync(bundlePath));const pages=b.documents.map(d=>({...d,...renderMarkdown(d,b.documents)}));let count=0;
 for(const page of pages)for(const m of page.html.matchAll(/href="#\/lire\/([^/\"]+)(?:\/([^\"]+))?"/g)){
  count++;const target=pages.find(p=>p.id===decodeURIComponent(m[1]));assert.ok(target,'Document absent: '+m[1]);if(m[2])assert.ok(target.html.includes('id="'+decodeURIComponent(m[2])+'"'),'Ancre absente: '+m[0]);
 }
 assert.ok(count>=pages.reduce((n,p)=>n+p.headings.length,0),'Every rendered heading has a working permalink');
 for(const page of pages)assert.deepEqual(page.warnings,[],page.id+': incomplete navigation');
});

test('Protected reader plan covers each chapter once in four parts',{skip:!fs.existsSync(bundlePath)},()=>{
 const bundle=JSON.parse(fs.readFileSync(bundlePath)),parts=partsOf(bundle.documents);
 assert.deepEqual(parts.map(p=>p.chapters.length),[3,3,4,2]);
 assert.deepEqual(parts.flatMap(p=>p.chapters.map(d=>d.id)),bundle.documents.filter(d=>d.kind==='chapter').map(d=>d.id));
 assert.deepEqual(partsOf(bundle.documents.filter(d=>d.id!=='parcours')),[]);
});
test('Public export excludes manuscript, local settings and database content',{skip:!fs.existsSync(path.join(root,'dist'))},()=>{
 const files=fs.readdirSync(path.join(root,'dist'),{recursive:true}).filter(f=>fs.statSync(path.join(root,'dist',f)).isFile());
 assert.ok(files.every(f=>!/(book-preview|guide-import|seed-book|private|config.local|apercu-autonome|\.sql$)/.test(f)));
 for(const f of files){const value=fs.readFileSync(path.join(root,'dist',f),'utf8');assert.ok(!value.includes('service_role\":\"'));assert.ok(!value.includes('"source_sha256"'));}
});
