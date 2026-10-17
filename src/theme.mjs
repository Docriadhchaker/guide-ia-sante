const themeMoon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.5A9 9 0 0 1 9.5 3.5a9 9 0 1 0 11 11Z"/></svg>';
const themeSun='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>';
export function preferredTheme(storage,darkSystem=false){try{const saved=storage?.getItem('guide-theme');if(['dark','light'].includes(saved))return saved;}catch{}return darkSystem?'dark':'light';}
export function initTheme({root,button,storage,media}){
 let theme=preferredTheme(storage,media?.matches),explicit=false;try{explicit=['dark','light'].includes(storage?.getItem('guide-theme'));}catch{}
 const apply=()=>{root.dataset.theme=theme;button.innerHTML=theme==='dark'?themeSun:themeMoon;const label=theme==='dark'?'Passer en mode jour':'Passer en mode nuit';button.setAttribute('aria-label',label);button.title=label;button.setAttribute('aria-pressed',String(theme==='dark'));};
 button.onclick=()=>{theme=theme==='dark'?'light':'dark';explicit=true;try{storage?.setItem('guide-theme',theme);}catch{}apply();};
 media?.addEventListener('change',event=>{if(!explicit){theme=event.matches?'dark':'light';apply();}});apply();
}
