import {escapeHTML as esc} from './content.mjs';

export function accessEmailPanel(){return `<section class="members-panel access-mail-panel" aria-labelledby="access-mail-title"><div class="section-heading"><h2 id="access-mail-title">E-mails d’activation</h2><button class="text-button" data-action="access-emails">Actualiser</button></div><p>Après validation d’un accès, le relecteur reçoit le lien de connexion. « Transmis » signifie que le service d’envoi a accepté le message.</p><p id="access-email-feedback" role="status" aria-live="polite"></p><div id="access-email-list" aria-live="polite"></div></section>`;}

export function accessEmailSummary(result){
 const prefix=result.access_granted?'Accès accordé. ':'';
 const messages={sent:'E-mail d’activation transmis au service d’envoi.',failed:'L’e-mail n’a pas pu être confirmé. Vous pouvez réessayer son envoi après une minute.',sending:'Une tentative est en cours ou vient d’avoir lieu. Actualisez le suivi dans une minute.',unknown:'Le résultat de l’envoi est incertain. Consultez le suivi avant de réessayer.',not_configured:'L’envoi automatique attend son activation dans Supabase. Aucun e-mail confirmé.',attention:'Vérifiez cet envoi dans Resend avant toute nouvelle tentative.',cancelled:'L’envoi a été annulé : l’accès ou l’adresse du compte a changé.',not_requested:'Aucun e-mail prévu pour cet accès ancien ou ce compte administrateur.'};
 return prefix+(messages[result.notification]||messages.unknown);
}

const accessEmailLoads=new WeakMap();
export async function loadAccessEmails(root,repo){
 if(!root||repo.role!=='admin')return;
 const ticket=Symbol();accessEmailLoads.set(root,ticket);root.innerHTML='<p class="muted">Chargement du suivi…</p>';
 let html;
 try{
  const rows=await repo.accessEmails();
  const labels={pending:'À envoyer',sending:'Tentative en cours',sent:'Transmis',failed:'À réessayer',attention:'À vérifier dans Resend',cancelled:'Annulé'};
  html=rows.length?rows.map(row=>`<div class="member-row access-mail-row"><div><strong>${esc(row.email)}</strong><small>${esc(labels[row.status]||'À vérifier')}${row.sent_at?' · '+esc(new Date(row.sent_at).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'})):''}</small>${row.last_error?`<p class="muted">${esc(row.last_error)}</p>`:''}</div>${['pending','failed','sending'].includes(row.status)?`<button class="button secondary" data-retry-access-email="${esc(row.user_id)}" aria-label="Réessayer l’envoi à ${esc(row.email)}">Réessayer l’envoi</button>`:''}</div>`).join(''):'<p class="muted">Aucun e-mail d’activation à afficher. Les accès antérieurs ne déclenchent pas d’envoi rétroactif.</p>';
 }catch(error){html=error.code==='PGRST202'?'<p class="notice">Le suivi des e-mails attend son activation dans Supabase. Les accès peuvent toujours être accordés.</p>':'<p class="notice">Impossible de charger le suivi. Actualisez pour réessayer.</p>';}
 if(root.isConnected&&repo.role==='admin'&&accessEmailLoads.get(root)===ticket)root.innerHTML=html;
}
