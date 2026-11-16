import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'private','github-upload');
if(path.dirname(out)!==path.join(root,'private')||path.basename(out)!=='github-upload')throw Error('Destination interdite');
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
const allowed = [
 ".github/workflows/pages.yml",
 ".gitignore",
 "config.example.json",
 "icon.svg",
 "index.html",
 "package.json",
 "scripts/browser-test.cjs",
 "scripts/build.mjs",
 "scripts/config.mjs",
 "scripts/edition-update.mjs",
 "scripts/package-source.mjs",
 "scripts/prepare-book.mjs",
 "scripts/prepare-update.mjs",
 "scripts/serve.mjs",
 "scripts/test-live.mjs",
 "src/access-mail.mjs",
 "src/access.mjs",
 "src/api.mjs",
 "src/app.mjs",
 "src/comments.mjs",
 "src/content.mjs",
 "src/inbox.mjs",
 "src/pending.mjs",
 "src/style.css",
 "src/theme.mjs",
 "supabase/bootstrap-admin.sql",
 "supabase/config.toml",
 "supabase/functions/guide-reviewer-access/index.ts",
 "supabase/migrations/202610160001_guide.sql",
 "supabase/migrations/202610160002_pending_reviewers.sql",
 "supabase/migrations/202610170001_comments.sql",
 "supabase/migrations/202610180001_access_email.sql",
 "supabase/migrations/202611160001_review_security.sql",
 "supabase/tests/access-email.sql",
 "supabase/tests/access.sql",
 "supabase/tests/ci-auth-fixture.sql",
 "supabase/tests/comments.sql",
 "supabase/tests/edition-update.mjs",
 "supabase/tests/pending-reviewers.sql",
 "supabase/tests/review-security.sql",
 "tests/access-email.test.mjs",
 "tests/comments.test.mjs",
 "tests/content.test.mjs",
 "tests/inbox.test.mjs",
 "tests/package.test.mjs",
 "tests/pending-reviewers.test.mjs",
 "tests/repository.test.mjs",
 "vendor/marked-LICENSE.md",
 "vendor/marked.mjs",
];
for (const file of allowed) {
 const destination=path.join(out,file);
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 fs.copyFileSync(path.join(root,file),destination);
}
const files=fs.readdirSync(out,{recursive:true}).filter(f=>fs.statSync(path.join(out,f)).isFile());
if(files.some(f=>/(^|[\\/])(private|preview|dist|reports|\.git)([\\/]|$)|\.env|config\.local|seed-book|guide-import\.json|apercu-autonome/.test(f)))throw Error('Fichier privé détecté dans le paquet');
if(files.some(f=>/(^|[\\/])README(?:\.[^\\/]*)?$/i.test(f)))throw Error('Documentation interne exclue du paquet public');
const manifest=files.map(file=>({file:file.replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(out,file))).digest('hex')}));
fs.writeFileSync(path.join(root,'reports','github-package.json'),JSON.stringify({files:manifest,containsManuscript:false,remoteUpload:false},null,2));
console.log(files.length+' fichiers préparés pour GitHub, aucun manuscrit ni configuration secrète.');
