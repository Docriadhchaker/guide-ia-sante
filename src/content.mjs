import {marked} from '../vendor/marked.mjs';

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const plain = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`#]/g, '').replace(/\s+/g, ' ').trim();
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const slug = value => normalize(plain(value)).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
export const route = (id, section='') => '#/lire/' + encodeURIComponent(id) + (section ? '/' + encodeURIComponent(section) : '');
export const titleOf = (markdown, fallback='Sans titre') => plain(markdown.match(/^#\s+(.+)$/m)?.[1] || fallback);
export const MAX_BYTES = 2 * 1024 * 1024;

export function validateMarkdown(markdown, name='fichier.md') {
  if (!/\.(md|markdown)$/i.test(name)) throw Error('Choisis un fichier Markdown (.md ou .markdown).');
  if (typeof markdown !== 'string' || !markdown.trim()) throw Error('Ce fichier est vide.');
  if (new TextEncoder().encode(markdown).length > MAX_BYTES) throw Error('Le fichier dépasse 2 Mo. Sépare-le en chapitres.');
  if (markdown.includes('\0') || markdown.includes('\uFFFD')) throw Error('Le fichier doit être un texte UTF-8 valide.');
  return markdown;
}

export function headingsOf(markdown) {
  const headings = [], used = new Set(), sourceUsed = new Map();
  marked.walkTokens(marked.lexer(markdown), token => {
    if (token.type !== 'heading') return;
    const base = slug(token.text); let id = base, n = 2;
    while (used.has(id)) id = base + '-' + n++;
    const sourceBase=token.text.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu,'').replace(/ /g,'-');
    const count=sourceUsed.get(sourceBase)||0;sourceUsed.set(sourceBase,count+1);
    used.add(id); headings.push({id, sourceId:sourceBase+(count?'-'+count:''), title: plain(token.text), level:token.depth});
  });
  return headings;
}

export function resolveSection(document, fragment) {
  const headings=headingsOf(document.markdown||'');
  return headings.find(h=>h.id===fragment)?.id || headings.find(h=>h.sourceId===fragment)?.id || fragment;
}

// The protected reader plan is the source of the part titles and membership.
export function partsOf(catalog) {
  const plan=catalog.find(d=>d.id==='parcours');
  if(!plan)return [];
  const starts=[...(plan.markdown||'').matchAll(/^## (Partie [IV]+ — .+)$/gm)];
  const parts=starts.map((match,i)=>{
    const block=plan.markdown.slice(match.index+match[0].length,starts[i+1]?.index);
    const paths=[...block.matchAll(/\]\(\.\.\/CHAPTERS\/([^/#)]+\.md)\)/g)].map(m=>'CHAPTERS/'+m[1]);
    return {title:match[1],section:resolveSection(plan,match[1].toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu,'').replace(/ /g,'-')),
      chapters:paths.map(p=>catalog.find(d=>d.kind==='chapter'&&d.source_path===p)).filter(Boolean)};
  });
  const ids=parts.flatMap(p=>p.chapters.map(d=>d.id)), expected=catalog.filter(d=>d.kind==='chapter').map(d=>d.id);
  return parts.length===4&&parts.every(p=>p.chapters.length)&&JSON.stringify(ids)===JSON.stringify(expected)?parts:[];
}

export function referencesOf(document) {
  const refs=new Map();
  marked.walkTokens(marked.lexer(document.markdown||''),token=>{
    if(token.type!=='link'||!/^https?:\/\//i.test(token.href))return;
    const href=safeLink(token.href,document,[]);
    if(href&&!refs.has(href))refs.set(href,{href,label:plain(token.text)||href});
  });
  return [...refs.values()];
}

function relativePath(source, href) {
  const parts = source.split('/').slice(0, -1);
  for (const part of href.split('/')) {
    if (part === '..') parts.pop(); else if (part !== '.' && part) parts.push(part);
  }
  return parts.join('/').toLowerCase();
}

export function safeLink(href, document, catalog) {
  if (/^https?:\/\//i.test(href)) {
    try { const u = new URL(href); return u.username || u.password ? null : u.href; } catch { return null; }
  }
  if (href.startsWith('#')) {let fragment;try{fragment=decodeURIComponent(href.slice(1));}catch{return null;}return route(document.id, resolveSection(document,fragment));}
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//') || href.includes('\\')) return null;
  let decoded; try { decoded = decodeURIComponent(href); } catch { return null; }
  const [file, fragment=''] = decoded.split('#');
  const dest = relativePath(document.source_path || '', file);
  if (dest === 'front_matter/table_des_matieres.md') return '#/sommaire';
  const target = catalog.find(d => d.source_path?.toLowerCase() === dest);
  return target ? route(target.id, resolveSection(target,fragment)) : null;
}

export function renderMarkdown(document, catalog=[]) {
  const markdown = document.markdown || '', headings = headingsOf(markdown), warnings = new Set();
  let headingIndex=0, bibliography=false;
  const usedRefs = new Set();
  const renderer = new marked.Renderer();
  renderer.html = token => escapeHTML(token.text);
  renderer.link = function(token) {
    const label = this.parser.parseInline(token.tokens), href = safeLink(token.href, document, catalog);
    if (!href) { warnings.add('Certains liens renvoient à des documents non inclus dans le guide.'); return `<span class="unavailable" title="Document non inclus">${label}</span>`; }
    return `<a href="${escapeHTML(href)}"${/^https?:/.test(href)?' target="_blank" rel="noopener noreferrer"':''}>${label}</a>`;
  };
  // Remote pictures are never loaded automatically (tracking, rights and availability).
  renderer.image = token => { warnings.add('Les illustrations externes sont proposées sous forme de liens.'); const href=safeLink(token.href, document, catalog); return `<span class="figure-link">Illustration : ${href ? `<a href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(token.text || 'Ouvrir')}</a>` : escapeHTML(token.text || 'non jointe')}</span>`; };
  renderer.heading = function(token) {
    const h=headings[headingIndex++];
    if (/références|bibliographie|^sources\b/i.test(h.title)) bibliography=true;
    return `<h${token.depth} id="${escapeHTML(h.id)}">${this.parser.parseInline(token.tokens)}<a class="permalink" href="${route(document.id,h.id)}" aria-label="Lien vers cette section">#</a></h${token.depth}>`;
  };
  renderer.paragraph = function(token) {
    const ref = token.text.match(/^\[(\d+)\]\s/), n=ref?.[1]; let id='';
    if (bibliography && n && !usedRefs.has(n)) {usedRefs.add(n); id=` id="ref-${n}"`;}
    return `<p${id}>${this.parser.parseInline(token.tokens)}</p>\n`;
  };
  renderer.list = function(token) {
    const tag=token.ordered?'ol':'ul';
    return `<${tag}${token.ordered?` start="${Number(token.start)}"`:''}>${token.items.map((item,i)=>{
      const n=String(Number(token.start)+i); let id='';
      if(bibliography && token.ordered && !usedRefs.has(n)){usedRefs.add(n);id=` id="ref-${n}"`;}
      return `<li${id}>${this.parser.parse(item.tokens)}</li>`;
    }).join('')}</${tag}>`;
  };
  renderer.table = function(token) {return `<div class="table-scroll" tabindex="0" role="region" aria-label="Tableau défilant"><table><thead><tr>${token.header.map(c=>`<th scope="col">${this.parser.parseInline(c.tokens)}</th>`).join('')}</tr></thead><tbody>${token.rows.map(r=>`<tr>${r.map(c=>`<td>${this.parser.parseInline(c.tokens)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;};
  let html=marked.parse(markdown,{renderer,gfm:true});
  // Only link citation text outside links and code; keep unsupported numbers as written.
  let inLink=0, inCode=0;
  html=html.split(/(<[^>]+>)/g).map(piece=>{
    if(piece.startsWith('<')) {if(/^<a\b/.test(piece))inLink++;if(/^<\/a>/.test(piece))inLink--;if(/^<(pre|code)\b/.test(piece))inCode++;if(/^<\/(pre|code)>/.test(piece))inCode--;return piece;}
    if(inLink||inCode)return piece;
    return piece.replace(/\[(\d+(?:\s*[,;–-]\s*\d+)*)\]/g,(all,nums)=>'['+nums.replace(/\d+/g,n=>usedRefs.has(n)?`<a class="citation" href="${route(document.id,'ref-'+n)}">${n}</a>`:n)+']');
  }).join('');
  return {html, headings, warnings:[...warnings]};
}

export function searchDocuments(documents, query) {
  const terms = (normalize(query).match(/"[^"]+"|\S+/g)||[]).map(t=>t.replace(/^"|"$/g,''));
  if (!terms.length) return [];
  const results=[];
  for(const doc of documents){
    const sections=doc.markdown.split(/(?=^#{1,3} )/m), headings=headingsOf(doc.markdown); let offset=0;
    for(const section of sections){
      const title=section.match(/^#{1,3} (.+)$/m)?.[1], text=plain(section), norm=normalize(text);
      const h=title?headings.find((x,i)=>i>=offset && x.title===plain(title)):null;
      if(h)offset=headings.indexOf(h)+1;
      if(terms.every(t=>norm.includes(t))){const first=Math.max(0,norm.indexOf(terms[0])-60);results.push({document:doc,title:h?.title||doc.title,section:h?.id||'',excerpt:(first?'…':'')+text.slice(first,first+230)+'…'});}
    }
  }
  return results;
}
