const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const moduleDir=process.env.PLAYWRIGHT_MODULE_DIR||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {chromium}=require(moduleDir);
const report={checks:[],errors:[]};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.EDGE_PATH||'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',headless:true});
 try{
 const context=await browser.newContext();
 await context.route('http://127.0.0.1:4318/**',r=>{const p=decodeURIComponent(new URL(r.request().url()).pathname);const file=path.resolve(root,'preview','.'+(p==='/'?'/index.html':p));if(!file.startsWith(path.join(root,'preview')+path.sep)||!fs.existsSync(file))return r.fulfill({status:404,body:'Absent'});return r.fulfill({path:file});});
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 for(const width of [390,768,1440]){
  await page.setViewportSize({width,height:1000});await page.goto('http://127.0.0.1:4318/');await page.locator('.chapter-card').first().waitFor();
  if(await page.locator('.chapter-card').count()!==12)throw Error('12 chapitres attendus');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Débordement accueil '+width);
  await page.screenshot({path:path.join(root,'reports','accueil-'+width+'.png'),fullPage:true});
  await page.goto('http://127.0.0.1:4318/#/lire/langage-commun');await page.locator('article.prose').waitFor();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Débordement chapitre '+width);
  report.checks.push('Accueil et chapitre à '+width+' px');
 }
 await page.goto('http://127.0.0.1:4318/#/recherche');await page.locator('#search-input').fill('équité');await page.locator('.search-result').first().waitFor();report.checks.push('Recherche accentuée');
 await page.goto('http://127.0.0.1:4318/#/admin/langage-commun');await page.locator('#edit-markdown').waitFor();const original=await page.locator('#edit-markdown').inputValue();await page.locator('#edit-markdown').fill(original+'\n\nTEST IMPORT TEMPORAIRE.');await page.locator('[data-action="save-edit"]').click();await page.getByText('Nouvelle version enregistrée en brouillon.',{exact:true}).waitFor();
 await page.locator('[data-action="publish"]').click();await page.getByText('Cette version est maintenant accessible aux reviewers.',{exact:true}).waitFor();report.checks.push('Brouillon, sauvegarde puis diffusion en aperçu');
 await page.goto('http://127.0.0.1:4318/#/admin');await page.locator('#markdown-files').setInputFiles({name:'14_nouveau.md',mimeType:'text/markdown',buffer:Buffer.from('# Nouveau chapitre\nTexte à vérifier.')});await page.locator('[data-action="save-import"]').click();await page.locator('.admin-documents a').filter({hasText:'Nouveau chapitre'}).waitFor();report.checks.push('Import Markdown d’un chapitre supplémentaire');
 await page.goto('file:///'+path.join(root,'preview','apercu-autonome.html').replaceAll('\\','/'));await page.locator('.chapter-card').first().waitFor();report.checks.push('Aperçu autonome sans serveur');
 }finally{await browser.close();}
 fs.writeFileSync(path.join(root,'reports','browser-tests.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(report.errors.length)process.exitCode=1;
})().catch(e=>{report.errors.push(e.message);fs.mkdirSync(path.join(root,'reports'),{recursive:true});fs.writeFileSync(path.join(root,'reports','browser-tests.json'),JSON.stringify(report,null,2));console.error(e.message);process.exitCode=1;});
