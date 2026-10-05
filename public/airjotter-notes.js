// AIRJOTTER_NOTES_V2301A
(()=>{'use strict';
const DB='airjotter-notes-v1',STORE='notes',QUEUE='queue';let db,notes=[],current=null,saveTimer,sort='updated_at',dir='desc',trash=false,lastRange=null;
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function openDB(){return new Promise((ok,no)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'id'});if(!d.objectStoreNames.contains(QUEUE))d.createObjectStore(QUEUE,{keyPath:'id'})};r.onsuccess=()=>{db=r.result;ok(db)};r.onerror=()=>no(r.error)})}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}function all(store){return new Promise((ok,no)=>{const r=tx(store).getAll();r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}function put(store,v){return new Promise((ok,no)=>{const r=tx(store,'readwrite').put(v);r.onsuccess=()=>ok(v);r.onerror=()=>no(r.error)})}function del(store,id){return new Promise((ok,no)=>{const r=tx(store,'readwrite').delete(id);r.onsuccess=()=>ok();r.onerror=()=>no(r.error)})}
function api(url,opt={}){return fetch(url,{credentials:'include',headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok){const e=Error(j.error||'Operazione non riuscita');e.status=r.status;throw e}return j})}
function toast(t){const e=$('.aj-notes-toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2400)}
function shell(){const d=document.createElement('div');d.innerHTML=`<div class="aj-notes-shell" aria-hidden="true"><aside class="aj-notes-sidebar"><div class="aj-notes-brand"><img src="/airjotter_logo.png" alt="AirJotter"><b>Note</b><button class="aj-notes-close" title="Chiudi">✕</button></div><div class="aj-notes-trashbar"><b>Cestino</b><button data-empty-trash class="aj-note-btn danger">Svuota</button><button data-leave-trash class="aj-note-btn">Indietro</button></div><div class="aj-notes-search"><input type="search" placeholder="Cerca nelle note" aria-label="Cerca nelle note"><kbd>Ctrl K</kbd></div><div class="aj-notes-controls"><select aria-label="Ordina"><option value="updated_at">Ultima modifica</option><option value="created_at">Data creazione</option><option value="title">Titolo</option></select><button data-direction title="Cambia ordine">↓</button><button data-new class="aj-note-btn primary">+ Nota</button></div><div class="aj-notes-count"></div><div class="aj-notes-list"></div><button data-trash-view class="aj-note-btn" style="margin:8px 16px 16px">🗑 Cestino</button></aside><main class="aj-notes-main"><div class="aj-note-empty"><h2>Le tue Note</h2><p>Seleziona una nota oppure creane una nuova.</p></div><section class="aj-note-editor"><div class="aj-note-top"><button class="aj-note-back aj-note-iconbtn">←</button><button data-pin class="aj-note-btn">📌 Fissa</button><input data-color class="aj-note-color" type="color" value="#8fa9e0" title="Colore nota"><button data-share class="aj-note-btn">Condividi</button><button data-pdf class="aj-note-btn">PDF</button><button data-jotter class="aj-note-btn">In Jotter</button><button data-restore class="aj-note-btn" hidden>Ripristina</button><button data-delete class="aj-note-btn danger">Cestino</button><button data-save class="aj-note-btn primary">Salva</button><span class="aj-note-sync">Salvata</span></div><input class="aj-note-title" maxlength="180" placeholder="Titolo della nota"><div class="aj-note-toolbar"><button data-cmd="bold"><b>Grassetto</b></button><button data-cmd="insertUnorderedList">Elenco</button><label>🖼 Immagine<input data-image type="file" accept="image/*" multiple></label><label>📷 Foto<input data-photo type="file" accept="image/*" capture="environment"></label><label>📎 Allegato<input data-file type="file" multiple></label></div><div class="aj-note-body" contenteditable="true"></div><div class="aj-note-attachments"><h4>Allegati</h4><div class="aj-note-files"></div></div></section></main></div><div class="aj-notes-toast"></div><div class="aj-note-lightbox"><img alt="Immagine ingrandita"></div><div class="aj-note-sharebox"><div class="aj-note-dialog"><h3>Esporta la nota in un Jotter</h3><p>Scegli un Jotter esistente oppure creane uno nuovo.</p><select data-boards></select><div class="aj-note-dialog-actions"><button data-dialog-close class="aj-note-btn">Annulla</button><button data-new-board class="aj-note-btn">Nuovo Jotter</button><button data-existing-board class="aj-note-btn primary">Aggiungi al Jotter</button></div></div></div>`;document.body.append(...d.children)}
function makeButton(){const archive=document.querySelector('.aj-user-archive-v2266d'),clear=document.getElementById('clearBtn');if(!archive||document.getElementById('ajNotesBtnV2301'))return;document.querySelectorAll('.aj-owner-hint-v22107,.aj-user-archive-v2266d small').forEach(x=>x.textContent=x.textContent.replace(/Clicca qui per i tuoi Jotter/g,'I tuoi Jotter'));const b=document.createElement('button');b.id='ajNotesBtnV2301';b.type='button';b.className='aj-notes-btn-v2301';b.title='Apri Note';b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5z"/><path d="M16 3v4h4M8 11h8M8 15h8"/></svg><span>Note</span>';const group=archive.closest('.tools-group');if(group)group.insertBefore(b,archive);else clear?.parentNode?.insertBefore(b,archive);b.onclick=openApp}
// AIRJOTTER_ADMIN_NOTE_LIMITS_V2301B
let ajNotePlanMap=null;async function planText(){if(!ajNotePlanMap)try{const plans=await api('/api/plans');ajNotePlanMap=Object.fromEntries(plans.map(p=>[p.name,String(p.limits?.notes||10)+' Note']))}catch{return}const map=ajNotePlanMap||{};document.querySelectorAll('#ajPublicPlansV220 article,#ajPublicPlansV220 .aj-plan-card').forEach(c=>{const name=[...c.querySelectorAll('h2,h3,strong')].map(x=>x.textContent.trim()).find(x=>map[x]);let li=c.querySelector('.aj-note-planlimit');if(name){if(!li){li=document.createElement('li');li.className='aj-note-planlimit';(c.querySelector('ul')||c).appendChild(li)}li.textContent=map[name]+' incluse'}})}
function words(){return norm($('.aj-notes-search input').value).split(/\s+/).filter(Boolean)}function match(n){const hay=norm((n.title||'')+' '+strip(n.body_html||''));return words().every(w=>hay.includes(w))}function strip(h){const d=document.createElement('div');d.innerHTML=h;d.querySelectorAll('br,p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre,tr').forEach(el=>{el.before(document.createTextNode(' '));el.after(document.createTextNode(' '))});return String(d.textContent||'').replace(/[\s\u00a0]+/g,' ').trim()}function highlight(v){let h=esc(v);for(const w of $('.aj-notes-search input').value.trim().split(/\s+/).filter(Boolean)){h=h.replace(new RegExp('('+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig'),'<mark>$1</mark>')}return h}
function sorted(){const a=notes.filter(n=>Boolean(n.deleted_at)===trash&&match(n));return a.sort((x,y)=>{if(Boolean(x.pinned)!==Boolean(y.pinned))return x.pinned?-1:1;let A=x[sort]||'',B=y[sort]||'';if(sort==='title'){A=norm(A);B=norm(B)}const z=A<B?-1:A>B?1:0;return dir==='asc'?z:-z})}
function render(){const list=$('.aj-notes-list'),a=sorted();list.innerHTML=a.map(n=>`<article class="aj-note-card ${current?.id===n.id?'active':''}" data-id="${n.id}" style="--note-color:${esc(n.color||'#8fa9e0')}"><h3>${n.pinned?'📌 ':''}${highlight(n.title||'Senza titolo')}</h3><p>${highlight(strip(n.body_html||'').slice(0,180))}</p><footer><span>${new Date(n.updated_at||Date.now()).toLocaleString('it-IT')}</span><span>${n.sync_state==='pending'?'Da sincronizzare':''}</span></footer></article>`).join('')||'<div style="padding:24px;text-align:center;color:#7a7590">Nessuna nota.</div>';$('.aj-notes-count').textContent=`${a.length} note · limite ${window.ajNotesLimit||10}`;list.querySelectorAll('[data-id]').forEach(x=>x.onclick=()=>select(notes.find(n=>n.id===x.dataset.id)))}
function select(n){current=n;$('.aj-note-empty').style.display='none';$('.aj-note-editor').classList.add('open');$('.aj-notes-main').classList.add('mobile-open');$('.aj-note-title').value=n.title||'';$('.aj-note-body').innerHTML=n.body_html||'';$('[data-color]').value=n.color||'#8fa9e0';$('[data-pin]').textContent=n.pinned?'📌 Fissata':'📌 Fissa';$('[data-restore]').hidden=!trash;$('[data-delete]').textContent=trash?'Elimina definitivamente':'Cestino';attachments();ajApplyNoteColorV2301C(n.color||'#ffffff');render()}
function collect(){if(!current)return;current.title=$('.aj-note-title').value.trim();current.body_html=sanitize($('.aj-note-body').innerHTML);/* V2301J: il colore e salvato separatamente e non viene mai riletto dal picker. */current.updated_at=new Date().toISOString();current.sync_state='pending'}function sanitize(h){const d=document.createElement('div');d.innerHTML=h;d.querySelectorAll('script,style,iframe,object,embed,form').forEach(x=>x.remove());d.querySelectorAll('*').forEach(x=>[...x.attributes].forEach(a=>{if(/^on/i.test(a.name)||a.name==='srcdoc')x.removeAttribute(a.name)}));return d.innerHTML}
async function localSave(explicit=false){if(!current)return;collect();if(!current.title&&!strip(current.body_html).trim()&&!(current.attachments||[]).length){if(current.is_new){notes=notes.filter(x=>x.id!==current.id);current=null;render()}return}await put(STORE,current);await put(QUEUE,{id:current.id,note:current});if(explicit)toast('Nota salvata');render();sync()}
async function sync(){if(!navigator.onLine)return;const q=await all(QUEUE);for(const item of q){try{const saved=item.kind==='color'?await api('/api/notes/'+item.id+'/color',{method:'PATCH',body:JSON.stringify({color:item.color})}):await api('/api/notes/'+item.id,{method:'PUT',body:JSON.stringify(item.note)});saved.sync_state='synced';await put(STORE,saved);await del(QUEUE,item.id);notes=notes.map(n=>n.id===saved.id?saved:n);if(current?.id===saved.id)current=saved}catch(e){if(e.status===409||e.status===403){toast(e.message);break}}}render();$('.aj-note-sync').textContent='Sincronizzata'}
async function load(){notes=await all(STORE);if(navigator.onLine){try{const d=await api('/api/notes');window.ajNotesLimit=d.limit;for(const n of d.notes){n.sync_state='synced';await put(STORE,n)}notes=await all(STORE)}catch{}}render();sync()}
function newNote(){if(notes.length>=Number(window.ajNotesLimit||10))return toast('Hai raggiunto il limite di Note del tuo piano. Elimina una nota o passa al piano superiore.');const now=new Date().toISOString(),n={id:crypto.randomUUID(),title:'',body_html:'',color:'#ffffff',pinned:false,attachments:[],created_at:now,updated_at:now,deleted_at:null,is_new:true,sync_state:'pending'};notes.unshift(n);select(n);$('.aj-note-title').focus()}
function insertImage(file,attachment=false){const r=new FileReader();r.onload=()=>{if(attachment){current.attachments=current.attachments||[];current.attachments.push({id:crypto.randomUUID(),name:file.name,type:file.type,size:file.size,data_url:r.result});attachments()}else{const img=document.createElement('img');img.src=r.result;img.alt=file.name||'Immagine';const sel=getSelection();if(lastRange){sel.removeAllRanges();sel.addRange(lastRange)}document.execCommand('insertHTML',false,img.outerHTML)}schedule()};r.readAsDataURL(file)}
function attachments(){$('.aj-note-files').innerHTML=(current?.attachments||[]).map(a=>`<span class="aj-note-file"><button type="button" data-open-file="${a.id}">📎 ${esc(a.name)}</button><button type="button" data-remove-file="${a.id}" aria-label="Rimuovi allegato">×</button></span>`).join('');document.querySelectorAll('[data-open-file]').forEach(b=>b.onclick=()=>ajOpenAttachmentV2301C((current.attachments||[]).find(a=>a.id===b.dataset.openFile)));document.querySelectorAll('[data-remove-file]').forEach(b=>b.onclick=()=>{current.attachments=current.attachments.filter(a=>a.id!==b.dataset.removeFile);attachments();schedule()})}
function schedule(){clearTimeout(saveTimer);$('.aj-note-sync').textContent='Salvataggio…';saveTimer=setTimeout(()=>localSave(false),650)}
async function trashCurrent(){if(!current)return;if(trash){if(!confirm('Eliminare definitivamente questa nota? L’operazione è irreversibile.'))return;await api('/api/notes/'+current.id+'?permanent=true',{method:'DELETE'}).catch(()=>{});await del(STORE,current.id);notes=notes.filter(n=>n.id!==current.id);current=null}else{if(!confirm('Spostare questa nota nel cestino? La nota continuerà a essere conteggiata nel limite del piano finché non verrà eliminata definitivamente.'))return;current.deleted_at=new Date().toISOString();schedule();await localSave();current=null}closeEditor();render()}
function closeEditor(){$('.aj-note-editor').classList.remove('open');$('.aj-note-empty').style.display='block';$('.aj-notes-main').classList.remove('mobile-open')}
function openApp(){const s=$('.aj-notes-shell');s.classList.add('open');s.setAttribute('aria-hidden','false');load()}
function closeApp(){clearTimeout(saveTimer);const title=$('.aj-note-title')?.value.trim()||'',body=sanitize($('.aj-note-body')?.innerHTML||'');if(current&&(title!==String(current.title||'')||body!==String(current.body_html||'')))localSave(false);$('.aj-notes-shell').classList.remove('open');$('.aj-notes-shell').setAttribute('aria-hidden','true')}
async function share(){collect();const text=(current.title+'\n\n'+strip(current.body_html)).trim();if(navigator.share)await navigator.share({title:current.title||'Nota AirJotter',text});else{await navigator.clipboard.writeText(text);toast('Nota copiata negli appunti')}}
function pdf(){collect();const w=open('','_blank');w.document.write(`<title>${esc(current.title||'Nota')}</title><style>body{font:16px Arial;max-width:800px;margin:40px auto;line-height:1.5}img{max-width:100%}</style><h1>${esc(current.title||'Nota')}</h1>${current.body_html}`);w.document.close();w.print()}
async function jotterDialog(){const d=$('.aj-note-sharebox');d.classList.add('open');const boards=await api('/api/my/boards');$('[data-boards]').innerHTML=boards.map(b=>`<option value="${b.id}">${esc(b.title||'Jotter senza titolo')}</option>`).join('')}
async function exportJotter(existing){collect();const body={title:current.title||'Nota AirJotter',text:strip(current.body_html),boardId:existing?$('[data-boards]').value:null};const r=await api('/api/notes/'+current.id+'/jotter',{method:'POST',body:JSON.stringify(body)});$('.aj-note-sharebox').classList.remove('open');toast(existing?'Nota aggiunta al Jotter':'Nuovo Jotter creato');if(r.roomCode&&window.ajJoin){} }
function wire(){$('.aj-notes-close').onclick=closeApp;$('[data-new]').onclick=newNote;$('.aj-notes-search input').oninput=render;$('.aj-notes-search input').onkeydown=e=>{if(e.key==='Enter'){const n=sorted()[0];if(n)select(n)}};$('.aj-notes-controls select').onchange=e=>{sort=e.target.value;render()};$('[data-direction]').onclick=e=>{dir=dir==='desc'?'asc':'desc';e.currentTarget.textContent=dir==='desc'?'↓':'↑';render()};$('[data-save]').onclick=()=>localSave(true);$('[data-pin]').onclick=()=>{current.pinned=!current.pinned;schedule();select(current)};$('[data-color]').oninput=null;$('[data-share]').onclick=share;$('[data-pdf]').onclick=pdf;$('[data-jotter]').onclick=jotterDialog;$('[data-delete]').onclick=trashCurrent;$('[data-restore]').onclick=async()=>{if(!current)return;current.deleted_at=null;await localSave(true);trash=false;$('.aj-note-trashbar').classList.remove('open');closeEditor();render();toast('Nota ripristinata')};$('.aj-note-back').onclick=()=>{localSave();closeEditor()};$('.aj-note-title').oninput=schedule;$('.aj-note-body').oninput=schedule;$('.aj-note-body').onkeyup=()=>{const s=getSelection();if(s.rangeCount)lastRange=s.getRangeAt(0)};$('.aj-note-body').onclick=e=>{if(e.target.tagName==='IMG'){$('.aj-note-lightbox img').src=e.target.src;$('.aj-note-lightbox').classList.add('open')}};$('.aj-note-lightbox').onclick=e=>e.currentTarget.classList.remove('open');document.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>document.execCommand(b.dataset.cmd));$('[data-image]').onchange=e=>[...e.target.files].forEach(f=>insertImage(f));$('[data-photo]').onchange=e=>[...e.target.files].forEach(f=>insertImage(f));$('[data-file]').onchange=e=>[...e.target.files].forEach(f=>insertImage(f,true));$('[data-trash-view]').onclick=()=>{trash=true;$('.aj-note-trashbar').classList.add('open');render()};$('[data-leave-trash]').onclick=()=>{trash=false;$('.aj-note-trashbar').classList.remove('open');render()};$('[data-empty-trash]').onclick=async()=>{if(!confirm('Eliminare definitivamente tutte le note nel cestino?'))return;for(const n of notes.filter(n=>n.deleted_at)){await api('/api/notes/'+n.id+'?permanent=true',{method:'DELETE'}).catch(()=>{});await del(STORE,n.id)}notes=await all(STORE);render()};$('[data-dialog-close]').onclick=()=>$('.aj-note-sharebox').classList.remove('open');$('[data-new-board]').onclick=()=>exportJotter(false);$('[data-existing-board]').onclick=()=>exportJotter(true);document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&$('.aj-notes-shell').classList.contains('open')){e.preventDefault();$('.aj-notes-search input').focus()}});addEventListener('online',sync)}
async function init(){await openDB();shell();wire();ajEnhanceNotesV2301C();makeButton();planText();new MutationObserver(()=>{makeButton();planText()}).observe(document.body,{childList:true,subtree:true})}document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):init();

// AIRJOTTER_NOTES_UX_V2301C
function ajApplyNoteColorV2301C(color){const value=color||'#ffffff',editor=document.querySelector('.aj-note-editor'),body=document.querySelector('.aj-note-body'),title=document.querySelector('.aj-note-title');if(editor)editor.style.setProperty('--aj-note-bg',value);if(body)body.style.backgroundColor=value;if(title)title.style.backgroundColor=value}
function ajRgbV2301C(hex){const x=String(hex||'#ffffff').replace('#',''),n=parseInt(x.length===3?x.split('').map(v=>v+v).join(''):x,16);return {r:(n>>16)&255,g:(n>>8)&255,b:n&255}}
function ajContrastV2301C(hex){const {r,g,b}=ajRgbV2301C(hex),dark=(r*299+g*587+b*114)/1000<125;document.querySelectorAll('.aj-note-title,.aj-note-body').forEach(x=>x.style.color=dark?'#ffffff':'#302d40')}
function ajSetColorV2301C(color){return ajSaveColorStrictV2301K(color)}
function ajApplySizeV2301C(px){const size=Math.max(8,Math.min(72,Number(px)||16)),sel=getSelection();if(!sel.rangeCount)return;const range=sel.getRangeAt(0);if(range.collapsed)return;const span=document.createElement('span');span.style.fontSize=size+'px';try{range.surroundContents(span)}catch{document.execCommand('fontSize',false,'4')}schedule()}
function ajOpenAttachmentV2301C(a){if(!a?.data_url)return toast('Allegato non disponibile');try{const link=document.createElement('a');link.href=a.data_url;link.download=a.name||'allegato';link.target='_blank';link.rel='noopener';document.body.appendChild(link);link.click();link.remove();toast('Apertura allegato richiesta al dispositivo')}catch{toast('Il dispositivo non dispone di un’app compatibile')}}
function ajEnhanceNotesV2301C(){
 const save=document.querySelector('[data-save]');if(save)save.remove();
 const photo=document.querySelector('[data-photo]')?.closest('label');if(photo)photo.remove();
 const image=document.querySelector('[data-image]')?.closest('label');if(image){image.firstChild.textContent='🖼 Immagine';image.title='Scegli dalla galleria o usa la fotocamera, se proposta dal dispositivo'}
 const brand=document.querySelector('.aj-notes-brand'),trashBtn=document.querySelector('[data-trash-view]');if(brand&&trashBtn){trashBtn.classList.add('aj-notes-trash-top-v2301c');trashBtn.textContent='🗑 Cestino';brand.insertBefore(trashBtn,brand.querySelector('.aj-notes-close'))}
 const toolbar=document.querySelector('.aj-note-toolbar');if(toolbar){toolbar.querySelectorAll('[data-cmd]').forEach(x=>x.remove());const editor=document.createElement('div');editor.className='aj-wordbar-v2301c';editor.innerHTML='<label><span>Carattere</span><select data-font><option>Arial</option><option>Calibri</option><option>Georgia</option><option>Times New Roman</option><option>Verdana</option><option>Courier New</option></select></label><label><span>Dimensione</span><div><button type="button" data-size-minus>−</button><input data-font-size type="number" min="8" max="72" value="16"><button type="button" data-size-plus>+</button></div></label><label><span>Stile</span><div><button type="button" data-word="bold"><b>B</b></button><button type="button" data-word="italic"><i>I</i></button><button type="button" data-word="underline"><u>U</u></button><button type="button" data-word="insertUnorderedList">• Elenco</button></div></label>';toolbar.prepend(editor);editor.querySelector('[data-font]').onchange=e=>{document.execCommand('fontName',false,e.target.value);schedule()};editor.querySelectorAll('[data-word]').forEach(b=>b.onclick=()=>{document.execCommand(b.dataset.word);schedule()});const size=editor.querySelector('[data-font-size]'),apply=()=>ajApplySizeV2301C(size.value);editor.querySelector('[data-size-minus]').onclick=()=>{size.value=Math.max(8,+size.value-1);apply()};editor.querySelector('[data-size-plus]').onclick=()=>{size.value=Math.min(72,+size.value+1);apply()};size.onchange=apply}
 const picker=document.querySelector('[data-color]');if(picker){const palette=document.createElement('div');palette.className='aj-note-palette-v2301c';const colors=[['Bianco','#ffffff'],['Nero','#1f1f1f'],['Grigio','#d9d9d9'],['Giallo','#fff59d'],['Verde','#c8e6c9'],['Celeste','#b3e5fc'],['Rosso','#ffcdd2'],['Viola','#e1bee7'],['Arancione','#ffe0b2'],['Rosa','#f8bbd0']];palette.innerHTML=colors.map(([name,color])=>'<button type="button" title="'+name+'" aria-label="'+name+'" data-note-color="'+color+'" style="--swatch:'+color+'"></button>').join('');picker.insertAdjacentElement('afterend',palette);palette.querySelectorAll('[data-note-color]').forEach(b=>b.onclick=()=>ajSetColorV2301C(b.dataset.noteColor));picker.oninput=e=>ajSetColorV2301C(e.target.value)}
}

// AIRJOTTER_NOTES_UX_V2301D
function ajNotesLayoutV2301D(){
 const top=document.querySelector('.aj-note-top'),jotter=top?.querySelector('[data-jotter]'),trash=document.querySelector('[data-trash-view]'),delBtn=top?.querySelector('[data-delete]');
 if(top&&jotter&&trash){trash.className='aj-note-btn aj-trash-nav-v2301d';trash.innerHTML='🗑 Cestino';jotter.insertAdjacentElement('afterend',trash)}
 if(delBtn){delBtn.textContent=trash?'Elimina definitivamente':'Elimina';delBtn.classList.add('aj-delete-v2301d')}
 const oldBar=document.querySelector('.aj-notes-trashbar');if(oldBar)oldBar.hidden=true;
 let trashActions=document.querySelector('.aj-trash-actions-v2301d');if(!trashActions){trashActions=document.createElement('div');trashActions.className='aj-trash-actions-v2301d';trashActions.hidden=true;trashActions.innerHTML='<strong>Note nel cestino</strong><span>Le note nel cestino continuano a occupare spazio nel piano.</span><button type="button" data-trash-back-v2301d>← Torna alle Note</button><button type="button" data-trash-empty-v2301d>🗑 Svuota cestino</button>';document.querySelector('.aj-notes-controls')?.before(trashActions)}
 const picker=top?.querySelector('[data-color]');if(picker){picker.classList.add('aj-native-palette-v2301d');picker.title='Tavolozza personalizzata';let p=top.querySelector('.aj-standard-colors-v2301d');if(!p){p=document.createElement('div');p.className='aj-standard-colors-v2301d';p.innerHTML='<span>Colori</span>'+[['Bianco','#ffffff'],['Nero','#1f1f1f'],['Grigio','#d9d9d9'],['Giallo','#fff59d'],['Verde','#c8e6c9'],['Celeste','#b3e5fc'],['Rosso','#ffcdd2'],['Viola','#e1bee7'],['Arancione','#ffe0b2'],['Rosa','#f8bbd0']].map(([n,c])=>'<button type="button" title="'+n+'" aria-label="'+n+'" data-aj-color-v2301d="'+c+'" style="--ajc:'+c+'"></button>').join('')+'<label title="Tavolozza personalizzata">🎨 Tavolozza</label>';picker.insertAdjacentElement('afterend',p);p.querySelector('label').onclick=()=>picker.click();p.querySelectorAll('[data-aj-color-v2301d]').forEach(b=>b.onclick=()=>{ajSetColorV2301C(b.dataset.ajColorV2301d);requestAnimationFrame(()=>{document.querySelector('.aj-note-editor')?.style.setProperty('--aj-note-bg',b.dataset.ajColorV2301d);document.querySelector('.aj-note-body').style.backgroundColor=b.dataset.ajColorV2301d;document.querySelector('.aj-note-title').style.backgroundColor=b.dataset.ajColorV2301d})})}
 picker.oninput=e=>{ajSetColorV2301C(e.target.value);requestAnimationFrame(()=>ajApplyNoteColorV2301C(e.target.value))};picker.onchange=picker.oninput}
 const word=document.querySelector('.aj-wordbar-v2301c');if(word&&!word.querySelector('[data-undo-v2301d]')){const style=word.querySelector('label:last-child>div');if(style){const u=document.createElement('button');u.type='button';u.dataset.undoV2301d='';u.title='Annulla';u.textContent='↶';u.onclick=()=>{document.execCommand('undo');schedule()};const r=document.createElement('button');r.type='button';r.dataset.redoV2301d='';r.title='Ripristina';r.textContent='↷';r.onclick=()=>{document.execCommand('redo');schedule()};style.prepend(r);style.prepend(u)}}
}
function ajTrashUiV2301D(on){const a=document.querySelector('.aj-trash-actions-v2301d'),search=document.querySelector('.aj-notes-search'),controls=document.querySelector('.aj-notes-controls'),nav=document.querySelector('[data-trash-view]');if(a)a.hidden=!on;if(search)search.hidden=on;if(controls)controls.hidden=on;if(nav)nav.hidden=on;document.body.classList.toggle('aj-trash-mode-v2301d',on)}
document.addEventListener('click',e=>{if(e.target.closest('[data-trash-view]'))setTimeout(()=>ajTrashUiV2301D(true));if(e.target.closest('[data-trash-back-v2301d]')){document.querySelector('[data-leave-trash]')?.click();ajTrashUiV2301D(false)}if(e.target.closest('[data-trash-empty-v2301d]'))document.querySelector('[data-empty-trash]')?.click();if(e.target.closest('.aj-note-card'))setTimeout(()=>{const d=document.querySelector('[data-delete]');if(d)d.textContent=document.body.classList.contains('aj-trash-mode-v2301d')?'Elimina definitivamente':'Elimina'},0)},true);
document.addEventListener('DOMContentLoaded',()=>setTimeout(ajNotesLayoutV2301D,100));setTimeout(ajNotesLayoutV2301D,100);setTimeout(ajNotesLayoutV2301D,700);

// AIRJOTTER_NOTES_UX_V2301E
function ajNoteEffectiveColorV2301E(color){return !color||String(color).toLowerCase()==='#8fa9e0'?'#ffffff':color}
function ajApplyCardColorsV2301E(){document.querySelectorAll('.aj-note-card[data-id]').forEach(card=>{const note=notes.find(n=>n.id===card.dataset.id),color=ajNoteEffectiveColorV2301E(note?.color);card.style.setProperty('--note-color',color,'important');card.style.borderLeftColor=color})}
function ajResetEditorForTrashV2301E(){current=null;const ed=document.querySelector('.aj-note-editor'),empty=document.querySelector('.aj-note-empty'),main=document.querySelector('.aj-notes-main');if(ed)ed.classList.remove('open');if(empty){empty.style.display='block';empty.innerHTML='<h2>Cestino</h2><p>Seleziona una nota eliminata per ripristinarla o cancellarla definitivamente.</p>'}main?.classList.remove('mobile-open')}
function ajRestoreEditorEmptyV2301E(){const empty=document.querySelector('.aj-note-empty');if(empty){empty.innerHTML='<h2>Le tue Note</h2><p>Seleziona una nota oppure creane una nuova.</p>'}}
function ajFixTopActionsV2301E(){const top=document.querySelector('.aj-note-top'),del=top?.querySelector('[data-delete]'),trash=top?.querySelector('[data-trash-view]');if(top&&del&&trash){del.insertAdjacentElement('beforebegin',trash);trash.classList.add('aj-equal-action-v2301e');del.classList.add('aj-equal-action-v2301e')}}
const ajRenderBeforeV2301E=render;render=function(){ajRenderBeforeV2301E();ajApplyCardColorsV2301E()}
const ajSelectBeforeV2301E=select;select=function(n){if(n)n.color=ajNoteEffectiveColorV2301E(n.color);ajSelectBeforeV2301E(n);ajApplyNoteColorV2301C(n?.color||'#ffffff');ajContrastV2301C(n?.color||'#ffffff');ajApplyCardColorsV2301E()}
const ajSetColorBeforeV2301E=ajSetColorV2301C;ajSetColorV2301C=function(color){color=ajNoteEffectiveColorV2301E(color);ajSetColorBeforeV2301E(color);ajApplyNoteColorV2301C(color);ajContrastV2301C(color);ajApplyCardColorsV2301E()}
document.addEventListener('click',e=>{if(e.target.closest('[data-trash-view]'))setTimeout(()=>{trash=true;ajResetEditorForTrashV2301E();render();ajTrashUiV2301D(true)},0);if(e.target.closest('[data-trash-back-v2301d]'))setTimeout(()=>{trash=false;ajRestoreEditorEmptyV2301E();closeEditor();render();ajTrashUiV2301D(false)},0)},true);
document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{ajFixTopActionsV2301E();ajApplyCardColorsV2301E()},150));setTimeout(()=>{ajFixTopActionsV2301E();ajApplyCardColorsV2301E()},150);setTimeout(()=>{ajFixTopActionsV2301E();ajApplyCardColorsV2301E()},800);

// AIRJOTTER_NOTES_UX_V2301F
function ajNormalizeStoredColorsV2301F(){let changed=false;for(const n of notes){if(!n.color||n.color==='#8fa9e0'){n.color='#ffffff';put(STORE,n);changed=true}}return changed}
function ajPaintNoteV2301F(note){const color=String(note?.color||'#ffffff').toLowerCase(),safe=/^#[0-9a-f]{6}$/i.test(color)?color:'#ffffff';document.querySelector('.aj-note-editor')?.style.setProperty('--aj-note-bg',safe,'important');for(const el of document.querySelectorAll('.aj-note-title,.aj-note-body')){el.style.setProperty('background-color',safe,'important')}ajContrastV2301C(safe);document.querySelectorAll('.aj-note-card[data-id]').forEach(card=>{const own=notes.find(n=>n.id===card.dataset.id),ownColor=String(own?.color||'#ffffff');card.style.setProperty('--note-color',ownColor,'important');card.style.setProperty('border-left-color',ownColor,'important')})}
function ajPersistColorV2301F(color){return ajSaveColorStrictV2301K(color)}
function ajHeaderV2301F(){const brand=document.querySelector('.aj-notes-brand'),logo=brand?.querySelector('img'),title=brand?.querySelector('b'),close=brand?.querySelector('.aj-notes-close');if(!brand||!logo||!title||!close)return;logo.insertAdjacentElement('afterend',title);title.insertAdjacentElement('afterend',close);brand.classList.add('aj-brand-fixed-v2301f')}
function ajActionsV2301F(){const top=document.querySelector('.aj-note-top'),del=top?.querySelector('[data-delete]'),trash=top?.querySelector('[data-trash-view]');if(!top||!del||!trash)return;del.insertAdjacentElement('beforebegin',trash);for(const b of [trash,del]){b.classList.add('aj-final-action-v2301f');b.style.setProperty('width','126px','important');b.style.setProperty('min-width','126px','important');b.style.setProperty('height','46px','important');b.style.setProperty('margin','0','important');b.style.setProperty('align-self','center','important')}}
const ajLoadBeforeV2301F=load;load=async function(){await ajLoadBeforeV2301F();ajNormalizeStoredColorsV2301F();if(current)ajPaintNoteV2301F(current);render()}
const ajSelectBeforeV2301F=select;select=function(n){if(n&&!n.color)n.color='#ffffff';ajSelectBeforeV2301F(n);ajPaintNoteV2301F(n)}
const ajNewBeforeV2301F=newNote;newNote=function(){ajNewBeforeV2301F();if(current){current.color='#ffffff';ajPersistColorV2301F('#ffffff')}}
/* V2301L: rimosso listener globale capture colore V2301F. */
/* V2301L: rimosso listener globale input colore V2301F. */
/* V2301L: rimosso listener globale change colore V2301F. */
document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{ajHeaderV2301F();ajActionsV2301F();ajNormalizeStoredColorsV2301F();render()},180));for(const ms of [120,700,1400])setTimeout(()=>{ajHeaderV2301F();ajActionsV2301F();if(current)ajPaintNoteV2301F(current)},ms);

// AIRJOTTER_NOTES_UX_V2301G
function ajPersistWhiteAtCreationV2301G(note){if(!note)return;note.color='#ffffff';note.updated_at=note.updated_at||new Date().toISOString();note.sync_state='pending';put(STORE,note).then(()=>put(QUEUE,{id:note.id,note:{...note,color:'#ffffff'}})).then(()=>{if(navigator.onLine)sync()});ajPaintNoteV2301F(note);render()}
function ajToolbarAlwaysV2301G(){const editor=document.querySelector('.aj-note-editor'),top=document.querySelector('.aj-note-top');if(editor)editor.classList.add('aj-toolbar-host-v2301g');if(top){top.hidden=false;top.style.display='flex';top.classList.add('aj-note-top-always-v2301g')}const noNote=!current;for(const el of top?.querySelectorAll('[data-pin],[data-share],[data-pdf],[data-jotter],[data-delete],[data-color],.aj-standard-colors-v2301d')||[]){if(el.matches('[data-trash-view]'))continue;el.classList.toggle('aj-disabled-no-note-v2301g',noNote);if('disabled' in el)el.disabled=noNote}const trash=top?.querySelector('[data-trash-view]');if(trash){trash.disabled=false;trash.classList.remove('aj-disabled-no-note-v2301g')}}
function ajTrashStateV2301G(){const trashed=notes.filter(n=>Boolean(n.deleted_at)),empty=trashed.length===0,button=document.querySelector('[data-trash-empty-v2301d]');if(button){button.disabled=empty;button.classList.toggle('aj-frozen-v2301g',empty);button.title=empty?'Il cestino è già vuoto':'Elimina definitivamente tutte le note nel cestino'}const back=document.querySelector('[data-trash-back-v2301d]');if(back){back.disabled=false;back.classList.add('aj-back-green-v2301g')}const count=document.querySelector('.aj-trash-count-v2301g');if(count)count.textContent=empty?'Nessuna nota nel cestino':trashed.length+' note nel cestino'}
function ajEnsureTrashCountV2301G(){const box=document.querySelector('.aj-trash-actions-v2301d');if(box&&!box.querySelector('.aj-trash-count-v2301g')){const span=document.createElement('span');span.className='aj-trash-count-v2301g';box.querySelector('strong')?.insertAdjacentElement('afterend',span)}}
const ajNewBeforeV2301G=newNote;newNote=function(){ajNewBeforeV2301G();if(current)ajPersistWhiteAtCreationV2301G(current);ajToolbarAlwaysV2301G()}
const ajRenderBeforeV2301G=render;render=function(){ajRenderBeforeV2301G();ajToolbarAlwaysV2301G();ajEnsureTrashCountV2301G();ajTrashStateV2301G()}
const ajCloseEditorBeforeV2301G=closeEditor;closeEditor=function(){ajCloseEditorBeforeV2301G();ajToolbarAlwaysV2301G()}
document.addEventListener('click',e=>{if(e.target.closest('[data-trash-view],[data-trash-back-v2301d],[data-restore],[data-delete],[data-trash-empty-v2301d]'))setTimeout(()=>{ajToolbarAlwaysV2301G();ajEnsureTrashCountV2301G();ajTrashStateV2301G()},20)},true);
document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{ajToolbarAlwaysV2301G();ajEnsureTrashCountV2301G();ajTrashStateV2301G()},200));for(const ms of [150,800,1500])setTimeout(()=>{ajToolbarAlwaysV2301G();ajEnsureTrashCountV2301G();ajTrashStateV2301G()},ms);

// AIRJOTTER_NOTES_UX_V2301H
function ajCreateWhiteNoteV2301H(){
 if(notes.length>=Number(window.ajNotesLimit||10)){toast('Hai raggiunto il limite di Note del tuo piano. Elimina definitivamente una nota dal cestino o passa al piano superiore.');return}
 const now=new Date().toISOString();
 const note={id:crypto.randomUUID(),title:'',body_html:'',color:'#ffffff',pinned:false,attachments:[],created_at:now,updated_at:now,deleted_at:null,is_new:true,sync_state:'pending'};
 notes.unshift(note);current=note;select(note);
 const picker=document.querySelector('[data-color]');if(picker)picker.value='#ffffff';
 ajPaintNoteV2301F(note);render();document.querySelector('.aj-note-title')?.focus();
}
function ajInstallWhiteNewHandlerV2301H(){const b=document.querySelector('[data-new]');if(!b||b.dataset.ajWhiteHandlerV2301h)return;b.dataset.ajWhiteHandlerV2301h='1';b.onclick=e=>{e.preventDefault();e.stopPropagation();ajCreateWhiteNoteV2301H()}}
function ajMakeToolbarPermanentV2301H(){
 const main=document.querySelector('.aj-notes-main'),editor=document.querySelector('.aj-note-editor'),top=document.querySelector('.aj-note-top');
 if(!main||!editor||!top)return;
 if(top.parentElement===editor)main.insertBefore(top,editor);
 top.classList.add('aj-permanent-toolbar-v2301h');top.hidden=false;top.style.display='flex';top.style.visibility='visible';
 const noNote=!current;
 for(const el of top.querySelectorAll('[data-pin],[data-share],[data-pdf],[data-jotter],[data-delete],[data-color],.aj-standard-colors-v2301d')){el.classList.toggle('aj-disabled-no-note-v2301g',noNote);if('disabled' in el)el.disabled=noNote}
 const trashButton=top.querySelector('[data-trash-view]');if(trashButton){trashButton.disabled=false;trashButton.classList.remove('aj-disabled-no-note-v2301g')}
}
function ajRepairWhiteCurrentV2301H(){if(!current)return;const c=String(current.color||'').toLowerCase();if(!c||c==='#8fa9e0'){current.color='#ffffff';const picker=document.querySelector('[data-color]');if(picker)picker.value='#ffffff';ajPaintNoteV2301F(current)}}
const ajOpenAppBeforeV2301H=openApp;openApp=function(){ajOpenAppBeforeV2301H();setTimeout(()=>{ajInstallWhiteNewHandlerV2301H();ajMakeToolbarPermanentV2301H();ajRepairWhiteCurrentV2301H()},0)}
const ajSelectBeforeV2301H=select;select=function(note){if(note&&(!note.color||note.color==='#8fa9e0'))note.color='#ffffff';ajSelectBeforeV2301H(note);ajMakeToolbarPermanentV2301H();ajPaintNoteV2301F(note)}
const ajCloseEditorBeforeV2301H=closeEditor;closeEditor=function(){ajCloseEditorBeforeV2301H();ajMakeToolbarPermanentV2301H()}
const ajRenderBeforeV2301H=render;render=function(){ajRenderBeforeV2301H();ajInstallWhiteNewHandlerV2301H();ajMakeToolbarPermanentV2301H()}
document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{ajInstallWhiteNewHandlerV2301H();ajMakeToolbarPermanentV2301H();ajRepairWhiteCurrentV2301H()},220));for(const ms of [100,500,1200])setTimeout(()=>{ajInstallWhiteNewHandlerV2301H();ajMakeToolbarPermanentV2301H();ajRepairWhiteCurrentV2301H()},ms);

// AIRJOTTER_NOTES_WHITE_HEADER_V2301I
function ajValidColorV2301I(value){const color=String(value||'').trim().toLowerCase();return /^#[0-9a-f]{6}$/.test(color)?color:'#ffffff'}
async function ajCommitColorV2301I(color){
 if(!current)return;
 const safe=ajValidColorV2301I(color);
 current.color=safe;current.updated_at=new Date().toISOString();current.sync_state='pending';
 const picker=document.querySelector('[data-color]');if(picker)picker.value=safe;
 const editor=document.querySelector('.aj-note-editor');editor?.style.setProperty('--aj-note-bg',safe,'important');
 for(const el of document.querySelectorAll('.aj-note-title,.aj-note-body'))el.style.setProperty('background-color',safe,'important');
 ajContrastV2301C(safe);
 for(const card of document.querySelectorAll('.aj-note-card[data-id]')){const n=notes.find(x=>x.id===card.dataset.id),c=ajValidColorV2301I(n?.id===current.id?safe:n?.color);card.style.setProperty('--note-color',c,'important');card.style.setProperty('border-left-color',c,'important')}
 await put(STORE,{...current,color:safe});await put(QUEUE,{id:current.id,note:{...current,color:safe}});
 render();
 requestAnimationFrame(()=>{document.querySelector('.aj-note-editor')?.style.setProperty('--aj-note-bg',safe,'important');for(const el of document.querySelectorAll('.aj-note-title,.aj-note-body'))el.style.setProperty('background-color',safe,'important')});
 if(navigator.onLine)sync();
}
function ajInstallColorAuthorityV2301I(){
 const palette=document.querySelector('.aj-standard-colors-v2301d');if(palette&&!palette.dataset.ajAuthorityV2301i){palette.dataset.ajAuthorityV2301i='1';palette.addEventListener('click',e=>{const sw=e.target.closest('[data-aj-color-v2301d]');if(!sw)return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();ajCommitColorV2301I(sw.dataset.ajColorV2301d)},true)}
 const picker=document.querySelector('[data-color]');if(picker&&!picker.dataset.ajAuthorityV2301i){picker.dataset.ajAuthorityV2301i='1';for(const type of ['input','change'])picker.addEventListener(type,e=>{e.stopImmediatePropagation();ajCommitColorV2301I(e.target.value)},true)}
}
function ajRepairColorsV2301I(){for(const n of notes){n.color=ajValidColorV2301I(n.color)}if(current){current.color=ajValidColorV2301I(current.color);const safe=current.color;document.querySelector('.aj-note-editor')?.style.setProperty('--aj-note-bg',safe,'important');for(const el of document.querySelectorAll('.aj-note-title,.aj-note-body'))el.style.setProperty('background-color',safe,'important');ajContrastV2301C(safe)}for(const card of document.querySelectorAll('.aj-note-card[data-id]')){const n=notes.find(x=>x.id===card.dataset.id),safe=ajValidColorV2301I(n?.color);card.style.setProperty('--note-color',safe,'important');card.style.setProperty('border-left-color',safe,'important')}}
function ajAlignHeaderRightV2301I(){const brand=document.querySelector('.aj-notes-brand'),title=brand?.querySelector('b'),close=brand?.querySelector('.aj-notes-close'),logo=brand?.querySelector('img');if(!brand||!title||!close||!logo)return;logo.insertAdjacentElement('afterend',title);title.insertAdjacentElement('afterend',close);brand.classList.add('aj-header-right-v2301i')}
const ajLoadBeforeV2301I=load;load=async function(){await ajLoadBeforeV2301I();for(const n of notes){if(!n.color||n.color==='#8fa9e0'){n.color='#ffffff';await put(STORE,n)}}ajInstallColorAuthorityV2301I();ajRepairColorsV2301I()}
const ajSelectBeforeV2301I=select;select=function(n){if(n)n.color=ajValidColorV2301I(n.color);ajSelectBeforeV2301I(n);ajInstallColorAuthorityV2301I();ajRepairColorsV2301I()}
const ajRenderBeforeV2301I=render;render=function(){ajRenderBeforeV2301I();ajInstallColorAuthorityV2301I();ajRepairColorsV2301I();ajAlignHeaderRightV2301I()}
document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{ajInstallColorAuthorityV2301I();ajRepairColorsV2301I();ajAlignHeaderRightV2301I()},250));for(const ms of [120,600,1400])setTimeout(()=>{ajInstallColorAuthorityV2301I();ajRepairColorsV2301I();ajAlignHeaderRightV2301I()},ms);

// AIRJOTTER_NOTES_COLOR_FINAL_V2301J
function ajColorV2301J(value){const c=String(value||'').trim().toLowerCase();return /^#[0-9a-f]{6}$/.test(c)?c:'#ffffff'}
function ajPaintColorV2301J(note){if(!note)return;const color=ajColorV2301J(note.color);document.querySelector('.aj-note-editor')?.style.setProperty('--aj-note-bg',color,'important');for(const el of document.querySelectorAll('.aj-note-title,.aj-note-body'))el.style.setProperty('background-color',color,'important');ajContrastV2301C(color);for(const card of document.querySelectorAll('.aj-note-card[data-id]')){const n=notes.find(x=>x.id===card.dataset.id),c=ajColorV2301J(n?.color);card.style.setProperty('--note-color',c,'important');card.style.setProperty('border-left-color',c,'important')}}
async function ajSaveColorOnlyV2301J(value){if(!current)return;const color=ajColorV2301J(value),originalUpdated=current.updated_at;current.color=color;current.sync_state='pending';const picker=document.querySelector('[data-color]');if(picker)picker.value=color;await put(STORE,{...current,color,updated_at:originalUpdated});await put(QUEUE,{id:current.id,kind:'color',color,updated_at:originalUpdated});ajPaintColorV2301J(current);render();requestAnimationFrame(()=>ajPaintColorV2301J(current));if(navigator.onLine)sync()}
function ajInstallFinalColorV2301J(){const palette=document.querySelector('.aj-standard-colors-v2301d');if(palette&&!palette.dataset.ajFinalV2301j){palette.dataset.ajFinalV2301j='1';palette.addEventListener('click',e=>{const b=e.target.closest('[data-aj-color-v2301d]');if(!b)return;e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();ajSaveColorOnlyV2301J(b.dataset.ajColorV2301d)},true)}const picker=document.querySelector('[data-color]');if(picker&&!picker.dataset.ajFinalV2301j){picker.dataset.ajFinalV2301j='1';for(const type of ['input','change'])picker.addEventListener(type,e=>{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();ajSaveColorOnlyV2301J(e.target.value)},true)}}
const ajSelectBeforeV2301J=select;select=function(n){if(n)n.color=ajColorV2301J(n.color);ajSelectBeforeV2301J(n);ajInstallFinalColorV2301J();ajPaintColorV2301J(n)}
const ajRenderBeforeV2301J=render;render=function(){ajRenderBeforeV2301J();ajInstallFinalColorV2301J();if(current)ajPaintColorV2301J(current);else for(const card of document.querySelectorAll('.aj-note-card[data-id]')){const n=notes.find(x=>x.id===card.dataset.id),c=ajColorV2301J(n?.color);card.style.setProperty('--note-color',c,'important');card.style.setProperty('border-left-color',c,'important')}}
document.addEventListener('DOMContentLoaded',()=>setTimeout(ajInstallFinalColorV2301J,250));for(const ms of [100,600,1400])setTimeout(()=>{ajInstallFinalColorV2301J();if(current)ajPaintColorV2301J(current)},ms);

// AIRJOTTER_NOTES_COLOR_TIMESTAMP_V2301K
let ajColorUiInstalledV2301K=false;
function ajPaintOnlyV2301K(note){if(!note)return;const color=ajColorV2301J(note.color);document.querySelector('.aj-note-editor')?.style.setProperty('--aj-note-bg',color,'important');for(const el of document.querySelectorAll('.aj-note-title,.aj-note-body'))el.style.setProperty('background-color',color,'important');ajContrastV2301C(color);for(const card of document.querySelectorAll('.aj-note-card[data-id]')){const n=notes.find(x=>x.id===card.dataset.id),c=ajColorV2301J(n?.color);card.style.setProperty('--note-color',c,'important');card.style.setProperty('border-left-color',c,'important')}}
async function ajSaveColorStrictV2301K(value){
 if(!current)return;
 const color=ajColorV2301J(value),originalUpdated=current.updated_at,originalRevision=current.server_revision;
 current.color=color;
 const picker=document.querySelector('[data-color]');if(picker)picker.value=color;
 ajPaintOnlyV2301K(current);
 await put(STORE,{...current,color,updated_at:originalUpdated,server_revision:originalRevision});
 try{
  if(navigator.onLine){const saved=await api('/api/notes/'+current.id+'/color',{method:'PATCH',body:JSON.stringify({color})});current={...current,...saved,color,updated_at:originalUpdated,server_revision:originalRevision};notes=notes.map(n=>n.id===current.id?current:n);await put(STORE,current)}
  else await put(QUEUE,{id:current.id,kind:'color',color,updated_at:originalUpdated,server_revision:originalRevision});
 }catch{await put(QUEUE,{id:current.id,kind:'color',color,updated_at:originalUpdated,server_revision:originalRevision})}
 render();requestAnimationFrame(()=>ajPaintOnlyV2301K(current));
}
function ajReplaceColorControlsV2301K(){
 const oldPalette=document.querySelector('.aj-standard-colors-v2301d');
 if(oldPalette&&!oldPalette.dataset.ajCleanV2301k){const clean=oldPalette.cloneNode(true);clean.dataset.ajCleanV2301k='1';oldPalette.replaceWith(clean);clean.addEventListener('click',e=>{const sw=e.target.closest('[data-aj-color-v2301d]');if(!sw)return;e.preventDefault();e.stopPropagation();ajSaveColorStrictV2301K(sw.dataset.ajColorV2301d)});const label=clean.querySelector('label');if(label)label.onclick=()=>document.querySelector('[data-color]')?.click()}
 const oldPicker=document.querySelector('[data-color]');
 if(oldPicker&&!oldPicker.dataset.ajCleanV2301k){const clean=oldPicker.cloneNode(true);clean.dataset.ajCleanV2301k='1';oldPicker.replaceWith(clean);clean.value=ajColorV2301J(current?.color||'#ffffff');clean.addEventListener('input',e=>ajSaveColorStrictV2301K(e.target.value));clean.addEventListener('change',e=>ajSaveColorStrictV2301K(e.target.value))}
 ajColorUiInstalledV2301K=true;
}
const ajOpenBeforeV2301K=openApp;openApp=function(){ajOpenBeforeV2301K();setTimeout(()=>{ajReplaceColorControlsV2301K();if(current)ajPaintOnlyV2301K(current)},0)}
const ajSelectBeforeV2301K=select;select=function(n){ajSelectBeforeV2301K(n);ajReplaceColorControlsV2301K();if(n)ajPaintOnlyV2301K(n)}
const ajRenderBeforeV2301K=render;render=function(){ajRenderBeforeV2301K();ajReplaceColorControlsV2301K();if(current)ajPaintOnlyV2301K(current)}
document.addEventListener('DOMContentLoaded',()=>setTimeout(ajReplaceColorControlsV2301K,300));for(const ms of [150,700,1500])setTimeout(()=>{ajReplaceColorControlsV2301K();if(current)ajPaintOnlyV2301K(current)},ms);

// AIRJOTTER_NOTES_PREVIEW_PALETTE_V2301N
function ajOpenNativePaletteV2301N(){const picker=document.querySelector('[data-color]');if(!picker||picker.disabled)return;try{if(typeof picker.showPicker==='function')picker.showPicker();else picker.click()}catch{picker.click()}}
function ajRepairPaletteButtonV2301N(){const palette=document.querySelector('.aj-standard-colors-v2301d');if(!palette)return;let trigger=palette.querySelector('[data-palette-trigger-v2301n]');const legacy=palette.querySelector('label');if(!trigger){trigger=document.createElement('button');trigger.type='button';trigger.dataset.paletteTriggerV2301n='1';trigger.className='aj-palette-trigger-v2301n';trigger.innerHTML='🎨 Tavolozza';if(legacy)legacy.replaceWith(trigger);else palette.appendChild(trigger)}trigger.disabled=!current;trigger.classList.toggle('aj-disabled-no-note-v2301g',!current);trigger.onclick=e=>{e.preventDefault();e.stopPropagation();ajOpenNativePaletteV2301N()}}
const ajRenderBeforeV2301N=render;render=function(){ajRenderBeforeV2301N();ajRepairPaletteButtonV2301N()}
const ajSelectBeforeV2301N=select;select=function(n){ajSelectBeforeV2301N(n);ajRepairPaletteButtonV2301N()}
document.addEventListener('DOMContentLoaded',()=>setTimeout(ajRepairPaletteButtonV2301N,250));for(const ms of [120,650,1400])setTimeout(ajRepairPaletteButtonV2301N,ms);

// AIRJOTTER_NOTES_PALETTE_NATIVE_V2301Q
function ajInstallNativePaletteV2301Q(){
 const palette=document.querySelector('.aj-standard-colors-v2301d');if(!palette)return;
 palette.querySelector('[data-palette-trigger-v2301n]')?.remove();
 let shell=palette.querySelector('.aj-palette-native-v2301q');
 if(!shell){
  shell=document.createElement('span');shell.className='aj-palette-native-v2301q';shell.title='Tavolozza personalizzata';shell.setAttribute('aria-label','Tavolozza personalizzata');
  shell.innerHTML='<span aria-hidden="true">🎨</span><input type="color" data-palette-native-input-v2301q aria-label="Scegli un colore personalizzato">';
  palette.appendChild(shell);
  const input=shell.querySelector('[data-palette-native-input-v2301q]');
  input.addEventListener('input',e=>ajSaveColorStrictV2301K(e.target.value));
  input.addEventListener('change',e=>ajSaveColorStrictV2301K(e.target.value));
 }
 const input=shell.querySelector('[data-palette-native-input-v2301q]');
 const enabled=Boolean(current);shell.classList.toggle('aj-palette-disabled-v2301q',!enabled);input.disabled=!enabled;if(enabled)input.value=ajColorV2301J(current.color||'#ffffff');
}
const ajRenderBeforeV2301Q=render;render=function(){ajRenderBeforeV2301Q();ajInstallNativePaletteV2301Q()}
const ajSelectBeforeV2301Q=select;select=function(note){ajSelectBeforeV2301Q(note);ajInstallNativePaletteV2301Q()}
const ajOpenBeforeV2301Q=openApp;openApp=function(){ajOpenBeforeV2301Q();setTimeout(ajInstallNativePaletteV2301Q,0)}
document.addEventListener('DOMContentLoaded',()=>setTimeout(ajInstallNativePaletteV2301Q,250));for(const ms of [100,600,1400])setTimeout(ajInstallNativePaletteV2301Q,ms);

// AIRJOTTER_NOTES_PALETTE_APPLY_V2301R
let ajPalettePollV2301R=0;
function ajApplyPaletteValueV2301R(input){if(!input||!current)return;const color=ajColorV2301J(input.value);if(color===ajColorV2301J(current.color))return;ajSaveColorStrictV2301K(color)}
function ajBindPaletteApplyV2301R(){const input=document.querySelector('[data-palette-native-input-v2301q]');if(!input||input.dataset.ajApplyV2301r)return;input.dataset.ajApplyV2301r='1';
 for(const type of ['input','change','blur'])input.addEventListener(type,()=>ajApplyPaletteValueV2301R(input));
 input.addEventListener('pointerdown',()=>{clearInterval(ajPalettePollV2301R);let previous=input.value;ajPalettePollV2301R=setInterval(()=>{if(!document.body.contains(input)){clearInterval(ajPalettePollV2301R);return}if(input.value!==previous){previous=input.value;ajApplyPaletteValueV2301R(input)}},120);setTimeout(()=>clearInterval(ajPalettePollV2301R),30000)});
 window.addEventListener('focus',()=>setTimeout(()=>{ajApplyPaletteValueV2301R(input);clearInterval(ajPalettePollV2301R)},0),{once:true});
}
const ajRenderBeforeV2301R=render;render=function(){ajRenderBeforeV2301R();ajBindPaletteApplyV2301R()}
const ajSelectBeforeV2301R=select;select=function(note){ajSelectBeforeV2301R(note);ajBindPaletteApplyV2301R()}
document.addEventListener('DOMContentLoaded',()=>setTimeout(ajBindPaletteApplyV2301R,300));for(const ms of [120,700,1500])setTimeout(ajBindPaletteApplyV2301R,ms);

// AIRJOTTER_NOTES_SEARCH_FONT_V2301S
let ajFontRangeV2301S=null;
function ajRemoveSearchHintV2301S(){document.querySelector('.aj-notes-search kbd')?.remove()}
function ajRememberFontRangeV2301S(){const body=document.querySelector('.aj-note-body'),sel=getSelection();if(!body||!sel||!sel.rangeCount)return;const range=sel.getRangeAt(0);const node=range.commonAncestorContainer,nodeEl=node.nodeType===1?node:node.parentElement;if(nodeEl&&body.contains(nodeEl))ajFontRangeV2301S=range.cloneRange()}
function ajApplyFontV2301S(font){
 const body=document.querySelector('.aj-note-body');if(!body||!current)return;const family=String(font||'Arial').replace(/[<>"']/g,'');let range=ajFontRangeV2301S;
 if(range&&!range.collapsed&&document.contains(range.commonAncestorContainer)){
  const span=document.createElement('span');span.style.fontFamily=family;const fragment=range.extractContents();span.appendChild(fragment);range.insertNode(span);const sel=getSelection();sel.removeAllRanges();const selected=document.createRange();selected.selectNodeContents(span);sel.addRange(selected);ajFontRangeV2301S=selected.cloneRange();
 }else{
  let root=body.querySelector(':scope > [data-aj-font-root-v2301s]');
  if(!root||body.children.length!==1){root=document.createElement('div');root.dataset.ajFontRootV2301s='1';while(body.firstChild)root.appendChild(body.firstChild);body.appendChild(root)}
  root.style.fontFamily=family;
 }
 current.body_html=sanitize(body.innerHTML);schedule();requestAnimationFrame(()=>body.focus());
}
function ajInstallFontV2301S(){
 ajRemoveSearchHintV2301S();const body=document.querySelector('.aj-note-body'),select=document.querySelector('[data-font]');if(!body||!select)return;
 if(!body.dataset.ajFontRangeV2301s){body.dataset.ajFontRangeV2301s='1';for(const type of ['mouseup','keyup','touchend'])body.addEventListener(type,ajRememberFontRangeV2301S);document.addEventListener('selectionchange',()=>{if(document.activeElement===body)ajRememberFontRangeV2301S()})}
 if(!select.dataset.ajFontFixedV2301s){select.dataset.ajFontFixedV2301s='1';select.addEventListener('pointerdown',ajRememberFontRangeV2301S,true);select.onchange=e=>ajApplyFontV2301S(e.target.value)}
}
const ajRenderBeforeV2301S=render;render=function(){ajRenderBeforeV2301S();ajInstallFontV2301S()}
const ajSelectBeforeV2301S=select;select=function(note){ajSelectBeforeV2301S(note);ajFontRangeV2301S=null;ajInstallFontV2301S()}
const ajOpenBeforeV2301S=openApp;openApp=function(){ajOpenBeforeV2301S();setTimeout(ajInstallFontV2301S,0)}
document.addEventListener('DOMContentLoaded',()=>setTimeout(ajInstallFontV2301S,250));for(const ms of [100,600,1400])setTimeout(ajInstallFontV2301S,ms);

// AIRJOTTER_NOTES_PALETTE_BIND_V2301T
function ajApplyNativePaletteV2301T(input){
 if(!input||!current)return;
 const color=ajColorV2301J(input.value);
 current.color=color;
 document.querySelector('.aj-note-editor')?.style.setProperty('--aj-note-bg',color,'important');
 for(const el of document.querySelectorAll('.aj-note-title,.aj-note-body'))el.style.setProperty('background-color',color,'important');
 ajContrastV2301C(color);
 for(const card of document.querySelectorAll('.aj-note-card[data-id]')){const note=notes.find(n=>n.id===card.dataset.id),cardColor=ajColorV2301J(note?.id===current.id?color:note?.color);card.style.setProperty('--note-color',cardColor,'important');card.style.setProperty('border-left-color',cardColor,'important')}
 ajSaveColorStrictV2301K(color);
}
function ajBindNativePaletteV2301T(){
 const old=document.querySelector('[data-palette-native-input-v2301q]');if(!old||old.dataset.ajBoundV2301t)return;
 const input=old.cloneNode(true);input.dataset.ajBoundV2301t='1';input.disabled=!current;if(current){input.removeAttribute('disabled');input.value=ajColorV2301J(current.color||'#ffffff')}
 old.replaceWith(input);
 input.oninput=()=>ajApplyNativePaletteV2301T(input);
 input.onchange=()=>ajApplyNativePaletteV2301T(input);
 input.onblur=()=>ajApplyNativePaletteV2301T(input);
}
const ajRenderBeforeV2301T=render;render=function(){ajRenderBeforeV2301T();ajBindNativePaletteV2301T()}
const ajSelectBeforeV2301T=select;select=function(note){ajSelectBeforeV2301T(note);ajBindNativePaletteV2301T()}
const ajOpenBeforeV2301T=openApp;openApp=function(){ajOpenBeforeV2301T();setTimeout(ajBindNativePaletteV2301T,0)}
document.addEventListener('DOMContentLoaded',()=>setTimeout(ajBindNativePaletteV2301T,300));for(const ms of [120,700,1500])setTimeout(ajBindNativePaletteV2301T,ms);

// AIRJOTTER_NOTES_PALETTE_DELEGATED_V2301V
let ajPaletteActiveInputV2301V=null,ajPaletteTimerV2301V=0;
function ajPaletteTargetV2301V(target){return target?.matches?.('[data-palette-native-input-v2301q]')?target:null}
function ajApplyDelegatedPaletteV2301V(input){
 if(!input||!current)return;const color=ajColorV2301J(input.value);
 current.color=color;
 document.querySelector('.aj-note-editor')?.style.setProperty('--aj-note-bg',color,'important');
 for(const el of document.querySelectorAll('.aj-note-title,.aj-note-body'))el.style.setProperty('background-color',color,'important');
 ajContrastV2301C(color);
 for(const card of document.querySelectorAll('.aj-note-card[data-id]')){const n=notes.find(x=>x.id===card.dataset.id),c=ajColorV2301J(n?.id===current.id?color:n?.color);card.style.setProperty('--note-color',c,'important');card.style.setProperty('border-left-color',c,'important')}
 ajSaveColorStrictV2301K(color);
}
for(const type of ['input','change','blur'])document.addEventListener(type,e=>{const input=ajPaletteTargetV2301V(e.target);if(input)ajApplyDelegatedPaletteV2301V(input)},true);
document.addEventListener('pointerdown',e=>{const input=ajPaletteTargetV2301V(e.target);if(!input)return;ajPaletteActiveInputV2301V=input;let previous=input.value;clearInterval(ajPaletteTimerV2301V);ajPaletteTimerV2301V=setInterval(()=>{if(!ajPaletteActiveInputV2301V||!document.body.contains(ajPaletteActiveInputV2301V)){clearInterval(ajPaletteTimerV2301V);return}if(ajPaletteActiveInputV2301V.value!==previous){previous=ajPaletteActiveInputV2301V.value;ajApplyDelegatedPaletteV2301V(ajPaletteActiveInputV2301V)}},80)},true);
window.addEventListener('focus',()=>setTimeout(()=>{if(ajPaletteActiveInputV2301V)ajApplyDelegatedPaletteV2301V(ajPaletteActiveInputV2301V);clearInterval(ajPaletteTimerV2301V);ajPaletteActiveInputV2301V=null},80));

// AIRJOTTER_NOTES_RESPONSIVE_V2301X
function ajResponsiveStateV2301X(){const shell=document.querySelector('.aj-notes-shell');if(!shell)return;const mobile=matchMedia('(max-width: 767px)').matches,portraitTablet=matchMedia('(min-width: 768px) and (max-width: 1024px) and (orientation: portrait)').matches;shell.classList.toggle('aj-phone-v2301x',mobile);shell.classList.toggle('aj-tablet-portrait-v2301x',portraitTablet);document.documentElement.classList.toggle('aj-notes-open-v2301x',shell.classList.contains('open'))}
const ajOpenBeforeV2301X=openApp;openApp=function(){ajOpenBeforeV2301X();document.documentElement.classList.add('aj-notes-open-v2301x');ajResponsiveStateV2301X()}
const ajCloseBeforeV2301X=closeApp;closeApp=function(){ajCloseBeforeV2301X();document.documentElement.classList.remove('aj-notes-open-v2301x')}
addEventListener('resize',ajResponsiveStateV2301X,{passive:true});addEventListener('orientationchange',()=>setTimeout(ajResponsiveStateV2301X,120));
document.addEventListener('DOMContentLoaded',()=>setTimeout(ajResponsiveStateV2301X,200));

// AIRJOTTER_NOTES_RESPONSIVE_REWRITE_V2301Y
function ajDeviceModeV2301Y(){if(matchMedia('(max-width: 767px)').matches)return'phone';if(matchMedia('(min-width:768px) and (max-width:1100px) and (orientation:portrait)').matches)return'tablet-portrait';if(matchMedia('(min-width:768px) and (max-width:1180px) and (orientation:landscape)').matches)return'tablet-landscape';return'desktop'}
function ajSetViewV2301Y(view){const shell=document.querySelector('.aj-notes-shell');if(!shell)return;shell.dataset.ajDevice=ajDeviceModeV2301Y();shell.dataset.ajView=view;document.documentElement.classList.toggle('aj-notes-modal-v2301y',shell.classList.contains('open'))}
function ajRemovePaletteV2301Y(){document.querySelectorAll('[data-palette-trigger-v2301n],.aj-palette-native-v2301q,.aj-palette-final-v2301o,.aj-native-palette-wrap-v2301p').forEach(x=>x.remove());const picker=document.querySelector('[data-color]');if(picker){picker.classList.add('aj-color-storage-only-v2301y');picker.tabIndex=-1;picker.setAttribute('aria-hidden','true')}}
function ajAddDarkColorsV2301Y(){const palette=document.querySelector('.aj-standard-colors-v2301d');if(!palette)return;for(const [name,color] of [['Blu scuro','#163a70'],['Verde scuro','#1f5d3a']]){if(palette.querySelector('[data-aj-color-v2301d="'+color+'"]'))continue;const b=document.createElement('button');b.type='button';b.title=name;b.setAttribute('aria-label',name);b.dataset.ajColorV2301d=color;b.style.setProperty('--ajc',color);b.addEventListener('click',e=>{e.preventDefault();if(typeof ajSaveColorStrictV2301K==='function')ajSaveColorStrictV2301K(color);else if(typeof ajSetColorV2301C==='function')ajSetColorV2301C(color)});palette.appendChild(b)}}
function ajResponsiveUiV2301Y(){const shell=document.querySelector('.aj-notes-shell');if(!shell)return;const mode=ajDeviceModeV2301Y();shell.dataset.ajDevice=mode;if(!shell.dataset.ajView)shell.dataset.ajView='list';ajRemovePaletteV2301Y();ajAddDarkColorsV2301Y();document.querySelector('.aj-notes-trashbar')?.setAttribute('hidden','');document.querySelector('.aj-notes-search kbd')?.remove();const back=document.querySelector('.aj-note-back');if(back){back.hidden=false;back.setAttribute('aria-label','Torna alle Note');back.title='Torna alle Note'}}
const ajOpenBeforeV2301Y=openApp;openApp=function(){ajOpenBeforeV2301Y();ajSetViewV2301Y('list');ajResponsiveUiV2301Y()}
const ajCloseBeforeV2301Y=closeApp;closeApp=function(){ajCloseBeforeV2301Y();document.documentElement.classList.remove('aj-notes-modal-v2301y')}
const ajSelectBeforeV2301Y=select;select=function(note){ajSelectBeforeV2301Y(note);if(ajDeviceModeV2301Y()!=='desktop'&&ajDeviceModeV2301Y()!=='tablet-landscape')ajSetViewV2301Y('editor');ajResponsiveUiV2301Y()}
const ajNewBeforeV2301Y=newNote;newNote=function(){ajNewBeforeV2301Y();if(ajDeviceModeV2301Y()!=='desktop'&&ajDeviceModeV2301Y()!=='tablet-landscape')ajSetViewV2301Y('editor')}
const ajRenderBeforeV2301Y=render;render=function(){ajRenderBeforeV2301Y();ajResponsiveUiV2301Y()}
document.addEventListener('click',e=>{if(e.target.closest('.aj-note-back'))setTimeout(()=>ajSetViewV2301Y('list'),0);if(e.target.closest('[data-trash-back-v2301d]'))setTimeout(()=>ajSetViewV2301Y('list'),0)},true);
addEventListener('resize',()=>{const shell=document.querySelector('.aj-notes-shell');if(shell){shell.dataset.ajDevice=ajDeviceModeV2301Y();ajResponsiveUiV2301Y()}},{passive:true});addEventListener('orientationchange',()=>setTimeout(ajResponsiveUiV2301Y,150));
document.addEventListener('DOMContentLoaded',()=>setTimeout(ajResponsiveUiV2301Y,250));for(const ms of [120,700,1500])setTimeout(ajResponsiveUiV2301Y,ms);

// AIRJOTTER_NOTES_MOBILE_COMPACT_V2301Z
let ajSelectedSnapshotV2301Z=null;
function ajContentStateV2301Z(note=current){return{title:String(note?.title||''),body:String(note?.body_html||'')}}
function ajEditorStateV2301Z(){return{title:String(document.querySelector('.aj-note-title')?.value||'').trim(),body:sanitize(document.querySelector('.aj-note-body')?.innerHTML||'')}}
function ajContentChangedV2301Z(){if(!current||!ajSelectedSnapshotV2301Z||ajSelectedSnapshotV2301Z.id!==current.id)return false;const now=ajEditorStateV2301Z();return now.title!==ajSelectedSnapshotV2301Z.title||now.body!==ajSelectedSnapshotV2301Z.body}
async function ajLeaveEditorV2301Z(){if(current&&ajContentChangedV2301Z())await localSave(false);else clearTimeout(saveTimer);closeEditor();ajSetViewV2301Y('list');render()}
const ajSelectBeforeV2301Z=select;select=function(note){const preservedUpdated=note?.updated_at,preservedRevision=note?.server_revision;ajSelectBeforeV2301Z(note);if(note){note.updated_at=preservedUpdated;note.server_revision=preservedRevision;ajSelectedSnapshotV2301Z={id:note.id,...ajContentStateV2301Z(note)};const idx=notes.findIndex(n=>n.id===note.id);if(idx>=0)notes[idx]={...notes[idx],updated_at:preservedUpdated,server_revision:preservedRevision};put(STORE,{...note,updated_at:preservedUpdated,server_revision:preservedRevision})}}
function ajInstallBackV2301Z(){const back=document.querySelector('.aj-note-back');if(!back||back.dataset.ajBackV2301z)return;const clean=back.cloneNode(true);clean.dataset.ajBackV2301z='1';clean.textContent='←';clean.title='Torna alle Note';clean.setAttribute('aria-label','Torna alle Note');back.replaceWith(clean);clean.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();ajLeaveEditorV2301Z()})}
const ajRenderBeforeV2301Z=render;render=function(){ajRenderBeforeV2301Z();ajInstallBackV2301Z()}
document.addEventListener('DOMContentLoaded',()=>setTimeout(ajInstallBackV2301Z,250));for(const ms of [120,700,1500])setTimeout(ajInstallBackV2301Z,ms);

// AIRJOTTER_NOTES_MAIN_BUTTON_V2302D
function ajPlaceMainNoteButtonV2302D(){
 const button=document.getElementById('ajNotesBtnV2301'),archive=document.querySelector('.aj-user-archive-v2266d'),trash=document.getElementById('clearBtn');if(!button||!archive)return;
 button.classList.add('aj-notes-mainbtn-v2302d');button.title='Apri Note';button.setAttribute('aria-label','Apri Note');button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h10l3 3v15H6z"/><path d="M16 3v4h4M9 11h7M9 15h7"/></svg><span>Note</span>';
 const archiveGroup=archive.closest('.tools-group')||archive.parentElement,trashGroup=trash?.closest('.tools-group')||trash?.parentElement;
 if(archiveGroup&&trashGroup&&archiveGroup===trashGroup){if(button.parentElement!==archiveGroup||button.previousElementSibling!==archive)archive.insertAdjacentElement('afterend',button)}
 else if(archiveGroup){if(trashGroup&&trashGroup.parentElement===archiveGroup.parentElement){if(button.parentElement!==archiveGroup.parentElement||button.previousElementSibling!==archiveGroup)archiveGroup.insertAdjacentElement('afterend',button)}else archive.insertAdjacentElement('afterend',button)}
}
const ajMainButtonObserverV2302D=new MutationObserver(()=>ajPlaceMainNoteButtonV2302D());ajMainButtonObserverV2302D.observe(document.body,{childList:true,subtree:true});
document.addEventListener('DOMContentLoaded',()=>setTimeout(ajPlaceMainNoteButtonV2302D,200));for(const ms of [100,500,1200])setTimeout(ajPlaceMainNoteButtonV2302D,ms);
})();

// AIRJOTTER_NOTES_TIMESTAMP_ROOT_V2301L
// Percorsi legacy colore neutralizzati: nessun cambio colore puo chiamare schedule/localSave o impostare updated_at.

// AIRJOTTER_NOTES_HEADER_PREVIEW_V2301M
// Le interruzioni di riga e i blocchi HTML diventano spazi leggibili nell anteprima.
