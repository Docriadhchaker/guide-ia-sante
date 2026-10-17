export class SupabaseRepository {
  constructor(config) {this.url=config.supabaseUrl.replace(/\/$/,'');this.key=config.supabasePublishableKey;this.session=null;this.role=null;this.refreshing=null;}
  async request(path, {method='GET', body, auth=true, retry=true,timeoutMs=20000}={}) {
    if(auth) await this.ensureSession();
    const response=await fetch(this.url+path,{method,cache:'no-store',signal:AbortSignal.timeout(timeoutMs),headers:{apikey:this.key,'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+this.session.access_token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const text=await response.text(); let data; try{data=text?JSON.parse(text):null;}catch{throw Error('Réponse du serveur illisible.');}
    if(!response.ok){
      if(response.status===401&&auth&&retry){await this.refresh();return this.request(path,{method,body,auth,retry:false,timeoutMs});}
      throw Object.assign(Error(data?.msg||data?.message||data?.error_description||'Le serveur a refusé cette opération.'),{code:data?.code,status:response.status});
    }
    return data;
  }
  setSession(session){this.session={...session,expires_at:Date.now()+session.expires_in*1000};}
  async login(email,password){const data=await this.request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},auth:false});this.setSession(data);const rows=await this.request('/rest/v1/guide_members?select=role&user_id=eq.'+encodeURIComponent(data.user.id));this.role=rows[0]?.role||null;return this.role;}
  async register(email,password){return this.request('/auth/v1/signup',{method:'POST',body:{email,password},auth:false});}
  async ensureSession(){if(!this.session)throw Error('Connecte-toi pour continuer.');if(this.session.expires_at<Date.now()+60000)await this.refresh();}
  async refresh(){
    if(this.refreshing)return this.refreshing;
    if(!this.session)throw Error('Session terminée. Reconnecte-toi.');
    const token=this.session.refresh_token;
    this.refreshing=(async()=>{try{const s=await this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:token},auth:false});this.setSession(s);}catch{this.session=null;this.role=null;this.onExpired?.();throw Error('Session terminée. Reconnecte-toi.');}finally{this.refreshing=null;}})();
    return this.refreshing;
  }
  async logout(){try{if(this.session)await this.request('/auth/v1/logout',{method:'POST'});}finally{this.session=null;this.role=null;}}
  async load(){
    const documents=await this.request('/rest/v1/guide_documents?select=*&order=sort_order.asc,id.asc');
    if(!documents.length)return [];
    const ids=documents.map(d=>this.role==='admin'?d.current_version:d.published_version).filter(Boolean);
    const versions=ids.length?await this.request('/rest/v1/guide_versions?select=*&id=in.('+ids.join(',')+')'):[];
    // The home page dates the released text, even when an admin has newer drafts.
    const missing=[...new Set(documents.map(d=>d.published_version).filter(id=>id&&!versions.some(v=>v.id===id)))];
    const released=missing.length?await this.request('/rest/v1/guide_versions?select=id,created_at&id=in.('+missing.join(',')+')'):[];
    const dates=new Map([...versions,...released].map(v=>[v.id,v.created_at]));
    return documents.map(d=>({...d,...(versions.find(v=>v.id===(this.role==='admin'?d.current_version:d.published_version))||{}),id:d.id,published_version_created_at:dates.get(d.published_version)||null}));
  }
  async save(document,expectedVersion){return this.request('/rest/v1/rpc/guide_save_draft',{method:'POST',body:{p_id:document.id,p_kind:document.kind,p_number:document.number||'',p_source_path:document.source_path,p_sort_order:document.sort_order,p_title:document.title,p_markdown:document.markdown,p_expected_version:expectedVersion||null}});}
  async release(id,version,expectedVersion){return this.request('/rest/v1/rpc/guide_set_release',{method:'POST',body:{p_id:id,p_version:version,p_expected_version:expectedVersion}});}
  async history(id){const all=[];for(let offset=0;;offset+=500){const page=await this.request('/rest/v1/guide_versions?select=*&document_id=eq.'+encodeURIComponent(id)+'&order=version_number.desc&limit=500&offset='+offset);all.push(...page);if(page.length<500)return all;}}
  async members(){return this.request('/rest/v1/rpc/guide_list_members',{method:'POST',body:{}});}
  async pending(){return this.request('/rest/v1/rpc/guide_list_pending_reviewers',{method:'POST',body:{}});}
  async grant(email){
    const user_id=await this.request('/rest/v1/rpc/guide_grant_reviewer',{method:'POST',body:{p_email:email}});
    try{return {...await this.retryAccessEmail(user_id),user_id,access_granted:true};}
    catch(error){
      // The grant already succeeded. An unavailable mail service must not hide it.
      return {user_id,access_granted:true,notification:error.status===404&&error.code==='NOT_FOUND'?'not_configured':'unknown'};
    }
  }
  async retryAccessEmail(user_id){return this.request('/functions/v1/guide-reviewer-access',{method:'POST',body:{user_id},timeoutMs:45000});}
  async accessEmails(){return this.request('/rest/v1/rpc/guide_list_access_emails',{method:'POST',body:{}});}
  async revoke(id){return this.request('/rest/v1/rpc/guide_revoke_reviewer',{method:'POST',body:{p_user:id}});}
  async comments(documentId=null){const all=[];for(let offset=0;;offset+=100){const page=await this.request('/rest/v1/rpc/guide_list_comments',{method:'POST',body:{p_document:documentId,p_offset:offset}});all.push(...page);if(page.length<100)return all;}}
  async createComment(comment){return this.request('/rest/v1/rpc/guide_create_comment',{method:'POST',body:{p_id:comment.id,p_document:comment.document_id,p_version:comment.version_id,p_section:comment.section_id,p_section_title:comment.section_title,p_quote:comment.quote,p_start:comment.anchor_start,p_end:comment.anchor_end,p_body:comment.body}});}
  async replyComment(thread,id,body){return this.request('/rest/v1/rpc/guide_reply_comment',{method:'POST',body:{p_id:id,p_thread:thread,p_body:body}});}
  async commentStatus(thread,status,expected){return this.request('/rest/v1/rpc/guide_set_comment_status',{method:'POST',body:{p_thread:thread,p_status:status,p_expected:expected}});}
  async commentSource(thread){return this.request('/rest/v1/rpc/guide_comment_source',{method:'POST',body:{p_thread:thread}});}
  async exportAll(){const docs=await this.load();const versions=await Promise.all(docs.map(d=>this.history(d.id)));return {format:'guide-backup-v1',exported_at:new Date().toISOString(),documents:docs,versions:versions.flat()};}
}

// Only included as an explicit local preview. Production never loads a manuscript bundle.
export class PreviewRepository {
  constructor(bundle){this.role='admin';this.preview=true;this.docs=[];this.versions=[];for(const doc of bundle.documents){const v={id:crypto.randomUUID(),document_id:doc.id,title:doc.title,markdown:doc.markdown,version_number:1,created_at:new Date().toISOString()};this.versions.push(v);this.docs.push({...doc,current_version:v.id,published_version:v.id});}}
  async load(){return this.docs.map(d=>({...d,...this.versions.find(v=>v.id===(this.role==='admin'?d.current_version:d.published_version)),id:d.id,published_version_created_at:this.versions.find(v=>v.id===d.published_version)?.created_at||null})).sort((a,b)=>a.sort_order-b.sort_order);}
  async save(doc,expected){const old=this.docs.find(d=>d.id===doc.id);if((old?.current_version||null)!==(expected||null))throw Error('VERSION_CONFLICT: rechargez le chapitre.');const v={id:crypto.randomUUID(),document_id:doc.id,title:doc.title,markdown:doc.markdown,version_number:this.versions.filter(v=>v.document_id===doc.id).length+1,created_at:new Date().toISOString()};this.versions.push(v);if(old)Object.assign(old,{...doc,current_version:v.id,published_version:old.published_version});else this.docs.push({...doc,current_version:v.id,published_version:null});return v.id;}
  async release(id,version,expected){const d=this.docs.find(x=>x.id===id);if(d.current_version!==expected)throw Error('VERSION_CONFLICT');if(version&&!this.versions.some(v=>v.id===version&&v.document_id===id))throw Error('Version étrangère');d.published_version=version;}
  async history(id){return this.versions.filter(v=>v.document_id===id).slice().reverse();}
  async comments(documentId=null){return structuredClone((this.reviewThreads||[]).filter(t=>!documentId||t.document_id===documentId).map(t=>({...t,published_version:this.docs.find(d=>d.id===t.document_id)?.published_version})));}
  async createComment(c){this.reviewThreads??=[];if(this.reviewThreads.some(t=>t.id===c.id))return c.id;const v=this.versions.find(v=>v.id===c.version_id&&v.document_id===c.document_id);if(!v)throw Error('Version introuvable');const date=new Date().toISOString();this.reviewThreads.push({...c,reviewer_id:'preview-author',reviewer_email:'auteur@exemple.invalid',document_title:v.title,version_number:v.version_number,status:'pending',created_at:date,updated_at:date,messages:[{id:c.id,author_id:'preview-author',author_email:'auteur@exemple.invalid',body:c.body,kind:'message',created_at:date}]});return c.id;}
  async replyComment(thread,id,body){const t=this.reviewThreads?.find(t=>t.id===thread);if(!t)throw Error('Remarque introuvable');if(!t.messages.some(m=>m.id===id))t.messages.push({id,body,author_id:'preview-author',author_email:'auteur@exemple.invalid',kind:'message',created_at:new Date().toISOString()});t.updated_at=new Date().toISOString();return id;}
  async commentStatus(thread,status,expected){const t=this.reviewThreads?.find(t=>t.id===thread);if(!t)throw Error('Remarque introuvable');if(t.status!==expected)throw Error('Le statut a changé');if(!['pending','accepted','declined','resolved'].includes(status))throw Error('Statut invalide');if(t.status===status)return;t.status=status;await this.replyComment(thread,crypto.randomUUID(),{pending:'À examiner',accepted:'Retenu',declined:'Non retenu',resolved:'Traité'}[status]);t.messages.at(-1).kind='status';t.messages.at(-1).status=status;}
  async commentSource(thread){const t=this.reviewThreads?.find(t=>t.id===thread);if(!t)throw Error('Remarque introuvable');const v=this.versions.find(v=>v.id===t.version_id),d=this.docs.find(d=>d.id===t.document_id);return {...d,...v,id:d.id,version_id:v.id};}
  async exportAll(){return {format:'guide-backup-v1',documents:await this.load(),versions:this.versions};}
  async members(){return [];}
  async pending(){return [];}
  async grant(){throw Error('Les comptes seront gérés après connexion à Supabase.');}
  async accessEmails(){return [];}
  async retryAccessEmail(){throw Error('Aucun e-mail envoyé dans cet aperçu local.');}
  async revoke(){throw Error('Les comptes seront gérés après connexion à Supabase.');}
  async logout(){}
}
