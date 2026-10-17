import {escapeHTML as esc, plain, slug, route, titleOf, validateMarkdown, renderMarkdown, searchDocuments, partsOf, referencesOf, resolveSection} from './content.mjs';
import {SupabaseRepository, PreviewRepository} from './api.mjs';
import {pendingReviewersPanel, loadPendingReviewers} from './pending.mjs';
import {ReviewComments} from './comments.mjs';

const main=document.querySelector('#main'), sidebar=document.querySelector('#sidebar'), outline=document.querySelector('#outline');
const state={repo:null,documents:[],queue:[],queueIndex:0,edit:null,dirty:false,view:0,busy:false};
let config;
const reviews=new ReviewComments({repository:()=>state.repo,download:(...args)=>download(...args),dirty:value=>state.dirty=value,notify});
const chapterTitle=d=>d.title.replace(/^Chapitre\s+\d+\s*[—–:-]\s*/i,'');
const chapters=()=>state.documents.filter(d=>d.kind==='chapter');
const currentPath=()=>location.hash.slice(1)||'/';
const formatDate=value=>new Date(value).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'});
function notify(message,error=false){const box=document.querySelector('#notification');box.textContent=message;box.className=error?'error':'';box.hidden=false;clearTimeout(notify.timer);notify.timer=setTimeout(()=>box.hidden=true,9000);}
async function action(fn){if(state.busy)return;state.busy=true;document.body.classList.add('busy');try{await fn();}catch(e){notify(e.message||'Une erreur est survenue.',true);}finally{state.busy=false;document.body.classList.remove('busy');}}
const go=path=>{location.hash=path;};
function download(name,text,type='text/plain;charset=utf-8'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function chapterNav(doc){
  return `<a class="chapter-nav" href="${route(doc.id)}"${currentPath().startsWith('/lire/'+doc.id)?' aria-current="page"':''}><span class="number">${esc(doc.number)}</span><span>${esc(chapterTitle(doc))}</span></a>`;
}
function updateChrome(){
  const admin=state.repo?.role==='admin', ready=!!state.repo?.role, parts=partsOf(state.documents);
  document.querySelector('#account').innerHTML=ready?`${admin?'<a class="admin-link" href="#/admin">Administration</a>':'<span class="role-label">Relecture</span>'}${!state.repo.preview?'<button class="text-button" data-action="logout">Déconnexion</button>':''}`:'<a class="admin-link" href="#/connexion">Connexion</a>';
  const nav=parts.length?parts.map(part=>`<section class="nav-part"><h3><a href="${route('parcours',part.section)}">${esc(part.title)}</a></h3>${part.chapters.map(chapterNav).join('')}</section>`).join(''):chapters().map(chapterNav).join('');
  sidebar.innerHTML=`<div class="sidebar-head"><span class="eyebrow">VOTRE PARCOURS</span><a href="#/" class="nav-home">Vue d’ensemble</a></div><div class="nav-caption">LES CHAPITRES <span>${chapters().length||'—'}</span></div><nav aria-label="Chapitres">${nav||'<p class="sidebar-help">Connectez-vous pour retrouver le contenu du guide.</p>'}</nav><div class="sidebar-bottom"><a href="#/mode-emploi">Mode d’emploi</a>${state.documents.some(d=>d.id==='abreviations')?'<a href="#/lire/abreviations">Abréviations</a>':''}<a href="#/references">Références</a>${ready?`<a href="#/commentaires">${admin?'Suivi des remarques':'Mes remarques'}</a>`:''}<p>Comprendre les notions.<br>Éclairer les choix publics.</p></div>`;
}
async function reload(){state.documents=await state.repo.load();updateChrome();}
function documentCards(){return chapters().map(d=>`<a class="chapter-card" href="${route(d.id)}"><span class="eyebrow">CHAPITRE ${esc(d.number)}</span><h3>${esc(chapterTitle(d))}</h3><span class="card-arrow" aria-hidden="true">↗</span></a>`).join('');}
function home(){
  main.innerHTML=`<section class="hero"><div><p class="eyebrow">SANTÉ · CONNAISSANCES · DÉCISION PUBLIQUE</p><h1>Comprendre l’IA.<br><em>Éclairer les choix.</em></h1><p class="lead">Un référentiel pour comprendre l’intelligence artificielle en santé, relier les connaissances et construire son jugement.</p><div class="hero-actions"><a class="button" href="#/sommaire">Ouvrir le sommaire <span aria-hidden="true">→</span></a><a class="button secondary" href="#/questions">Partir d’une question</a></div><div class="hero-meta"><span><strong>${chapters().length}</strong> chapitres</span><span>Contexte tunisien</span><span>Version de travail</span></div></div><div class="book-cover" aria-label="Couverture du guide"><div class="cover-rule"></div><small>LE GUIDE</small><h2>L’IA<br>en santé</h2><p>Comprendre les enjeux.<br>Éclairer les choix publics.</p><div class="cover-bottom">POUR LES LÉGISLATEURS<br><span>TUNISIE</span></div></div></section><section class="entry-points"><a href="#/sommaire"><span>01 / LECTURE</span><h2>Suivre les chapitres</h2><p>Avancer dans le livre à votre rythme.</p></a><a href="#/questions"><span>02 / QUESTIONS</span><h2>Explorer un enjeu</h2><p>Choisir un parcours selon votre question.</p></a><a href="#/notions"><span>03 / NOTIONS</span><h2>Retrouver un concept</h2><p>Accéder à l’index et aux passages associés.</p></a></section><section class="chapter-section"><div class="section-heading"><div><p class="eyebrow">UNE VUE D’ENSEMBLE</p><h2>Le livre, chapitre par chapitre</h2></div><a href="#/sommaire">Tout le sommaire →</a></div><div class="chapter-grid">${documentCards()}</div></section>`;
}
function contents(){
  const plan=state.documents.find(d=>d.id==='parcours'), parts=partsOf(state.documents);
  if(plan&&parts.length){
    const rendered=renderMarkdown({...plan,markdown:plan.markdown.replace(/^# .+\r?\n/,'')},state.documents);
    main.innerHTML=`<p class="eyebrow">LECTURE SUIVIE</p><h1>Le sommaire</h1><div class="prose">${rendered.html}</div>`;
  }else main.innerHTML=`<p class="eyebrow">LECTURE SUIVIE</p><h1>Le sommaire</h1><p class="lead">${chapters().length} chapitres pour construire votre parcours de lecture.</p><div class="chapter-grid">${documentCards()}</div>`;
}
function questions(){const entries=[['Pourquoi ?','Éthique et finalités',['ethique','evaluation-financement']],['Quoi ?','Notions, usages et preuves',['langage-commun','usages-validation']],['Qui ?','Droits, rôles et responsabilités',['droits-patients','gouvernance']],['Où ?','Contextes et intégration dans les soins',['usages-validation','cadre-tunisien']],['Quand ?','Cycle de vie et surveillance',['surveillance-incidents','cadres-internationaux']],['Comment ?','Gouvernance, données et supervision',['gouvernance','donnees','supervision-humaine']],['Combien ?','Ressources, coûts et évaluation',['evaluation-financement']]];main.innerHTML=`<p class="eyebrow">QQOQCCP</p><h1>Partir d’une question</h1><p class="lead">Plusieurs chemins de lecture, un même texte de référence.</p><div class="question-grid">${entries.map(([q,label,ids])=>`<section class="question-card"><h2>${q}</h2><p>${label}</p>${ids.map(id=>state.documents.find(d=>d.id===id)).filter(Boolean).map(d=>`<a href="${route(d.id)}">${esc(chapterTitle(d))} →</a>`).join('')}</section>`).join('')}</div><a href="#/mode-emploi">Lire le mode d’emploi complet →</a>`;}
function readDocument(id,section){
  const doc=state.documents.find(d=>d.id===id);if(!doc){main.innerHTML='<h1>Document indisponible</h1><p>Ce document n’est pas encore accessible dans votre espace.</p><a href="#/sommaire">Retour au sommaire</a>';return;}
  const rendered=renderMarkdown(doc,state.documents), list=chapters(), i=list.findIndex(d=>d.id===id), previous=list[i-1], next=list[i+1];
  main.innerHTML=`<div class="reading-toolbar"><a href="#/sommaire">← Sommaire</a><div><button class="text-button" data-action="print">Imprimer</button>${state.repo.role==='admin'?`<a href="#/admin/${esc(id)}">Modifier</a>`:''}</div></div><div class="reading-meta"><span class="pill">Version de travail</span><span>Version ${doc.version_number||1}</span>${state.repo.role==='admin'&&doc.current_version!==doc.published_version?'<span>Brouillon administrateur</span>':''}</div><article class="prose" dir="auto">${rendered.html}</article><nav class="pagination" aria-label="Chapitres précédent et suivant">${previous?`<a href="${route(previous.id)}"><small>← PRÉCÉDENT</small>${esc(chapterTitle(previous))}</a>`:'<span></span>'}${next?`<a href="${route(next.id)}"><small>SUIVANT →</small>${esc(chapterTitle(next))}</a>`:'<a href="#/sommaire">Revenir au sommaire →</a>'}</nav>`;
  outline.innerHTML=`<p class="eyebrow">DANS CE CHAPITRE</p><nav>${rendered.headings.filter(h=>h.level===2).map(h=>`<a href="${route(id,h.id)}">${esc(h.title)}</a>`).join('')}</nav>`;
  const article=main.querySelector('article'),toolbar=document.createElement('div'),reviewSection=document.createElement('section');
  toolbar.className='review-toolbar';article.before(toolbar);
  reviewSection.className='review-section';reviewSection.innerHTML='<h2>Remarques sur ce document</h2><p class="muted">Échanges privés entre chaque relecteur et l’auteur, toutes versions confondues.</p><div class="review-list"></div>';article.after(reviewSection);
  reviews.reader(toolbar,reviewSection.querySelector('.review-list'),doc,article);
  if(section){const target=document.getElementById(resolveSection(doc,section));if(target){target.setAttribute('tabindex','-1');target.focus({preventScroll:true});target.scrollIntoView({block:'start'});}else notify('Cette section a changé de titre. Consultez le sommaire du chapitre.');}
}
function searchPage(){main.innerHTML='<p class="eyebrow">DANS LE GUIDE</p><h1>Retrouver un passage</h1><label class="searchbox"><span class="sr-only">Mots ou expression à rechercher</span><input id="search-input" type="search" placeholder="Équité, consentement, supervision…" autocomplete="off"><span aria-hidden="true">⌕</span></label><p class="muted">Recherchez des mots, ou une expression entre guillemets.</p><div id="search-results" aria-live="polite"></div>';document.querySelector('#search-input').addEventListener('input',e=>{const results=searchDocuments(state.documents,e.target.value);document.querySelector('#search-results').innerHTML=e.target.value.trim()?`<p class="result-count">${results.length} passage${results.length>1?'s':''}</p>${results.slice(0,100).map(r=>`<a class="search-result" href="${route(r.document.id,r.section)}"><small>${esc(chapterTitle(r.document))}</small><h2>${esc(r.title)}</h2><p>${esc(r.excerpt)}</p></a>`).join('')}${results.length>100?'<p>Précisez votre recherche pour afficher les autres passages.</p>':''}`:'';});}
function references(){
  main.innerHTML=`<p class="eyebrow">SOURCES ET RÉFÉRENCES</p><h1>Les références du guide</h1><p class="lead">Les sources sont citées au fil des chapitres. Retrouvez ici leurs liens lorsqu’ils sont disponibles ; le texte du chapitre précise leur contexte et leurs limites.</p><div class="reference-list">${chapters().map(d=>{
    const refs=referencesOf(d);
    return `<section><h2>${esc(chapterTitle(d))}</h2><a href="${route(d.id)}">Lire les références dans le chapitre →</a>${refs.length?`<ul>${refs.map(r=>`<li><a href="${esc(r.href)}" target="_blank" rel="noopener noreferrer">${esc(r.label)}</a></li>`).join('')}</ul>`:''}</section>`;
  }).join('')}</div>`;
}
function setupPage(){main.innerHTML=`<section class="empty-state"><p class="eyebrow">LE GUIDE DE L’IA EN SANTÉ</p><h1>Le lecteur est prêt à être connecté.</h1><p class="lead">La connexion à l’espace de publication est en cours de préparation.</p><p>Après configuration de Supabase, cette page proposera une connexion à l’administrateur et aux reviewers.</p><div class="notice">Aucun chapitre privé n’est intégré aux fichiers publics du site.</div></section>`;}
function loginPage(){main.innerHTML=`<section class="auth-panel"><p class="eyebrow">ESPACE DE RELECTURE</p><h1>Bienvenue dans le guide.</h1><p>Connectez-vous pour lire les chapitres auxquels l’auteur vous donne accès.</p><form id="login-form"><label>Adresse email<input name="email" type="email" autocomplete="username" required></label><label>Mot de passe<input name="password" type="password" autocomplete="current-password" required minlength="8"></label><button class="button" type="submit">Se connecter →</button><p id="auth-feedback" role="status"></p></form><details><summary>Créer mon compte reviewer</summary><p>Après confirmation de votre email, l’auteur devra vous accorder l’accès au guide.</p><form id="register-form"><label>Adresse email<input name="email" type="email" required autocomplete="email"></label><label>Mot de passe<input name="password" type="password" required minlength="12" autocomplete="new-password"></label><button class="button secondary">Créer mon compte</button></form></details><p class="muted">La session reste ouverte dans cet onglet. Recharger la page demande une nouvelle connexion.</p></section>`;
  document.querySelector('#login-form').onsubmit=e=>{e.preventDefault();action(async()=>{const form=new FormData(e.target),role=await state.repo.login(form.get('email'),form.get('password'));e.target.reset();if(!role){notify('Compte connecté. L’auteur doit encore vous accorder l’accès.');pendingPage();updateChrome();return;}await reload();go('/');render();});};
  document.querySelector('#register-form').onsubmit=e=>{e.preventDefault();action(async()=>{const form=new FormData(e.target);await state.repo.register(form.get('email'),form.get('password'));e.target.reset();notify('Si l’inscription est disponible, consultez votre email pour confirmer votre compte, puis attendez que l’auteur vous accorde l’accès.');});};
}
function pendingPage(){main.innerHTML='<div class="empty-state"><p class="eyebrow">COMPTE CONNECTÉ</p><h1>Votre accès est en attente.</h1><p>Votre compte confirmé attend l’autorisation de l’auteur. Reconnectez-vous après son accord pour lire le guide.</p><button class="button" data-action="logout">Revenir à la connexion</button></div>';}
async function adminPage(id,view){
  if(state.repo.role!=='admin'){main.innerHTML='<h1>Accès réservé à l’administrateur</h1>';return;}
  if(id){await editPage(id,view);return;}
  const released=chapters().filter(d=>d.published_version).length;
  main.innerHTML=`<p class="eyebrow">ESPACE AUTEUR</p><h1>Faire vivre le guide.</h1><p class="lead">Importez vos textes, relisez les modifications, puis choisissez la version accessible aux reviewers.</p><div class="stats"><div><strong>${chapters().length}</strong><span>chapitres</span></div><div><strong>${released}</strong><span>accessibles aux reviewers</span></div><div><strong>${state.documents.filter(d=>d.current_version!==d.published_version).length}</strong><span>documents avec un brouillon</span></div></div>${pendingReviewersPanel()}<section class="import-panel"><div><h2>Importer vos Markdown</h2><p>Un fichier par chapitre. Les fichiers portant le même nom mettent à jour le chapitre correspondant.</p><label class="button" for="markdown-files">Choisir des fichiers .md</label><input class="sr-only" id="markdown-files" type="file" multiple accept=".md,.markdown"><label class="text-button file-label" for="book-package">Importer une édition du guide (.json)</label><input class="sr-only" id="book-package" type="file" accept=".json"></div><div class="import-explanation"><span>01 &nbsp; Importer</span><span>02 &nbsp; Prévisualiser</span><span>03 &nbsp; Enregistrer un brouillon</span><span>04 &nbsp; Donner accès aux reviewers</span></div></section><div id="import-review"></div><div class="section-heading"><h2>Vos documents</h2><button class="button secondary" data-action="backup">Exporter une sauvegarde</button></div><div class="admin-documents">${state.documents.map(d=>`<a href="#/admin/${esc(d.id)}"><span class="doc-number">${esc(d.number||'•')}</span><div><h3>${esc(chapterTitle(d))}</h3><small>${esc(d.source_path)} · version ${d.version_number}</small></div><span class="pill ${d.current_version!==d.published_version?'draft':''}">${!d.published_version?'Brouillon':d.current_version===d.published_version?'Accessible':'Nouvelle version en brouillon'}</span><span aria-hidden="true">→</span></a>`).join('')}</div><section class="members-panel"><h2>Accès des reviewers</h2><p>Un compte confirmé est nécessaire. L’ajout donne accès aux versions diffusées du guide.</p><form id="member-form" class="inline-form"><label><span class="sr-only">Email du reviewer</span><input type="email" name="email" placeholder="Email du reviewer" required></label><button class="button secondary">Accorder l’accès</button></form><button class="text-button" data-action="members">Afficher les accès actuels</button><div id="member-list"></div></section>`;
  main.querySelector('.stats').insertAdjacentHTML('afterend','<section class="review-admin-entry"><div><h2>Les remarques de relecture</h2><p>Répondez aux relecteurs, suivez les corrections et exportez les échanges.</p></div><a class="button" href="#/commentaires">Suivre les remarques →</a></section>');
  document.querySelector('#markdown-files').onchange=e=>action(()=>queueFiles([...e.target.files]));
  document.querySelector('#book-package').onchange=e=>action(async()=>{const file=e.target.files[0];if(!file)return;if(file.size>25*1024*1024)throw Error('Dossier trop volumineux.');const bundle=JSON.parse(await file.text());if(bundle.format!=='guide-import-v1'||!Array.isArray(bundle.documents))throw Error('Ce fichier n’est pas un dossier d’import du guide.');const seen=new Set();state.queue=bundle.documents.map(d=>{validateMarkdown(d.markdown,d.source_path);if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(d.id)||!['chapter','notice','index'].includes(d.kind)||seen.has(d.id))throw Error('Identité de document invalide ou en double.');seen.add(d.id);const old=state.documents.find(x=>x.id===d.id);return {...d,title:titleOf(d.markdown,d.title),expected:old?.current_version||null};});state.queueIndex=0;renderQueue();});
  document.querySelector('#member-form').onsubmit=e=>{e.preventDefault();action(async()=>{await state.repo.grant(new FormData(e.target).get('email'));e.target.reset();notify('Accès reviewer accordé.');await Promise.all([showMembers(),showPendingReviewers()]);});};
  if(state.queue.length)renderQueue();
  await showPendingReviewers();
}
async function queueFiles(files){
  const result=[],ids=new Set();
  for(const file of files){if(file.size>2*1024*1024)throw Error(file.name+' dépasse 2 Mo.');const markdown=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());validateMarkdown(markdown,file.name);const old=state.documents.find(d=>d.source_path?.split('/').at(-1).toLowerCase()===file.name.toLowerCase());const id=old?.id||slug(file.name.replace(/\.(md|markdown)$/i,'')).replace(/[^a-z0-9-]/g,'').slice(0,80);if(!id||ids.has(id))throw Error('Nom de fichier ambigu ou en double : '+file.name);ids.add(id);result.push({...old,id,kind:old?.kind||'chapter',number:old?.number||file.name.match(/^\d+/)?.[0]||'',source_path:old?.source_path||'CHAPTERS/'+file.name.replace(/\.markdown$/i,'.md'),sort_order:old?.sort_order??100+state.documents.length+result.length,title:titleOf(markdown,file.name),markdown,expected:old?.current_version||null});}
  state.queue=result;state.queueIndex=0;renderQueue();
}
function renderQueue(){
  const root=document.querySelector('#import-review');if(!root)return;
  if(!state.queue.length){root.innerHTML='';return;}
  const doc=state.queue[state.queueIndex],rendered=renderMarkdown(doc,[...state.documents,...state.queue]);
  root.innerHTML=`<section class="queue-panel"><p class="eyebrow">VÉRIFIER L’IMPORT · ${state.queue.length} DOCUMENTS</p><label>Document à prévisualiser<select id="queue-select">${state.queue.map((d,i)=>`<option value="${i}"${i===state.queueIndex?' selected':''}>${esc(d.source_path)}</option>`).join('')}</select></label><p><strong>${esc(doc.title)}</strong> · ${doc.expected?'Nouvelle version du document existant':'Nouveau document'}</p>${rendered.warnings.map(w=>`<p class="notice">${esc(w)}</p>`).join('')}<div class="import-preview prose">${rendered.html}</div><div class="button-row"><button class="button" data-action="save-import">Enregistrer ${state.queue.length} brouillon${state.queue.length>1?'s':''}</button><button class="button secondary" data-action="cancel-import">Annuler cet import</button></div><p class="muted">Ces brouillons ne remplacent pas encore les versions accessibles aux reviewers.</p></section>`;
  document.querySelector('#queue-select').onchange=e=>{state.queueIndex=Number(e.target.value);renderQueue();};
}
async function saveImport(){
  let saved=0;const failures=[];
  for(const doc of state.queue){try{await state.repo.save(doc,doc.expected);saved++;}catch(e){failures.push({...doc,error:e.message});}}
  state.queue=failures;state.queueIndex=0;await reload();await render();
  notify(`${saved} document(s) enregistré(s) en brouillon.${failures.length?' '+failures.length+' échec(s) : '+failures[0].error:''}`,!!failures.length);
}
async function editPage(id,view){
  const doc=state.documents.find(d=>d.id===id);if(!doc){main.innerHTML='<h1>Document introuvable</h1>';return;}
  const history=await state.repo.history(id);if(view!==state.view)return;
  state.edit={...doc};state.dirty=false;
  main.innerHTML=`<div class="reading-toolbar"><a href="#/admin">← Administration</a><a href="${route(id)}">Lire le chapitre →</a></div><p class="eyebrow">MODIFIER UN DOCUMENT</p><h1 class="editor-title">${esc(chapterTitle(doc))}</h1><p class="muted">${esc(doc.source_path)} · version ${doc.version_number}</p><div class="editor-layout"><section><label>Titre du document<input id="edit-title" value="${esc(doc.title)}" maxlength="500"></label><label>Texte Markdown<textarea id="edit-markdown" spellcheck="false">${esc(doc.markdown)}</textarea></label><div class="button-row"><button class="button" data-action="save-edit">Enregistrer le brouillon</button><button class="button secondary" data-action="preview-edit">Prévisualiser</button><button class="text-button" data-action="download-md">Exporter .md</button></div><p id="edit-status" class="muted">Les versions précédentes sont conservées.</p></section><aside class="release-panel"><h2>Version de relecture</h2><p>${doc.published_version?'Une version est accessible aux reviewers.':'Ce document reste réservé à l’administrateur.'}</p><button class="button" data-action="publish">Rendre ce brouillon accessible</button>${doc.published_version?'<button class="text-button danger" data-action="unpublish">Retirer de l’espace reviewer</button>':''}<hr><h2>Historique</h2><label>Version à consulter<select id="history-select">${history.map(v=>`<option value="${v.id}">V${v.version_number} · ${esc(formatDate(v.created_at))}${v.id===doc.published_version?' · accessible':''}</option>`).join('')}</select></label><button class="text-button" data-action="view-history">Voir cette version</button><p class="muted">Une ancienne version peut être recopiée dans un nouveau brouillon.</p></aside></div><section id="editor-preview" class="prose editor-preview" hidden></section>`;
  state.history=history;
  for(const field of ['edit-title','edit-markdown'])document.querySelector('#'+field).addEventListener('input',()=>{state.dirty=true;document.querySelector('#edit-status').textContent='Modifications non enregistrées.';});
}
function edited(){const doc={...state.edit,title:document.querySelector('#edit-title').value.trim(),markdown:document.querySelector('#edit-markdown').value};validateMarkdown(doc.markdown,doc.source_path);if(!doc.title)throw Error('Le titre est requis.');return doc;}
async function showPendingReviewers(){await loadPendingReviewers(document.querySelector('#pending-reviewers'),state.repo);}
async function showMembers(){const members=await state.repo.members();const root=document.querySelector('#member-list');if(root)root.innerHTML=members.length?members.map(m=>`<div class="member-row"><span>${esc(m.email)} <small>${esc(m.role)}</small></span>${m.role==='reviewer'?`<button class="text-button danger" data-revoke="${m.user_id}">Retirer l’accès</button>`:''}</div>`).join(''):'<p class="muted">Aucun compte affiché dans cet aperçu local.</p>';}

async function render(){
  reviews.clear();
  const view=++state.view;outline.innerHTML='';updateChrome();document.body.classList.remove('menu-open');document.querySelector('#mobile-menu').setAttribute('aria-expanded','false');
  const path=currentPath();
  if(!state.repo){setupPage();return;}
  if(!state.repo.role){state.repo.session?pendingPage():loginPage();return;}
  main.className=path.startsWith('/admin')?'admin-main':'';
  const parts=path.split('/').filter(Boolean).map(decodeURIComponent);
  if(parts[0]==='commentaires'){if(parts[1]==='source')await reviews.source(main,parts[2],state.documents);else reviews.dashboard(main);}
  else if(!parts.length)home();else if(parts[0]==='sommaire')contents();else if(parts[0]==='questions')questions();else if(parts[0]==='notions')readDocument('notions');else if(parts[0]==='mode-emploi')readDocument('mode-emploi');else if(parts[0]==='references')references();else if(parts[0]==='recherche')searchPage();else if(parts[0]==='lire')readDocument(parts[1],parts[2]);else if(parts[0]==='admin')await adminPage(parts[1],view);else home();
  if(view!==state.view)return;
  if(!(parts[0]==='lire'&&parts[2])&&!(parts[0]==='commentaires'&&parts[1]==='source')){window.scrollTo(0,0);main.focus({preventScroll:true});}
  document.title=(main.querySelector('h1')?.textContent.replace(/#$/,'').trim()||'IA en santé')+' — Le guide';
}

document.addEventListener('click',e=>{
  const button=e.target.closest('[data-action],[data-revoke],[data-grant]');if(!button)return;
  action(async()=>{
    if(button.dataset.grant){await state.repo.grant(button.dataset.grant);await Promise.all([showMembers(),showPendingReviewers()]);notify('Accès reviewer accordé.');return;}
    if(button.dataset.revoke){await state.repo.revoke(button.dataset.revoke);await Promise.all([showMembers(),showPendingReviewers()]);notify('Accès retiré.');return;}
    switch(button.dataset.action){
      case 'logout': state.dirty=false;state.documents=[];state.queue=[];state.edit=null;state.history=[];try{await state.repo.logout();}finally{updateChrome();go('/connexion');await render();}break;
      case 'print': window.print();break;
      case 'save-import': await saveImport();break;
      case 'cancel-import':state.queue=[];renderQueue();break;
      case 'save-edit': {const doc=edited();await state.repo.save(doc,state.edit.current_version);state.dirty=false;await reload();await render();notify('Nouvelle version enregistrée en brouillon.');break;}
      case 'preview-edit':{const rendered=renderMarkdown(edited(),state.documents),panel=document.querySelector('#editor-preview');panel.hidden=false;panel.innerHTML='<h2>Aperçu du brouillon</h2>'+rendered.warnings.map(w=>'<p class="notice">'+esc(w)+'</p>').join('')+rendered.html;panel.scrollIntoView();break;}
      case 'publish':if(state.dirty)throw Error('Enregistre d’abord tes modifications.');await state.repo.release(state.edit.id,state.edit.current_version,state.edit.current_version);await reload();await render();notify('Cette version est maintenant accessible aux reviewers.');break;
      case 'unpublish':await state.repo.release(state.edit.id,null,state.edit.current_version);await reload();await render();notify('Document retiré de l’espace reviewer. Son historique est conservé.');break;
      case 'download-md':{const doc=edited();download(doc.source_path.split('/').at(-1),doc.markdown);break;}
      case 'backup':download('guide-sauvegarde-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(await state.repo.exportAll(),null,2),'application/json');notify('Sauvegarde téléchargée : elle contient les textes privés et les versions.');break;
      case 'members':await showMembers();break;
      case 'pending':await showPendingReviewers();break;
      case 'view-history':{const v=state.history.find(v=>v.id===document.querySelector('#history-select').value);const panel=document.querySelector('#editor-preview');panel.hidden=false;panel.innerHTML=`<h2>Version ${v.version_number}</h2><button class="button secondary" data-action="restore-history">Utiliser comme nouveau brouillon</button>`+renderMarkdown({...state.edit,...v,id:state.edit.id},state.documents).html;panel.scrollIntoView();state.restore=v;break;}
      case 'restore-history':document.querySelector('#edit-markdown').value=state.restore.markdown;document.querySelector('#edit-title').value=state.restore.title;state.dirty=true;document.querySelector('#edit-status').textContent='Ancienne version chargée. Enregistrez-la pour créer un nouveau brouillon.';document.querySelector('#edit-title').focus();break;
    }
  });
});
document.querySelector('#mobile-menu').onclick=()=>{const open=document.body.classList.toggle('menu-open');document.querySelector('#mobile-menu').setAttribute('aria-expanded',String(open));};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('menu-open')){document.body.classList.remove('menu-open');document.querySelector('#mobile-menu').setAttribute('aria-expanded','false');document.querySelector('#mobile-menu').focus();}});
let lastHash=location.hash;
window.addEventListener('hashchange',()=>{if(state.dirty&&!window.confirm('Quitter sans enregistrer les modifications ?')){history.replaceState(null,'',lastHash);return;}state.dirty=false;lastHash=location.hash;render().catch(e=>notify(e.message,true));});
window.addEventListener('beforeunload',e=>{if(state.dirty||state.queue.length){e.preventDefault();e.returnValue='';}});
async function boot(){
  config=window.__GUIDE_CONFIG__||await fetch('./config.json',{cache:'no-store'}).then(r=>r.json());
  if(config.preview){
    if(!['localhost','127.0.0.1',''].includes(location.hostname))throw Error('Cet aperçu privé ne doit pas être publié.');
    const bundle=window.__GUIDE_BOOK__||await fetch('./book-preview.json',{cache:'no-store'}).then(r=>r.json());state.repo=new PreviewRepository(bundle);
    const banner=document.querySelector('#preview-banner');banner.hidden=false;banner.textContent='Aperçu local · 12 chapitres · les modifications sont temporaires et disparaissent à la fermeture.';await reload();
  }else if(config.supabaseUrl&&config.supabasePublishableKey){state.repo=new SupabaseRepository(config);state.repo.onExpired=()=>{state.documents=[];state.edit=null;state.history=[];state.queue=[];state.dirty=false;render();};}
  await render();
}
boot().catch(e=>{main.innerHTML='<div class="empty-state"><h1>Le lecteur ne peut pas démarrer.</h1><p>'+esc(e.message)+'</p></div>';});
