import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {editionSQL} from './edition-update.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const backup=fs.readFileSync(path.join(root,'private/release-backup-path.txt'),'utf8').replace(/^\uFEFF/,'').trim();
const previous=JSON.parse(fs.readFileSync(path.join(backup,'guide-import-before.json'),'utf8'));
const next=JSON.parse(fs.readFileSync(path.join(root,'private/guide-import.json'),'utf8'));
const target=path.join(root,'private/METTRE_A_JOUR_EDITION_2026-10-17.sql');
fs.writeFileSync(target,editionSQL(next.documents,previous.documents));
console.log(JSON.stringify({file:target,documents:next.documents.length,chapters:next.documents.filter(d=>d.kind==='chapter').length,bytes:fs.statSync(target).size}));

