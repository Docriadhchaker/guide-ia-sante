import {escapeHTML, renderMarkdown, route} from './content.mjs';

export const REVIEW_STATUSES={pending:'À examiner',accepted:'Retenu',declined:'Non retenu',resolved:'Traité'};
const reviewDate=value=>new Date(value).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'});
const reviewEscape=value=>escapeHTML(String(value??''));
export function commentVersion(doc,role){return doc.version_id||(role==='admin'?doc.current_version:doc.published_version);}
export function filterComments(threads,{document='',reviewer='',status=''}={}){
 return threads.filter(t=>(!document||t.document_id===document)&&(!reviewer||t.reviewer_id===reviewer)&&(!status||t.status===status));
}
// Formula-neutralized cells keep spreadsheet exports safe even for hostile input.
export function reviewCSV(threads){
 const cell=value=>{let s=String(value??'');if(/^[\s]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const rows=[['ID remarque','Chapitre','Version','ID version','Section','Passage cité','Relecteur','Statut','Date remarque','Date message','Auteur message','Type','Message']];
 for(const t of threads)for(const m of t.messages)rows.push([t.id,t.document_title,t.version_number,t.version_id,t.section_title,t.quote,t.reviewer_email,REVIEW_STATUSES[t.status],t.created_at,m.created_at,m.author_email,m.kind==='status'?'Suivi':'Commentaire',m.body]);
 return '\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
}
export function reviewMarkdown(threads){
 const safe=s=>String(s??'').replaceAll('<','&lt;').replaceAll('>','&gt;').replace(/([\\`*_{}\[\]#])/g,'\\$1');
 return '# Remarques de relecture\n\nExport privé — '+new Date().toISOString()+'\n\n'+threads.map(t=>
  '## '+safe(t.document_title)+' — V'+t.version_number+'\n\n'+
  '**Relecteur :** '+safe(t.reviewer_email)+'  \n**Statut :** '+REVIEW_STATUSES[t.status]+'  \n**Section :** '+safe(t.section_title||'Remarque générale')+'  \n**Version :** '+t.version_id+'  \n**Remarque :** '+t.id+'\n\n'+
  (t.quote?t.quote.split('\n').map(line=>'> '+safe(line)).join('\n')+'\n\n':'')+
  t.messages.map(m=>'**'+safe(m.author_email)+' — '+safe(m.created_at)+(m.kind==='status'?' — Suivi':'')+'**\n\n'+safe(m.body)+'\n').join('\n')
 ).join('\n---\n\n');
}
export function commentCard(t,admin){
 const e=reviewEscape;
 return `<article class="review-card" data-thread="${e(t.id)}"><header><div><h3>${e(t.document_title)}</h3><p>${e(t.reviewer_email)} · Version ${e(t.version_number)} · ${e(reviewDate(t.created_at))}</p></div><span class="pill">${e(REVIEW_STATUSES[t.status])}</span></header>
 <p class="review-location">${e(t.section_title||'Remarque générale')}${t.version_id!==t.published_version?' · Version différente de celle actuellement diffusée':''}</p>
 ${t.quote?`<blockquote>${e(t.quote)}</blockquote>`:''}<a href="#/commentaires/source/${e(t.id)}">Lire la version commentée →</a>
 <div class="review-messages">${t.messages.map(m=>`<section class="review-message ${m.kind==='status'?'review-event':''}"><p class="review-byline">${e(m.author_email)} · ${e(reviewDate(m.created_at))}</p><p>${e(m.body)}</p></section>`).join('')}</div>
 <form class="review-reply" data-thread="${e(t.id)}"><label>Répondre<textarea name="body" required maxlength="10000" rows="3"></textarea></label><button class="button secondary" type="submit">Envoyer la réponse</button><p class="review-feedback" role="status"></p></form>
 ${admin?`<form class="review-status" data-thread="${e(t.id)}"><label>Suivi<select name="status">${Object.entries(REVIEW_STATUSES).map(([key,label])=>`<option value="${key}"${key===t.status?' selected':''}>${e(label)}</option>`).join('')}</select></label><button class="button secondary" type="submit">Mettre à jour le suivi</button><p class="review-feedback" role="status"></p></form>`:''}</article>`;
}

// Offsets use the exact rendered text (UTF-16), excluding decorative heading links.
export function reviewTextNodes(article){
 const walker=article.ownerDocument.createTreeWalker(article,4),nodes=[];let node;
 while((node=walker.nextNode()))if(!node.parentElement.closest('.permalink'))nodes.push(node);
 return nodes;
}
export function captureReviewSelection(article,selection){
 if(!selection||selection.isCollapsed||selection.rangeCount!==1)return null;
 const range=selection.getRangeAt(0);
 if(!article.contains(range.startContainer)||!article.contains(range.endContainer))return null;
 const nodes=reviewTextNodes(article),text=nodes.map(n=>n.data).join('');let offset=0,start=null,end=null;
 for(const node of nodes){
  if(node===range.startContainer)start=offset+range.startOffset;
  if(node===range.endContainer)end=offset+range.endOffset;
  offset+=node.length;
 }
 // Browser word/drag selections use text-node boundaries; element-boundary selections
 // are measured by temporary ranges rather than guessed from the selected string.
 const boundaryOffset=(container,index)=>{
  const r=article.ownerDocument.createRange();r.selectNodeContents(article);r.setEnd(container,index);
  const fragment=r.cloneContents();fragment.querySelectorAll('.permalink').forEach(n=>n.remove());return fragment.textContent.length;
 };
 start??=boundaryOffset(range.startContainer,range.startOffset);end??=boundaryOffset(range.endContainer,range.endOffset);
 const quote=text.slice(start,end);if(!quote.trim())return null;
 let heading=null;
 for(const h of article.querySelectorAll('h1,h2,h3,h4')){
  if(h.contains(range.startContainer)||(h.compareDocumentPosition(range.startContainer)&4))heading=h;
 }
 const title=heading?.cloneNode(true);title?.querySelectorAll('.permalink').forEach(n=>n.remove());
 return {quote,anchor_start:start,anchor_end:end,section_id:heading?.id||'',section_title:title?.textContent||''};
}
export function highlightReviewQuote(article,thread){
 const nodes=reviewTextNodes(article),text=nodes.map(n=>n.data).join('');
 if(thread.anchor_start==null||text.slice(thread.anchor_start,thread.anchor_end)!==thread.quote)return false;
 let offset=0,first=null;
 for(const node of nodes){const length=node.length,a=Math.max(0,thread.anchor_start-offset),b=Math.min(length,thread.anchor_end-offset);offset+=length;
  if(b>a){const range=article.ownerDocument.createRange();range.setStart(node,a);range.setEnd(node,b);const mark=article.ownerDocument.createElement('mark');mark.className='review-highlight';range.surroundContents(mark);first??=mark;}
 }
 first?.scrollIntoView({block:'center',behavior:'instant'});return !!first;
}

export class ReviewComments {
 constructor({repository,download,dirty,notify,inbox}){this.repository=repository;this.download=download;this.dirty=dirty;this.notify=notify;this.inbox=inbox;this.epoch=0;}
 clear(){this.epoch++;if(this.selectionHandler)document.removeEventListener('selectionchange',this.selectionHandler);this.selectionHandler=null;this.root=null;this.threads=[];this.filtered=null;this.documentId=null;this.readerDocument=null;this.dirty(false);}
 get repo(){return this.repository();}
 get admin(){return this.repo.role==='admin';}
 unavailable(error){return ['PGRST202','42883','42P01'].includes(error.code)?'Le module de commentaires attend son activation dans Supabase. La lecture reste disponible.':error.message;}
 async load(root,documentId=null){
  const epoch=this.epoch;root.textContent='Chargement des remarques…';
  try{const threads=await this.repo.comments(documentId);if(epoch!==this.epoch||!root.isConnected)return;this.threads=threads;this.drawList(root,threads);}
  catch(error){if(epoch===this.epoch&&root.isConnected){root.textContent=this.unavailable(error);root.setAttribute('role','status');}}
 }
 reader(toolbar,listRoot,doc,article){
  this.documentId=doc.id;this.readerDocument=doc.id;this.filtered=null;
  toolbar.innerHTML='<button class="button secondary" data-review="selection" disabled>Commenter le passage sélectionné</button><button class="text-button" data-review="general">Remarque générale</button><a href="#/commentaires">'+(this.admin?'Suivi des remarques':'Mes remarques')+'</a><div class="review-composer" hidden></div>';
  const selectionButton=toolbar.querySelector('[data-review="selection"]');let anchor=null;
  this.selectionHandler=()=>{const captured=captureReviewSelection(article,window.getSelection());if(captured){anchor=captured;selectionButton.disabled=false;}};
  document.addEventListener('selectionchange',this.selectionHandler);
  selectionButton.onmousedown=e=>e.preventDefault();
  toolbar.querySelector('[data-review="general"]').onclick=()=>this.compose(toolbar,listRoot,doc,null);
  selectionButton.onclick=()=>{if(anchor?.quote.length>4000){this.notify('Sélectionnez un passage de moins de 4 000 caractères.',true);return;}if(anchor)this.compose(toolbar,listRoot,doc,anchor);};
  this.load(listRoot,doc.id);
 }
 compose(toolbar,listRoot,doc,anchor){
  const root=toolbar.querySelector('.review-composer');
  if(!root.hidden&&root.querySelector('textarea')?.value.trim()){this.notify('Envoyez ou annulez votre remarque en cours avant de sélectionner un autre passage.');return;}
  const payload={id:crypto.randomUUID(),document_id:doc.id,version_id:commentVersion(doc,this.repo.role),section_id:'',section_title:'',quote:'',anchor_start:null,anchor_end:null,...anchor};
  root.hidden=false;root.innerHTML=`<form><p class="muted">Remarque privée · Version ${reviewEscape(doc.version_number)} · Visible par vous et l’auteur.</p>${payload.quote?`<blockquote>${reviewEscape(payload.quote)}</blockquote>`:'<p>Remarque générale sur ce document.</p>'}<label>Votre remarque<textarea name="body" rows="4" required maxlength="10000"></textarea></label><div class="button-row"><button class="button" type="submit">Envoyer la remarque</button><button class="text-button" type="button" data-review="cancel">Annuler</button></div><p class="review-feedback" role="status"></p></form>`;
  const form=root.querySelector('form'),input=form.elements.body;input.oninput=()=>this.dirty(true);input.focus();
  root.querySelector('[data-review="cancel"]').onclick=()=>{root.hidden=true;root.innerHTML='';this.updateDirty();};
  form.onsubmit=async e=>{e.preventDefault();if(form.dataset.sending)return;const body=input.value.trim();if(!body)return;
   if(payload.body&&payload.body!==body)payload.id=crypto.randomUUID();payload.body=body;
   await this.sendForm(form,async active=>{await this.repo.createComment(payload);if(!active())return;root.hidden=true;root.innerHTML='';this.updateDirty();await this.refreshCard(listRoot,payload.id);this.notify('Remarque enregistrée avec le passage et la version lus.');});
  };
 }
 updateDirty(){this.dirty([...document.querySelectorAll('.review-reply textarea,.review-composer textarea')].some(x=>x.value.trim()));}
 async sendForm(form,fn){
  if(form.dataset.sending)return;form.dataset.sending='true';const epoch=this.epoch;
  const buttons=[...form.querySelectorAll('button,select,textarea')];buttons.forEach(b=>b.disabled=true);
  try{await fn(()=>epoch===this.epoch&&form.isConnected);}catch(error){if(epoch===this.epoch&&form.isConnected)form.querySelector('.review-feedback').textContent=this.unavailable(error);}
  finally{delete form.dataset.sending;buttons.forEach(b=>b.disabled=false);}
 }
 drawList(root,threads){
  root.innerHTML=threads.length?threads.slice().sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).map(t=>commentCard(t,this.admin)).join(''):'<p class="muted">Aucune remarque pour le moment.</p>';
  root.querySelectorAll('.review-card').forEach(card=>{const thread=threads.find(t=>t.id===card.dataset.thread),count=this.inbox?.unread(thread).length||0;if(!count)return;
   const read=document.createElement('button');read.type='button';read.className='review-read text-button';read.textContent=count+' mise(s) à jour non lue(s) · Marquer comme lu';card.querySelector('.review-messages').before(read);
   read.onclick=()=>{this.inbox.markThread(thread);read.replaceWith(Object.assign(document.createElement('p'),{className:'muted',textContent:'Mises à jour marquées comme lues.'}));};
  });
  root.querySelectorAll('textarea').forEach(t=>t.oninput=()=>this.updateDirty());
  root.querySelectorAll('.review-reply').forEach(form=>{let attempt=null;form.onsubmit=e=>{e.preventDefault();const body=form.elements.body.value.trim();if(!body)return;if(!attempt||attempt.body!==body)attempt={id:crypto.randomUUID(),body};this.sendForm(form,async active=>{
   await this.repo.replyComment(form.dataset.thread,attempt.id,body);if(!active())return;form.elements.body.value='';this.updateDirty();await this.refreshCard(root,form.dataset.thread);this.notify('Réponse enregistrée.');
  });};});
  root.querySelectorAll('.review-status').forEach(form=>form.onsubmit=e=>{e.preventDefault();if([...root.querySelectorAll('textarea')].some(x=>x.value.trim())){this.notify('Envoyez vos réponses en cours avant de changer le suivi.');return;}const t=threads.find(t=>t.id===form.dataset.thread);this.sendForm(form,async active=>{
   await this.repo.commentStatus(t.id,form.elements.status.value,t.status);if(!active())return;await this.refreshCard(root,t.id);this.notify('Suivi mis à jour.');
  });});
 }
 async refreshCard(root,id){
  // Preserve unsent replies in every card while refreshing the persisted discussion.
  const epoch=this.epoch,saved=new Map([...root.querySelectorAll('.review-reply')].map(f=>[f.dataset.thread,f.elements.body.value]));
  const all=await this.repo.comments(this.documentId||null);if(epoch!==this.epoch||!root.isConnected)return;
  this.threads=all;const rows=this.filtered?this.filtered():all.filter(t=>this.readerDocument?t.document_id===this.readerDocument:true);this.drawList(root,rows);
  const count=document.querySelector('#review-count');if(count)count.textContent=this.countLabel(rows.length);
  root.querySelectorAll('.review-reply').forEach(f=>{f.elements.body.value=saved.get(f.dataset.thread)||'';});this.updateDirty();
  if(this.documentId)void this.inbox?.refresh();else this.inbox?.accept(all);
 }
 countLabel(count){return count+' remarque(s) affichée(s).'+(this.admin?' Les exports portent sur toute la liste, y compris les autres filtres.':'');}
 dashboard(root,focusId=null){
  this.root=root;this.readerDocument=null;this.documentId=null;const admin=this.admin;
  root.innerHTML=`<p class="eyebrow">RELECTURE PRIVÉE</p><h1>${admin?'Suivre les remarques.':'Mes remarques.'}</h1><p>Chaque échange est visible par son relecteur et l’auteur du guide. Les remarques restent liées à la version lue.</p><div class="review-filters"><label>Document<select id="review-document"><option value="">Tous les documents</option></select></label>${admin?'<label>Relecteur<select id="review-reviewer"><option value="">Tous les relecteurs</option></select></label>':''}<label>Suivi<select id="review-filter-status"><option value="">Tous les statuts</option>${Object.entries(REVIEW_STATUSES).map(([s,label])=>`<option value="${s}">${label}</option>`).join('')}</select></label></div><div class="button-row"><button class="button secondary" id="review-refresh">Actualiser</button>${admin?'<button class="button secondary" data-review-export="md">Exporter les remarques (.md)</button><button class="button secondary" data-review-export="csv">Tableau (.csv)</button><button class="text-button" data-review-export="json">Archive complète (.json)</button>':''}</div><p class="muted" id="review-count" role="status"></p><div id="review-list"></div>`;
  const list=root.querySelector('#review-list'),epoch=this.epoch;
  if(focusId){root.querySelector('h1').textContent='Votre échange de relecture.';root.querySelector('.review-filters').hidden=true;root.querySelector('h1').insertAdjacentHTML('beforebegin','<a href="#/commentaires">← Toutes les remarques</a>');}
  this.filtered=()=>focusId?this.threads.filter(t=>t.id===focusId):filterComments(this.threads,{document:root.querySelector('#review-document').value,reviewer:root.querySelector('#review-reviewer')?.value||'',status:root.querySelector('#review-filter-status').value});
  const draw=()=>{const rows=this.filtered();root.querySelector('#review-count').textContent=this.countLabel(rows.length);this.drawList(list,rows);if(focusId&&!rows.length)list.textContent='Cette remarque est introuvable ou n’est plus accessible à votre compte.';};
  const refresh=async()=>{if([...list.querySelectorAll('textarea')].some(t=>t.value.trim())){this.notify('Envoyez vos réponses en cours avant d’actualiser.');return;}
   list.textContent='Chargement des remarques…';try{const threads=await this.repo.comments();if(epoch!==this.epoch)return;this.threads=threads;
    for(const [selector,key,label] of [['#review-document','document_id','document_title'],['#review-reviewer','reviewer_id','reviewer_email']]){const select=root.querySelector(selector);if(!select)continue;const selected=select.value;select.innerHTML=select.options[0].outerHTML+[...new Map(threads.map(t=>[t[key],t[label]])).entries()].map(([value,text])=>`<option value="${reviewEscape(value)}">${reviewEscape(text)}</option>`).join('');select.value=selected;}
    this.inbox?.accept(threads);if(focusId){const thread=threads.find(t=>t.id===focusId);if(thread)this.inbox?.markThread(thread);}draw();
   }catch(error){if(epoch===this.epoch)list.textContent=this.unavailable(error);}
  };
  root.querySelector('#review-refresh').onclick=refresh;
  root.querySelectorAll('.review-filters select').forEach(s=>{let previous=s.value;s.onchange=()=>{if([...list.querySelectorAll('textarea')].some(t=>t.value.trim())){s.value=previous;this.notify('Envoyez vos réponses en cours avant de changer les filtres.');return;}previous=s.value;draw();};});
  root.querySelectorAll('[data-review-export]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const threads=await this.repo.comments();if(epoch!==this.epoch)return;const format=button.dataset.reviewExport,date=new Date().toISOString().slice(0,10);const text=format==='md'?reviewMarkdown(threads):format==='csv'?reviewCSV(threads):JSON.stringify({format:'guide-reviews-v1',exported_at:new Date().toISOString(),threads},null,2);this.download('remarques-guide-'+date+'.'+format,text,format==='json'?'application/json':format==='csv'?'text/csv;charset=utf-8':'text/markdown;charset=utf-8');this.notify('Export privé téléchargé : '+threads.length+' remarque(s).');}catch(error){this.notify(this.unavailable(error),true);}finally{button.disabled=false;}});
  refresh();
 }
 async source(root,id,catalog){
  const epoch=this.epoch;root.innerHTML='<p>Chargement de la version commentée…</p>';
  try{const doc=await this.repo.commentSource(id);const all=await this.repo.comments(doc.id);if(epoch!==this.epoch)return;const thread=all.find(t=>t.id===id);if(!thread)throw Error('Commentaire inaccessible.');
   root.innerHTML=`<div class="reading-toolbar"><a href="#/commentaires">← Remarques</a><a href="${route(doc.id)}">Version actuelle →</a></div><p class="notice">Version ${reviewEscape(doc.version_number)} conservée avec la remarque. Cette page affiche le texte lu au moment du commentaire.</p><blockquote class="review-source-quote">${reviewEscape(thread.quote||'Remarque générale sur le document')}</blockquote><article class="prose review-source">${renderMarkdown(doc,catalog).html}</article>`;
   const article=root.querySelector('article');if(thread.quote&&!highlightReviewQuote(article,thread)){const title=[...article.querySelectorAll('[id]')].find(x=>x.id===thread.section_id);title?.scrollIntoView({block:'start'});}
  }catch(error){if(epoch===this.epoch)root.textContent=this.unavailable(error);}
 }
}
