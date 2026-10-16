import {escapeHTML as esc} from './content.mjs';

export function pendingReviewersPanel(){
  return `<section class="members-panel pending-panel" aria-labelledby="pending-title"><div class="section-heading"><h2 id="pending-title">Comptes en attente</h2><button class="text-button" data-action="pending">Actualiser</button></div><p>Les personnes qui ont confirmé leur adresse email apparaissent ici. Vous choisissez à qui accorder l’accès au guide.</p><div id="pending-reviewers" aria-live="polite"><p class="muted">Chargement des comptes…</p></div></section>`;
}

const pendingLoads=new WeakMap();
export async function loadPendingReviewers(root,repo){
  if(!root||repo.role!=='admin')return;
  const load=Symbol();pendingLoads.set(root,load);
  root.innerHTML='<p class="muted">Chargement des comptes…</p>';
  let html;
  try{
    const rows=await repo.pending();
    html=repo.preview?'<p class="muted">Les inscriptions apparaîtront dans la version connectée du guide.</p>':rows.length?rows.map(person=>`<div class="member-row pending-row"><div><strong>${esc(person.email)}</strong><small>Email confirmé le ${esc(new Date(person.confirmed_at).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}))}</small></div><button class="button secondary" data-grant="${esc(person.email)}" aria-label="Accorder l’accès à ${esc(person.email)}">Accorder l’accès</button></div>`).join(''):'<p class="muted">Aucun nouveau compte confirmé en attente.</p>';
  }catch(error){
    html=error.code==='PGRST202'?'<p class="notice">La liste des comptes en attente n’est pas encore activée. L’ajout par email reste disponible ci-dessous.</p>':'<p class="notice">Impossible de charger les comptes en attente. Cliquez sur « Actualiser » pour réessayer.</p>';
  }
  // Do not display personal data after navigation/logout or a newer refresh.
  if(root.isConnected&&repo.role==='admin'&&pendingLoads.get(root)===load)root.innerHTML=html;
}
