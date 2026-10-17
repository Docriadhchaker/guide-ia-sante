import {escapeHTML} from './content.mjs';

const inboxStatusLabels={pending:'Remarque à réexaminer',accepted:'Remarque retenue',declined:'Remarque non retenue',resolved:'Remarque traitée'};
const inboxBell='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';
// Notifications are derived only from the private, server-authorized discussion.
export function reviewEvents(threads,userId){
 if(!userId)return [];
 return threads.flatMap(t=>(t.messages||[]).filter(m=>m.id&&m.author_id&&m.author_id!==userId).map(m=>({
  id:m.id,threadId:t.id,title:t.document_title,version:t.version_number,date:m.created_at,
  label:m.kind==='status'?(inboxStatusLabels[m.status]||'Suivi mis à jour'):m.id===t.messages[0]?.id?'Nouvelle remarque':'Réponse reçue'
 }))).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
}
export class ReviewReadState {
 constructor(key,storage){this.key=key;this.storage=storage;this.seen=new Set();try{const saved=JSON.parse(storage?.getItem(key)||'[]');if(Array.isArray(saved))this.seen=new Set(saved.filter(x=>typeof x==='string'));}catch{} }
 unread(events){return events.filter(e=>!this.seen.has(e.id));}
 mark(events){for(const e of events)this.seen.add(e.id);try{this.storage?.setItem(this.key,JSON.stringify([...this.seen]));}catch{} }
}
export function reviewAccount(repo){return repo?.role?(repo.preview?'preview-author':repo.session?.user?.id)||'':'';}
export class ReviewInbox {
 constructor({repository,storage}){this.repository=repository;this.storage=storage;this.key='';this.userId='';this.epoch=0;this.ticket=0;this.events=[];this.open=false;this.error='';this.loaded=false;}
 mount(root){
  this.root=root;const repo=this.repository(),userId=reviewAccount(repo),key=userId?'guide-review-read-v1:'+encodeURIComponent(repo.url||'local-preview')+':'+userId:'';
  if(key!==this.key){this.epoch++;this.ticket++;this.pending=null;this.key=key;this.userId=userId;this.events=[];this.open=false;this.error='';this.loaded=false;this.readState=new ReviewReadState(key,this.storage);if(key)void this.refresh();}
  this.draw();
 }
 accept(threads){this.ticket++;this.events=reviewEvents(threads,this.userId);this.error='';this.loaded=true;this.draw();}
 unread(thread){return this.readState?.unread(thread?reviewEvents([thread],this.userId):this.events)||[];}
 markThread(thread){this.readState?.mark(reviewEvents([thread],this.userId));this.draw();}
 async refresh(){
  if(!this.key||this.pending)return;
  const epoch=this.epoch,ticket=++this.ticket,repo=this.repository(),token={};this.pending=token;
  try{const threads=await repo.comments();if(epoch!==this.epoch||ticket!==this.ticket||reviewAccount(repo)!==this.userId)return;this.accept(threads);}
  catch{if(epoch===this.epoch&&ticket===this.ticket){this.events=[];this.error='Notifications indisponibles. Réessayez dans un instant.';this.draw();}}
  finally{if(this.pending===token)this.pending=null;}
 }
 close(focus=false){if(!this.open)return;this.open=false;this.draw();if(focus)this.root?.querySelector('.inbox-toggle')?.focus();}
 draw(){
  const root=this.root;if(!root)return;if(!this.key){root.innerHTML='';return;}
  const e=escapeHTML,unread=this.unread(),events=this.events.slice(0,30),count=unread.length;
  const focused=root.contains(root.ownerDocument.activeElement)?root.ownerDocument.activeElement.dataset.inboxFocus:null;
  root.innerHTML=`<a class="review-nav" href="#/commentaires">Relecture</a><button class="icon-button inbox-toggle" data-inbox-focus="toggle" type="button" aria-expanded="${this.open}" aria-controls="review-notifications" aria-label="Notifications de relecture${count?', '+count+' non lues':''}" title="Notifications de relecture">${inboxBell}${count?`<span class="inbox-badge" aria-hidden="true">${count>99?'99+':count}</span>`:''}</button>
  <section id="review-notifications" class="inbox-panel" aria-label="Notifications de relecture"${this.open?'':' hidden'}><div class="inbox-heading"><h2>Relecture</h2><button class="text-button" data-inbox-close aria-label="Fermer les notifications">Fermer</button></div><a class="inbox-all" href="#/commentaires">${this.repository().role==='admin'?'Suivre toutes les remarques':'Voir toutes mes remarques'} →</a>
  <p class="muted" role="status">${this.error?e(this.error):!this.loaded?'Chargement…':count?count+' notification(s) non lue(s).':'Vous êtes à jour.'}</p>
  <div class="inbox-events">${events.map(ev=>`<a data-inbox-focus="${e(ev.id)}" class="inbox-event${unread.some(u=>u.id===ev.id)?' is-unread':''}" href="#/commentaires/fil/${encodeURIComponent(ev.threadId)}"><strong>${e(ev.label)}${unread.some(u=>u.id===ev.id)?'<span class="sr-only"> — Non lu</span>':''}</strong><span>${e(ev.title)} · V${e(String(ev.version))}</span><small>${e(new Date(ev.date).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}))}</small></a>`).join('')||(!this.error&&this.loaded?'<p class="muted">Les nouvelles réponses et les changements de suivi apparaîtront ici.</p>':'')}</div>
  <div class="inbox-actions"><button class="text-button" data-inbox-refresh>Actualiser</button>${count?'<button class="text-button" data-inbox-read>Tout marquer comme lu</button>':''}</div><p class="inbox-footnote">Le repère « lu » est conservé sur ce navigateur. Les échanges restent disponibles dans Relecture.</p></section>`;
  root.querySelector('.inbox-toggle').onclick=()=>{this.open=!this.open;this.draw();if(this.open)void this.refresh();};
  root.querySelector('[data-inbox-close]').onclick=()=>this.close(true);
  root.querySelector('[data-inbox-refresh]').onclick=()=>void this.refresh();
  const readButton=root.querySelector('[data-inbox-read]');if(readButton)readButton.onclick=()=>{this.readState.mark(this.events);this.draw();root.querySelector('.inbox-toggle').focus();};
  root.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>this.close()));
  if(focused)[...root.querySelectorAll('[data-inbox-focus]')].find(el=>el.dataset.inboxFocus===focused)?.focus({preventScroll:true});
 }
}
