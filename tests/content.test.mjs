import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown,validateMarkdown,safeLink,headingsOf,searchDocuments} from '../src/content.mjs';
import {validateConfig} from '../scripts/config.mjs';
const doc={id:'ethique',source_path:'CHAPTERS/04_ethique_deontologie.md',title:'Éthique',markdown:''};
test('Markdown: HTML, handlers and dangerous URLs cannot execute',()=>{
 const {html}=renderMarkdown({...doc,markdown:'# Essai\n<script>alert(1)</script>\n\n[piège](javascript:alert)\n\n<img src=x onerror=alert(1)>\n\n![image](https://tracker.test/pixel.png)'});
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img '));assert.ok(!html.includes('href="javascript:'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('Illustration'));
});
test('Cross-chapter links, nonpublished references and fragment routing',()=>{
 const catalog=[doc,{id:'donnees',source_path:'CHAPTERS/10_donnees_qualite_protection.md'}];
 assert.equal(safeLink('../CHAPTERS/10_donnees_qualite_protection.md#qualite',doc,catalog),'#/lire/donnees/qualite');
 for(const href of ['file:///secret','//evil.test','data:text/html,evil','../SOURCES/private.md','https://user:pass@host.test/'])assert.equal(safeLink(href,doc,catalog),null);
});
test('Headings ignore code fences, preserve Arabic and make duplicate anchors unique',()=>{
 const headings=headingsOf('# Santé\n## Consentement\n## Consentement\n```md\n# Not a title\n```\n## الموافقة');
 assert.deepEqual(headings.map(h=>h.id),['sante','consentement','consentement-2','الموافقة']);
});
test('Citations link to actual references without nested links',()=>{
 const {html}=renderMarkdown({...doc,markdown:'# Chapitre\nTexte [1]. [Lien [1]](https://example.org)\n\n## Références\n\n[1] Référence réelle.'});
 assert.ok(html.includes('id="ref-1"'));assert.ok(html.includes('href="#/lire/ethique/ref-1"'));assert.ok(!/<a[^>]*>[^<]*<a/.test(html));
});
test('Tables keep semantic headers and original Arabic text',()=>{
 const {html}=renderMarkdown({...doc,markdown:'| Terme | Traduction |\n|---|---|\n| Consentement | الموافقة |'});
 assert.ok(html.includes('<th scope="col">'));assert.ok(html.includes('الموافقة'));assert.ok(html.includes('table-scroll'));
});
test('Search is accent insensitive and supports exact phrases',()=>{
 const docs=[{...doc,markdown:'# Éthique\n## Contrôle\nLe contrôle humain et l’équité sont étudiés.'}];
 assert.equal(searchDocuments(docs,'EQUITE').length,1);assert.equal(searchDocuments(docs,'"controle humain"').length,1);assert.equal(searchDocuments(docs,'"humain controle"').length,0);assert.equal(searchDocuments(docs,'').length,0);
});
test('Import rejects binaries, oversized content, empty and invalid UTF-8',()=>{
 for(const [value,name] of [['','a.md'],['\0','a.md'],['x','a.exe'],['x'.repeat(2097153),'a.md'],['\uFFFD','a.md']])assert.throws(()=>validateMarkdown(value,name));
 assert.equal(validateMarkdown('# Texte arabe عربي','a.md'),'# Texte arabe عربي');
});
test('Public config rejects privileged keys and arbitrary servers',()=>{
 const key=role=>'x.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.sig';
 assert.throws(()=>validateConfig({supabaseUrl:'https://abc.supabase.co',supabasePublishableKey:key('service_role')}));
 assert.throws(()=>validateConfig({supabaseUrl:'https://evil.test',supabasePublishableKey:'sb_publishable_test'}));
 assert.throws(()=>validateConfig({},{required:true}));
 const valid=validateConfig({supabaseUrl:'https://abc.supabase.co',supabasePublishableKey:key('anon'),extraSecret:'should disappear'});
 assert.equal(valid.extraSecret,undefined);assert.equal(valid.supabaseUrl,'https://abc.supabase.co');
});
