import {escapeHTML as esc} from './content.mjs';

const authorAccessEmail='bintelcenter@gmail.com';

export function accessSteps(confirmed=false){
  return `<ol class="access-steps" aria-label="Les deux étapes pour accéder au guide"><li${confirmed?' class="is-complete"':''}><span class="access-step-number" aria-hidden="true">${confirmed?'✓':'1'}</span><div><h2>${confirmed?'Adresse e-mail confirmée':'Confirmez votre adresse e-mail'}</h2><p>${confirmed?'Cette première étape est terminée.':'Après votre inscription, ouvrez votre boîte e-mail et cliquez sur le lien de confirmation reçu.'}</p></div></li><li><span class="access-step-number" aria-hidden="true">2</span><div><h2>L’auteur vous accorde l’accès</h2><p>Une fois votre adresse confirmée, votre demande apparaît dans son espace. Il vous donne ensuite accès au guide.</p></div></li></ol>`;
}

export function accessContact(email=''){
  const body=`Bonjour,\n\nJ’ai confirmé mon inscription au guide de l’IA en santé et je souhaite obtenir un accès pour la relecture.\n\nMon adresse d’inscription : ${email||'[votre adresse e-mail]'}\nMon nom : \n\nMerci.`;
  const href=`mailto:${authorAccessEmail}?subject=${encodeURIComponent('Demande d’accès au guide de l’IA en santé')}&body=${encodeURIComponent(body)}`;
  return `<section class="access-contact" aria-labelledby="access-contact-title"><h2 id="access-contact-title">Signaler votre demande à l’auteur</h2><p>Après avoir confirmé votre adresse, vous pouvez lui écrire en précisant l’e-mail utilisé pour votre inscription.</p><a class="button secondary" href="${esc(href)}">Contacter l’auteur par e-mail →</a><p class="access-email">${authorAccessEmail}</p><p class="muted">Le bouton ouvre votre messagerie avec un message à compléter. Aucun e-mail n’est envoyé automatiquement.</p></section>`;
}

export function confirmationScreen(email=''){
  return `<section class="auth-panel access-panel"><p class="eyebrow">INSCRIPTION · ÉTAPE 1 SUR 2</p><h1>Consultez votre boîte e-mail.</h1><p class="lead">Votre inscription doit être confirmée avant que l’auteur puisse vous donner accès au guide.</p>${email?`<p class="access-address">Adresse renseignée : <strong>${esc(email)}</strong></p>`:''}${accessSteps()}<div class="access-help"><h2>Vous ne trouvez pas le message ?</h2><p>Patientez quelques minutes et vérifiez les dossiers <strong>Courriers indésirables / Spam</strong> et <strong>Promotions</strong>. Vérifiez également l’adresse renseignée.</p><p>Vous aviez déjà confirmé un compte avec cette adresse ? Connectez-vous avec votre mot de passe habituel.</p></div><a class="button" href="#/connexion">J’ai confirmé mon e-mail — me connecter →</a><p class="muted">Après le clic dans l’e-mail, revenez sur le guide et connectez-vous. L’accès aux chapitres reste soumis à l’accord de l’auteur.</p>${accessContact(email)}</section>`;
}

export function pendingAccessScreen(email=''){
  return `<section class="auth-panel access-panel"><p class="eyebrow">INSCRIPTION · ÉTAPE 2 SUR 2</p><h1>Votre accès attend l’accord de l’auteur.</h1><p class="lead">Votre adresse e-mail est confirmée. Votre compte apparaît dans la liste des demandes à examiner.</p>${email?`<p class="access-address">Votre compte : <strong>${esc(email)}</strong></p>`:''}${accessSteps(true)}${accessContact(email)}<p>Une fois l’accord reçu, reconnectez-vous avec la même adresse et le même mot de passe pour lire les chapitres.</p><button class="button" type="button" data-action="logout">Revenir à la connexion</button></section>`;
}

export function authErrorMessage(error){
  if(error.code==='email_not_confirmed'||/email not confirmed/i.test(error.message||''))return 'Votre adresse e-mail n’est pas encore confirmée. Ouvrez le message reçu après l’inscription et cliquez sur son lien de confirmation. Vérifiez aussi vos courriers indésirables.';
  if(error.code==='invalid_credentials'||/invalid login credentials/i.test(error.message||''))return 'Adresse e-mail ou mot de passe incorrect. Vérifiez vos identifiants. Si vous venez de vous inscrire, confirmez d’abord votre adresse avec le lien reçu par e-mail.';
  return error.message||'L’opération n’a pas abouti. Réessayez dans quelques instants.';
}
