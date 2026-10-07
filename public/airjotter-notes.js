// AIRJOTTER_NOTES_V2301A
(()=>{'use strict';
const DB='airjotter-notes-v1',STORE='notes',QUEUE='queue';let db,notes=[],current=null,saveTimer,sort='updated_at',dir='desc',trash=false,lastRange=null,noteContentDirty=false,noteEditorHydrating=false;
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function openDB(){return new Promise((ok,no)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:'id'});if(!d.objectStoreNames.contains(QUEUE))d.createObjectStore(QUEUE,{keyPath:'id'})};r.onsuccess=()=>{db=r.result;ok(db)};r.onerror=()=>no(r.error)})}
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}function all(store){return new Promise((ok,no)=>{const r=tx(store).getAll();r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)})}function put(store,v){return new Promise((ok,no)=>{const r=tx(store,'readwrite').put(v);r.onsuccess=()=>ok(v);r.onerror=()=>no(r.error)})}function del(store,id){return new Promise((ok,no)=>{const r=tx(store,'readwrite').delete(id);r.onsuccess=()=>ok();r.onerror=()=>no(r.error)})}
function api(url,opt={}){return fetch(url,{credentials:'include',headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt}).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok){const e=Error(j.error||'Operazione non riuscita');e.status=r.status;throw e}return j})}
function toast(t){const e=$('.aj-notes-toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2400)}
function shell(){const d=document.createElement('div');d.innerHTML=`<div class="aj-notes-shell" aria-hidden="true"><aside class="aj-notes-sidebar"><div class="aj-notes-brand"><img src="/airjotter_logo.png" alt="AirJotter"><b>Note</b><button class="aj-notes-close" title="Chiudi">✕</button></div><div class="aj-notes-trashbar"><b>Cestino</b><button data-empty-trash class="aj-note-btn danger">Svuota</button><button data-leave-trash class="aj-note-btn">Indietro</button></div><div class="aj-notes-search"><input type="search" placeholder="Cerca nelle note" aria-label="Cerca nelle note"><kbd>Ctrl K</kbd></div><div class="aj-notes-controls"><select aria-label="Ordina"><option value="updated_at">Ultima modifica</option><option value="created_at">Data creazione</option><option value="title">Titolo</option></select><button data-direction title="Cambia ordine">↓</button><button data-new class="aj-note-btn primary">+ Nota</button><button type="button" data-mobile-trash-v2304u class="aj-note-btn aj-mobile-trash-v2304u">🗑 Cestino</button></div><div class="aj-notes-count"></div><div class="aj-notes-list"></div><button data-trash-view class="aj-note-btn" style="margin:8px 16px 16px">🗑 Cestino</button></aside><main class="aj-notes-main"><div class="aj-note-empty"><h2>Le tue Note</h2><p>Seleziona una nota oppure creane una nuova.</p></div><section class="aj-note-editor"><div class="aj-note-top"><button class="aj-note-back aj-note-iconbtn" type="button" aria-label="Torna all’elenco" title="Torna all’elenco"><svg class="aj-back-icon-v2304w" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14.7 5.3a1 1 0 0 1 0 1.4L10.4 11H20a1 1 0 1 1 0 2h-9.6l4.3 4.3a1 1 0 0 1-1.4 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.4 0Z"/></svg></button><button data-pin class="aj-note-btn">📌 Fissa</button><input data-color class="aj-note-color" type="color" value="#8fa9e0" title="Colore nota"><button data-share class="aj-note-btn">Condividi</button><button data-pdf class="aj-note-btn">PDF</button><button data-jotter class="aj-note-btn">In Jotter</button><button data-restore class="aj-note-btn" hidden>Ripristina</button><button data-delete class="aj-note-btn danger">Cestino</button><button data-save class="aj-note-btn primary">Salva</button><span class="aj-note-sync">Salvata</span></div><input class="aj-note-title" maxlength="180" placeholder="Titolo della nota"><div class="aj-note-toolbar"><button data-cmd="bold"><b>Grassetto</b></button><button data-cmd="insertUnorderedList">Elenco</button><label>🖼 Immagine<input data-image type="file" accept="image/*" multiple></label><label>📷 Foto<input data-photo type="file" accept="image/*" capture="environment"></label><label>📎 Allegato<input data-file type="file" multiple></label></div><div class="aj-note-body" contenteditable="true"></div><div class="aj-note-attachments"><h4>Allegati</h4><div class="aj-note-files"></div></div></section></main></div><div class="aj-notes-toast"></div><div class="aj-note-lightbox"><img alt="Immagine ingrandita"></div><div class="aj-note-sharebox"><div class="aj-note-dialog"><h3>Esporta la nota in un Jotter</h3><p>Scegli un Jotter esistente oppure creane uno nuovo.</p><select data-boards></select><div class="aj-note-dialog-actions"><button data-dialog-close class="aj-note-btn">Annulla</button><button data-new-board class="aj-note-btn">Nuovo Jotter</button><button data-existing-board class="aj-note-btn primary">Aggiungi al Jotter</button></div></div></div>`;document.body.append(...d.children)}
// AIRJOTTER_NOTES_MAIN_POSITION_V2304F
// AIRJOTTER_NOTES_LIMITS_LOADING_V2304S
function ajEnsureLoadingV2304S(){if(!document.getElementById('ajNotesLoadingStyleV2304S')){const st=document.createElement('style');st.id='ajNotesLoadingStyleV2304S';st.textContent='.aj-note-loading-v2304q{position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;background:rgba(17,25,39,.28)}.aj-note-loading-v2304q.show{display:flex}.aj-note-loading-v2304q>div{background:#fff;color:#17365f;border-radius:12px;padding:13px 18px;font:700 15px Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.22)}';document.head.appendChild(st)}if(!document.querySelector('.aj-note-loading-v2304q')){const el=document.createElement('div');el.className='aj-note-loading-v2304q';el.innerHTML='<div>Caricamento in corso...</div>';document.body.appendChild(el)}}
function makeButton(){ajEnsureLoadingV2304S();
 let b=document.getElementById('ajNotesBtnV2301');
 const archive=document.querySelector('.aj-user-archive-v2266d')||document.getElementById('ajUser');
 const clear=document.getElementById('clearBtn');
 if(!archive||!clear||!clear.parentElement)return false;
 if(!b){
  b=document.createElement('button');
  b.id='ajNotesBtnV2301';b.type='button';b.className='aj-notes-btn-v2301';b.title='Apri Note';
  b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5z"/><path d="M16 3v4h4M8 11h8M8 15h8"/></svg><span>Note</span>';
 }
 const row=clear.parentElement;
 row.insertBefore(b,clear);
 b.onclick=openApp;
 b.classList.add('aj-notes-inline-v2304f');
 clear.classList.add('aj-clear-after-notes-v2304f');
 document.querySelectorAll('.aj-owner-hint-v22107,.aj-user-archive-v2266d small').forEach(x=>x.textContent=x.textContent.replace(/Clicca qui per i tuoi Jotter/g,'I miei Jotter'));
 return b.previousElementSibling===archive||archive.contains(b.previousElementSibling)||b.nextElementSibling===clear;
}
// AIRJOTTER_ADMIN_NOTE_LIMITS_V2301B
// AIRJOTTER_NOTES_LIMITS_TIMESTAMP_V2304L_PLAN_LIMITS
let ajNotePlanMap=null;
async function planText(){
 ajNotePlanMap=null;
 try{
  const plans=await api('/api/plans');
  ajNotePlanMap=Object.fromEntries(plans.map(p=>[String(p.name||'').trim(),Number(p.limits?.notes ?? 0)]));
 }catch{return}
 const cards=document.querySelectorAll('#ajPlansModalV220 .aj-plan-card,#ajPublicPlansV220 .aj-plan-card,#ajPublicPlansV220 article');
 cards.forEach(card=>{
  const name=[...card.querySelectorAll('h2,h3,strong')].map(x=>x.textContent.trim()).find(x=>Object.prototype.hasOwnProperty.call(ajNotePlanMap,x));
  if(!name)return;
  const limit=ajNotePlanMap[name];
  let li=card.querySelector('.aj-note-planlimit');
  if(!li){li=document.createElement('li');li.className='aj-note-planlimit';(card.querySelector('.aj-plan-features,ul')||card).appendChild(li)}
  li.textContent=limit+' Note incluse';
 })
}
addEventListener('aj:plan-notes-updated',()=>planText());
function words(){return norm($('.aj-notes-search input').value).split(/\s+/).filter(Boolean)}function match(n){const hay=norm((n.title||'')+' '+strip(n.body_html||''));return words().every(w=>hay.includes(w))}function strip(h){const d=document.createElement('div');d.innerHTML=h;d.querySelectorAll('br,p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre,tr').forEach(el=>{el.before(document.createTextNode(' '));el.after(document.createTextNode(' '))});return String(d.textContent||'').replace(/[\s\u00a0]+/g,' ').trim()}function highlight(v){let h=esc(v);for(const w of $('.aj-notes-search input').value.trim().split(/\s+/).filter(Boolean)){h=h.replace(new RegExp('('+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig'),'<mark>$1</mark>')}return h}
function sorted(){const a=notes.filter(n=>Boolean(n.deleted_at)===trash&&match(n));return a.sort((x,y)=>{if(Boolean(x.pinned)!==Boolean(y.pinned))return x.pinned?-1:1;let A=x[sort]||'',B=y[sort]||'';if(sort==='title'){A=norm(A);B=norm(B)}const z=A<B?-1:A>B?1:0;return dir==='asc'?z:-z})}
function render(){const list=$('.aj-notes-list'),a=sorted();list.innerHTML=a.map(n=>`<article class="aj-note-card ${current?.id===n.id?'active':''}" data-id="${n.id}" style="--note-color:${esc(n.color||'#8fa9e0')}"><h3>${n.pinned?'📌 ':''}${highlight(n.title||'Senza titolo')}</h3><p>${highlight(strip(n.body_html||'').slice(0,180))}</p><footer><span>${new Date(n.updated_at||Date.now()).toLocaleString('it-IT')}</span><span>${n.sync_state==='pending'?'Da sincronizzare':''}</span></footer></article>`).join('')||'<div style="padding:24px;text-align:center;color:#7a7590">Nessuna nota.</div>';$('.aj-notes-count').textContent=`${notes.length} note totali · limite ${Number(window.ajNotesLimit ?? 10)}`;list.querySelectorAll('[data-id]').forEach(x=>x.onclick=()=>select(notes.find(n=>n.id===x.dataset.id)))}
function select(n){if(current&&n&&current.id!==n.id&&noteContentDirty){clearTimeout(saveTimer);collect();const outgoing={...current};noteContentDirty=false;put(STORE,outgoing).then(()=>put(QUEUE,{id:outgoing.id,note:outgoing})).then(()=>sync()).catch(()=>{})}noteEditorHydrating=true;clearTimeout(saveTimer);noteContentDirty=false;current=n;$('.aj-note-empty').style.display='none';$('.aj-note-editor').classList.add('open');$('.aj-notes-main').classList.add('mobile-open');$('.aj-note-title').value=n.title||'';$('.aj-note-body').innerHTML=n.body_html||'';$('[data-color]').value=n.color||'#8fa9e0';$('[data-pin]').textContent=n.pinned?'📌 Fissata':'📌 Fissa';$('[data-restore]').hidden=!trash;$('[data-delete]').textContent=trash?'Elimina definitivamente':'Cestino';attachments();ajApplyNoteColorV2301C(n.color||'#ffffff');render();requestAnimationFrame(()=>requestAnimationFrame(()=>{noteEditorHydrating=false;noteContentDirty=false;clearTimeout(saveTimer);const syncLabel=$('.aj-note-sync');if(syncLabel)syncLabel.textContent='Salvata'}))}
// AIRJOTTER_NOTES_LIMITS_TIMESTAMP_V2304L2_REAL_DIRTY_CHECK
function collect(){
 if(!current)return false;
 const nextTitle=$('.aj-note-title').value.trim();
 const nextBody=sanitize($('.aj-note-body').innerHTML);
 const changed=nextTitle!==String(current.title||'')||nextBody!==String(current.body_html||'');
 current.title=nextTitle;current.body_html=nextBody;
 if(changed){current.updated_at=new Date().toISOString();current.sync_state='pending'}
 return changed;
}function sanitize(h){const d=document.createElement('div');d.innerHTML=h;d.querySelectorAll('script,style,iframe,object,embed,form').forEach(x=>x.remove());d.querySelectorAll('*').forEach(x=>[...x.attributes].forEach(a=>{if(/^on/i.test(a.name)||a.name==='srcdoc')x.removeAttribute(a.name)}));return d.innerHTML}
async function localSave(explicit=false){if(!current)return;const contentChanged=collect();if(!contentChanged&&!noteContentDirty){if(explicit)toast('Nessuna modifica da salvare');return}if(!current.title&&!strip(current.body_html).trim()&&!(current.attachments||[]).length){if(current.is_new){notes=notes.filter(x=>x.id!==current.id);current=null;render()}return}await put(STORE,current);await put(QUEUE,{id:current.id,note:current});noteContentDirty=false;if(explicit)toast('Nota salvata');render();sync()}
async function sync(){if(!navigator.onLine)return;const q=await all(QUEUE);for(const item of q){try{const saved=item.kind==='color'?await api('/api/notes/'+item.id+'/color',{method:'PATCH',body:JSON.stringify({color:item.color})}):await api('/api/notes/'+item.id,{method:'PUT',body:JSON.stringify(item.note)});saved.sync_state='synced';await put(STORE,saved);await del(QUEUE,item.id);notes=notes.map(n=>n.id===saved.id?saved:n);if(current?.id===saved.id)current=saved}catch(e){if(e.status===409||e.status===403){toast(e.message);break}}}render();$('.aj-note-sync').textContent='Sincronizzata'}
async function load(){notes=await all(STORE);if(navigator.onLine){try{const d=await api('/api/notes?fresh='+Date.now(),{headers:{'Cache-Control':'no-store'}});window.ajNotesLimit=Number(d.limit);const serverIds=new Set(d.notes.map(n=>n.id));for(const local of notes)if(local.sync_state!=='pending'&&!serverIds.has(local.id))await del(STORE,local.id);for(const n of d.notes){n.sync_state='synced';await put(STORE,n)}notes=await all(STORE)}catch{}}render();sync()}
function newNote(){const limit=Number(window.ajNotesLimit ?? 10),used=notes.length;if(used>=limit){alert(`Limite Note raggiunto. Il tuo piano consente ${limit} Note complessive. Attualmente hai ${used} Note tra elenco e cestino. Per crearne una nuova devi eliminare definitivamente almeno una Nota dal cestino oppure passare a un piano superiore.`);return}const now=new Date().toISOString(),n={id:crypto.randomUUID(),title:'',body_html:'',color:'#ffffff',pinned:false,attachments:[],created_at:now,updated_at:now,deleted_at:null,is_new:true,sync_state:'pending'};notes.unshift(n);select(n);$('.aj-note-title').focus()}
function insertImage(file,attachment=false){const r=new FileReader();r.onload=()=>{if(attachment){current.attachments=current.attachments||[];current.attachments.push({id:crypto.randomUUID(),name:file.name,type:file.type,size:file.size,data_url:r.result});attachments()}else{const img=document.createElement('img');img.src=r.result;img.alt=file.name||'Immagine';const sel=getSelection();if(lastRange){sel.removeAllRanges();sel.addRange(lastRange)}document.execCommand('insertHTML',false,img.outerHTML)}schedule()};r.readAsDataURL(file)}
function attachments(){$('.aj-note-files').innerHTML=(current?.attachments||[]).map(a=>`<span class="aj-note-file"><button type="button" data-open-file="${a.id}">📎 ${esc(a.name)}</button><button type="button" data-remove-file="${a.id}" aria-label="Rimuovi allegato">×</button></span>`).join('');document.querySelectorAll('[data-open-file]').forEach(b=>b.onclick=()=>ajOpenAttachmentV2301C((current.attachments||[]).find(a=>a.id===b.dataset.openFile)));document.querySelectorAll('[data-remove-file]').forEach(b=>b.onclick=()=>{current.attachments=current.attachments.filter(a=>a.id!==b.dataset.removeFile);attachments();schedule()})}
function schedule(){if(noteEditorHydrating)return;noteContentDirty=true;clearTimeout(saveTimer);$('.aj-note-sync').textContent='Salvataggio…';saveTimer=setTimeout(()=>localSave(false),650)}
// AIRJOTTER_NOTES_MOBILE_TRASH_RESTORE_DELETE_V2304W
function ajMobileNotesV2304U(){return innerWidth<=1180&&((navigator.maxTouchPoints||0)>0||matchMedia('(pointer:coarse)').matches||matchMedia('(hover:none)').matches)}
function ajNotesListViewV2304U(){const shell=$('.aj-notes-shell');if(shell)shell.dataset.mobileView='list';closeEditor()}
function ajSetTrashModeV2304U(on){clearTimeout(saveTimer);current=null;trash=Boolean(on);$('.aj-note-trashbar')?.classList.toggle('open',trash);if(trash)ajResetEditorForTrashV2301E();else ajRestoreEditorEmptyV2301E();ajTrashUiV2301D(trash);ajNotesListViewV2304U();render()}
async function restoreCurrentV2304U(){if(!current)return;const restored=current,button=$('[data-restore]');if(button){button.disabled=true;button.textContent='Ripristino…'}try{clearTimeout(saveTimer);restored.deleted_at=null;restored.updated_at=new Date().toISOString();restored.sync_state='pending';restored.is_new=false;await put(STORE,restored);await put(QUEUE,{id:restored.id,note:{...restored}});notes=notes.map(n=>n.id===restored.id?restored:n);current=null;trash=false;$('.aj-note-trashbar')?.classList.remove('open');ajTrashUiV2301D(false);ajRestoreEditorEmptyV2301E();ajNotesListViewV2304U();render();toast('Nota ripristinata');await sync()}finally{if(button){button.disabled=false;button.textContent='Ripristina'}}}
async function trashCurrent(){if(!current)return;if(trash){if(!confirm('Eliminare definitivamente questa nota? L’operazione è irreversibile.'))return;const id=current.id,button=$('[data-delete]');if(button){button.disabled=true;button.textContent='Eliminazione…'}try{await api('/api/notes/'+id+'?permanent=true',{method:'DELETE'});await del(STORE,id);notes=notes.filter(n=>n.id!==id);current=null;const remaining=notes.filter(n=>Boolean(n.deleted_at));if(ajMobileNotesV2304U()){trash=remaining.length>0;$('.aj-note-trashbar')?.classList.toggle('open',trash);ajTrashUiV2301D(trash);if(!trash)ajRestoreEditorEmptyV2301E();ajNotesListViewV2304U();render();toast('Nota eliminata definitivamente')}else{closeEditor();render()}}finally{if(button){button.disabled=false;button.textContent=trash?'Elimina definitivamente':'Cestino'}}}else{if(!confirm('Spostare questa nota nel cestino? La nota continuerà a essere conteggiata nel limite del piano finché non verrà eliminata definitivamente.'))return;current.deleted_at=new Date().toISOString();schedule();await localSave();current=null;closeEditor();render()}}
function closeEditor(){$('.aj-note-editor').classList.remove('open');$('.aj-note-empty').style.display='block';$('.aj-notes-main').classList.remove('mobile-open')}
function openApp(){let s=$('.aj-notes-shell');if(!s){init();s=$('.aj-notes-shell')}if(!s)return;const overlay=document.querySelector('.aj-note-loading-v2304q');overlay?.classList.add('show');if(matchMedia('(max-width:760px),(min-width:761px) and (max-width:1024px) and (orientation:portrait)').matches)s.dataset.mobileView='list';s.classList.add('open');s.setAttribute('aria-hidden','false');ajEnsureNotesDbV2304A2().then(load).catch(()=>toast('Archivio Note non disponibile')).finally(()=>overlay?.classList.remove('show'))}
function closeApp(){clearTimeout(saveTimer);const title=$('.aj-note-title')?.value.trim()||'',body=sanitize($('.aj-note-body')?.innerHTML||'');if(current&&(title!==String(current.title||'')||body!==String(current.body_html||'')))localSave(false);$('.aj-notes-shell').classList.remove('open');$('.aj-notes-shell').setAttribute('aria-hidden','true')}
async function share(){collect();const text=(current.title+'\n\n'+strip(current.body_html)).trim();if(navigator.share)await navigator.share({title:current.title||'Nota AirJotter',text});else{await navigator.clipboard.writeText(text);toast('Nota copiata negli appunti')}}
function pdf(){collect();const w=open('','_blank');w.document.write(`<title>${esc(current.title||'Nota')}</title><style>body{font:16px Arial;max-width:800px;margin:40px auto;line-height:1.5}img{max-width:100%}</style><h1>${esc(current.title||'Nota')}</h1>${current.body_html}`);w.document.close();w.print()}
async function jotterDialog(){const d=$('.aj-note-sharebox');d.classList.add('open');const boards=await api('/api/my/boards');$('[data-boards]').innerHTML=boards.map(b=>`<option value="${b.id}">${esc(b.title||'Jotter senza titolo')}</option>`).join('')}
async function exportJotter(existing){collect();const body={title:current.title||'Nota AirJotter',text:strip(current.body_html),boardId:existing?$('[data-boards]').value:null};const r=await api('/api/notes/'+current.id+'/jotter',{method:'POST',body:JSON.stringify(body)});$('.aj-note-sharebox').classList.remove('open');toast(existing?'Nota aggiunta al Jotter':'Nuovo Jotter creato');if(r.roomCode&&window.ajJoin){} }
function wire(){$('.aj-notes-close').onclick=closeApp;$('[data-new]').onclick=newNote;$('.aj-notes-search input').oninput=render;$('.aj-notes-search input').onkeydown=e=>{if(e.key==='Enter'){const n=sorted()[0];if(n)select(n)}};$('.aj-notes-controls select').onchange=e=>{sort=e.target.value;render()};$('[data-direction]').onclick=e=>{dir=dir==='desc'?'asc':'desc';e.currentTarget.textContent=dir==='desc'?'↓':'↑';render()};$('[data-save]').onclick=()=>localSave(true);$('[data-pin]').onclick=()=>{current.pinned=!current.pinned;schedule();select(current)};$('[data-color]').oninput=null;$('[data-share]').onclick=share;$('[data-pdf]').onclick=pdf;$('[data-jotter]').onclick=jotterDialog;$('[data-delete]').onclick=trashCurrent;$('[data-restore]').onclick=restoreCurrentV2304U;$('.aj-note-back').onclick=()=>{localSave();closeEditor()};$('.aj-note-title').oninput=schedule;$('.aj-note-body').oninput=schedule;$('.aj-note-body').onkeyup=()=>{const s=getSelection();if(s.rangeCount)lastRange=s.getRangeAt(0)};$('.aj-note-body').onclick=e=>{if(e.target.tagName==='IMG'){$('.aj-note-lightbox img').src=e.target.src;$('.aj-note-lightbox').classList.add('open')}};$('.aj-note-lightbox').onclick=e=>e.currentTarget.classList.remove('open');document.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>document.execCommand(b.dataset.cmd));$('[data-image]').onchange=e=>[...e.target.files].forEach(f=>insertImage(f));$('[data-photo]').onchange=e=>[...e.target.files].forEach(f=>insertImage(f));$('[data-file]').onchange=e=>[...e.target.files].forEach(f=>insertImage(f,true));$('[data-trash-view]').onclick=()=>ajSetTrashModeV2304U(true);$('[data-mobile-trash-v2304u]').onclick=()=>ajSetTrashModeV2304U(true);$('[data-leave-trash]').onclick=()=>{trash=false;$('.aj-note-trashbar').classList.remove('open');render()};$('[data-empty-trash]').onclick=async()=>{if(!confirm('Eliminare definitivamente tutte le note nel cestino?'))return;for(const n of notes.filter(n=>n.deleted_at)){await api('/api/notes/'+n.id+'?permanent=true',{method:'DELETE'}).catch(()=>{});await del(STORE,n.id)}notes=await all(STORE);render()};$('[data-dialog-close]').onclick=()=>$('.aj-note-sharebox').classList.remove('open');$('[data-new-board]').onclick=()=>exportJotter(false);$('[data-existing-board]').onclick=()=>exportJotter(true);document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&$('.aj-notes-shell').classList.contains('open')){e.preventDefault();$('.aj-notes-search input').focus()}});addEventListener('online',sync)}
// AIRJOTTER_NOTES_COMPLETE_CLEAN_V2304A2
let ajNotesInitializedV2304A2=false,ajNotesDbPromiseV2304A2=null;
function ajEnsureNotesDbV2304A2(){if(db)return Promise.resolve(db);if(!ajNotesDbPromiseV2304A2)ajNotesDbPromiseV2304A2=openDB().catch(e=>{ajNotesDbPromiseV2304A2=null;console.error('AIRJOTTER_NOTES_COMPLETE_CLEAN_V2304A2: IndexedDB',e);throw e});return ajNotesDbPromiseV2304A2}
function ajInstallMobileTrashV2304U(){if(document.getElementById('ajNotesMobileTrashV2304U'))return;const style=document.createElement('style');style.id='ajNotesMobileTrashV2304U';style.textContent='.aj-mobile-trash-v2304u{display:none!important}@media (max-width:760px),(min-width:761px) and (max-width:1180px) and (pointer:coarse),(min-width:761px) and (max-width:1180px) and (hover:none){.aj-mobile-trash-v2304u{display:inline-flex!important;align-items:center!important;justify-content:center!important;white-space:nowrap!important}.aj-note-top{position:relative!important;overflow-x:auto!important;overflow-y:hidden!important;-webkit-overflow-scrolling:touch!important}.aj-note-top .aj-note-back{position:sticky!important;left:0!important;z-index:50!important;flex:0 0 46px!important;min-width:46px!important;width:46px!important;height:46px!important;margin:0 8px 0 0!important;background:#0b55b7!important;color:#fff!important;border-color:#084699!important;box-shadow:6px 0 8px rgba(255,255,255,.95)!important}.aj-note-top .aj-note-back{font-size:0!important;line-height:0!important;overflow:hidden!important;border-radius:12px!important;background:linear-gradient(180deg,#176bd8 0%,#0b55b7 58%,#08469a 100%)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.34),inset 0 -2px 0 rgba(0,32,92,.35),6px 0 8px rgba(255,255,255,.95)!important}.aj-note-top .aj-note-back::before,.aj-note-top .aj-note-back::after{content:none!important;display:none!important}.aj-note-top .aj-note-back .aj-back-icon-v2304w{display:block!important;width:28px!important;height:28px!important;min-width:28px!important;fill:#fff!important;stroke:none!important;pointer-events:none!important;filter:drop-shadow(0 1px 1px rgba(0,0,0,.25))}.aj-note-top .aj-note-back+*{position:relative!important;z-index:1!important}}';document.head.appendChild(style)}
document.addEventListener('click',event=>{const button=event.target.closest('[data-trash-view],[data-mobile-trash-v2304u]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();ajSetTrashModeV2304U(true)},true);
function init(){if(ajNotesInitializedV2304A2)return;ajNotesInitializedV2304A2=true;try{ajInstallMobileTrashV2304U();if(!document.querySelector('.aj-notes-shell'))shell();wire();ajEnhanceNotesV2301C();makeButton();planText();ajEnsureNotesDbV2304A2().catch(()=>{})}catch(e){ajNotesInitializedV2304A2=false;console.error('AIRJOTTER_NOTES_COMPLETE_CLEAN_V2304A2: init',e)}}
document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init,{once:true}):init();

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
 const picker=top?.querySelector('[data-color]');if(picker){picker.classList.add('aj-native-palette-v2301d');picker.title=' personalizzata';let p=top.querySelector('.aj-standard-colors-v2301d');if(!p){p=document.createElement('div');p.className='aj-standard-colors-v2301d';p.innerHTML='<span>Colori</span>'+[['Bianco','#ffffff'],['Nero','#1f1f1f'],['Grigio','#d9d9d9'],['Giallo','#fff59d'],['Verde','#c8e6c9'],['Celeste','#b3e5fc'],['Rosso','#ffcdd2'],['Viola','#e1bee7'],['Arancione','#ffe0b2'],['Rosa','#f8bbd0']].map(([n,c])=>'<button type="button" title="'+n+'" aria-label="'+n+'" data-aj-color-v2301d="'+c+'" style="--ajc:'+c+'"></button>').join('');picker.insertAdjacentElement('afterend',p);p.querySelectorAll('[data-aj-color-v2301d]').forEach(b=>b.onclick=()=>{ajSetColorV2301C(b.dataset.ajColorV2301d);requestAnimationFrame(()=>{document.querySelector('.aj-note-editor')?.style.setProperty('--aj-note-bg',b.dataset.ajColorV2301d);document.querySelector('.aj-note-body').style.backgroundColor=b.dataset.ajColorV2301d;document.querySelector('.aj-note-title').style.backgroundColor=b.dataset.ajColorV2301d})})}
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
 const ajLimitV2304S=Number(window.ajNotesLimit ?? 10),ajUsedV2304S=notes.length;if(ajUsedV2304S>=ajLimitV2304S){alert(`Limite Note raggiunto. Il tuo piano consente ${ajLimitV2304S} Note complessive. Attualmente hai ${ajUsedV2304S} Note tra elenco e cestino. Per crearne una nuova devi eliminare definitivamente almeno una Nota dal cestino oppure passare a un piano superiore.`);return}
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
 const safe=ajValidColorV2301I(color),originalUpdated=current.updated_at;
 current.color=safe;current.sync_state='pending';
 const picker=document.querySelector('[data-color]');if(picker)picker.value=safe;
 const editor=document.querySelector('.aj-note-editor');editor?.style.setProperty('--aj-note-bg',safe,'important');
 for(const el of document.querySelectorAll('.aj-note-title,.aj-note-body'))el.style.setProperty('background-color',safe,'important');
 ajContrastV2301C(safe);
 for(const card of document.querySelectorAll('.aj-note-card[data-id]')){const n=notes.find(x=>x.id===card.dataset.id),c=ajValidColorV2301I(n?.id===current.id?safe:n?.color);card.style.setProperty('--note-color',c,'important');card.style.setProperty('border-left-color',c,'important')}
 current.updated_at=originalUpdated;
 await put(STORE,{...current,color:safe,updated_at:originalUpdated});
 await put(QUEUE,{id:current.id,kind:'color',color:safe,updated_at:originalUpdated});
 render();
 requestAnimationFrame(()=>{if(current)current.updated_at=originalUpdated;document.querySelector('.aj-note-editor')?.style.setProperty('--aj-note-bg',safe,'important')});
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


// AIRJOTTER_NOTES_MOBILE_TABLET_V2304B
(()=>{'use strict';
 const compact=()=>matchMedia('(max-width:760px),(min-width:761px) and (max-width:1024px) and (orientation:portrait)').matches;
 const shell=()=>document.querySelector('.aj-notes-shell');
 const setView=view=>{const s=shell();if(!s)return;if(compact())s.dataset.mobileView=view;else delete s.dataset.mobileView};
 document.addEventListener('click',event=>{
  if(event.target.closest('#ajNotesBtnV2301'))setView('list');
  if(event.target.closest('.aj-note-card,[data-new]'))requestAnimationFrame(()=>setView('editor'));
  if(event.target.closest('.aj-note-back'))requestAnimationFrame(()=>setView('list'));
 },true);
 addEventListener('resize',()=>{const s=shell();if(s&&!compact())delete s.dataset.mobileView},{passive:true});
 addEventListener('orientationchange',()=>requestAnimationFrame(()=>{const s=shell();if(s&&!compact())delete s.dataset.mobileView}),{passive:true});
})();

// AIRJOTTER_NOTES_MOBILE_SINGLE_TOOLBAR_V2304E
(()=>{'use strict';
 const compact=()=>matchMedia('(max-width:760px),(min-width:761px) and (max-width:1024px) and (orientation:portrait)').matches;
 function arrange(){
  const toolbar=document.querySelector('.aj-note-toolbar');
  const wordbar=document.querySelector('.aj-wordbar-v2301c');
  if(!toolbar||!wordbar)return;
  if(compact()){
   if(wordbar.parentElement!==toolbar)toolbar.insertBefore(wordbar,toolbar.firstChild);
   toolbar.classList.add('aj-note-toolbar-single-v2304e');
  }else{
   toolbar.classList.remove('aj-note-toolbar-single-v2304e');
  }
 }
 document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(arrange),{once:true}):requestAnimationFrame(arrange);
 document.addEventListener('click',e=>{if(e.target.closest('#ajNotesBtnV2301'))requestAnimationFrame(arrange)},true);
 addEventListener('resize',()=>requestAnimationFrame(arrange),{passive:true});
 addEventListener('orientationchange',()=>requestAnimationFrame(arrange),{passive:true});
})();

// AIRJOTTER_NOTES_MAIN_POSITION_V2304F_BRIDGE
(()=>{'use strict';const place=()=>{const b=document.getElementById('ajNotesBtnV2301'),clear=document.getElementById('clearBtn');if(b&&clear&&clear.parentElement)clear.parentElement.insertBefore(b,clear)};document.readyState==='loading'?document.addEventListener('DOMContentLoaded',place,{once:true}):place();addEventListener('pageshow',place,{once:true})})();

// AIRJOTTER_TOOLBAR_REFINEMENT_V2304G
(()=>{'use strict';
 const refine=()=>{
  document.querySelectorAll('.aj-owner-hint-v22107,.aj-user-archive-v2266d small').forEach(el=>{
   const text=(el.textContent||'').trim();
   if(/Clicca qui per i tuoi Jotter/i.test(text))el.textContent=text.replace(/Clicca qui per i tuoi Jotter/i,'I miei Jotter');
  });
 };
 document.readyState==='loading'?document.addEventListener('DOMContentLoaded',refine,{once:true}):refine();
 addEventListener('pageshow',refine,{once:true});
})();

// AIRJOTTER_TOOLBAR_FORCE_FINAL_V2304I
(()=>{'use strict';
 const blue='#0b55b7',dark='#084aa3';
 function paintButton(button){
  if(!button)return;
  button.style.setProperty('background-color',blue,'important');
  button.style.setProperty('background-image','linear-gradient(180deg,#1267d6 0%,'+dark+' 100%)','important');
  button.style.setProperty('color','#fff','important');
  button.style.setProperty('border-color','#084699','important');
  button.style.setProperty('box-shadow','0 3px 9px rgba(8,67,148,.22),inset 0 1px 0 rgba(255,255,255,.22)','important');
  button.style.setProperty('text-shadow','0 1px 1px rgba(0,0,0,.18)','important');
  button.querySelectorAll('svg,path').forEach(icon=>{icon.style.setProperty('stroke','#fff','important');icon.style.setProperty('color','#fff','important')});
 }
 function apply(){
  paintButton(document.getElementById('ajFileTransferBtnV2291'));
  paintButton(document.getElementById('ajNotesBtnV2301'));
 }
 document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(apply),{once:true}):requestAnimationFrame(apply);
 addEventListener('pageshow',()=>requestAnimationFrame(apply),{once:true});
 setTimeout(apply,350);
})();

// AIRJOTTER_NOTES_UNDER_TRANSFER_V2304K
(()=>{'use strict';
 const place=()=>{
  const note=document.getElementById('ajNotesBtnV2301');
  const transfer=document.getElementById('ajFileTransferBtnV2291');
  const owner=document.getElementById('ajUser');
  if(!note||!transfer||!owner)return;
  const io=transfer.closest('.aj-io-stack-v22107,.aj-import-tools-v2291');
  let row=io?.querySelector('.aj-owner-row-v22107')||owner.closest('.aj-owner-row-v22107');
  if(!row&&io){row=document.createElement('div');row.className='aj-owner-row-v22107';io.appendChild(row);row.appendChild(owner)}
  if(!row)return;
  row.appendChild(note);
  note.classList.add('aj-note-under-transfer-v2304k');
 };
 document.readyState==='loading'?document.addEventListener('DOMContentLoaded',place,{once:true}):place();
 addEventListener('pageshow',place,{once:true});
 setTimeout(place,500);
})();

// AIRJOTTER_NOTES_LIMITS_TIMESTAMP_V2304L
(()=>{'use strict';
 const refreshPlans=()=>planText();
 document.addEventListener('click',event=>{
  if(event.target.closest('[data-open-plans],#ajPlansBtnV220,.aj-plans-flat-v22106,.aj-plan-column-v22107 button'))setTimeout(refreshPlans,0);
 },true);
 const selectBefore=select;
 select=function(note){
  const stamp=note?.updated_at;
  selectBefore(note);
  if(note&&stamp){note.updated_at=stamp;if(current?.id===note.id)current.updated_at=stamp}
 };
})();

// AIRJOTTER_NOTES_LIMITS_TIMESTAMP_V2304L2
(()=>{'use strict';
 let lastPlans=[];
 const fetchLimits=async()=>{
  try{lastPlans=await api('/api/plans')}catch{return []}
  return lastPlans;
 };
 const paintLimits=plans=>{
  const box=document.getElementById('ajPublicPlansV220');if(!box||!box.children.length)return false;
  const map=new Map((plans||lastPlans).map(p=>[String(p.name||'').trim().toLowerCase(),Number(p.limits?.notes ?? 0)]));
  let painted=0;
  box.querySelectorAll('.aj-plan-card,article').forEach(card=>{
   const title=card.querySelector('h2,h3');if(!title)return;
   const key=title.textContent.trim().toLowerCase();if(!map.has(key))return;
   let li=card.querySelector('.aj-note-planlimit');
   if(!li){li=document.createElement('li');li.className='aj-note-planlimit';(card.querySelector('.aj-plan-features,ul')||card).appendChild(li)}
   li.textContent=map.get(key)+' Note incluse';painted++;
  });
  return painted>0;
 };
 const refresh=async()=>{const plans=await fetchLimits();paintLimits(plans)};
 const install=()=>{
  const box=document.getElementById('ajPublicPlansV220');if(!box||box.dataset.ajNotesLimitsV2304l2)return;
  box.dataset.ajNotesLimitsV2304l2='1';
  new MutationObserver(()=>paintLimits(lastPlans)).observe(box,{childList:true});
 };
 document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>{install();refresh()},{once:true}):(install(),refresh());
 document.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(button&&/piani/i.test(button.textContent||'')){install();refresh()}
 },true);
})();

// AIRJOTTER_NOTES_TABLET_ALIGN_V2304M
(()=>{'use strict';
 const tablet=()=>innerWidth>760&&((navigator.maxTouchPoints||0)>0||matchMedia('(pointer:coarse)').matches||matchMedia('(hover:none)').matches);
 const place=()=>{
  if(!tablet())return;
  const note=document.getElementById('ajNotesBtnV2301');
  const owner=document.getElementById('ajUser');
  const archive=document.querySelector('.aj-user-archive-v2266d');
  if(!note||!owner)return;
  const anchor=archive||owner;
  const row=anchor.closest('.aj-owner-row-v22107')||owner.parentElement;
  if(!row)return;
  anchor.insertAdjacentElement('afterend',note);
  note.classList.add('aj-note-tablet-after-jotters-v2304m');
  const rect=owner.getBoundingClientRect();
  const height=Math.max(25,Math.round(rect.height||25));
  note.style.setProperty('--aj-note-tablet-owner-height',height+'px');
 };
 document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>requestAnimationFrame(place),{once:true}):requestAnimationFrame(place);
 addEventListener('pageshow',()=>requestAnimationFrame(place),{once:true});
 addEventListener('resize',()=>requestAnimationFrame(place),{passive:true});
 addEventListener('orientationchange',()=>requestAnimationFrame(place),{passive:true});
 setTimeout(place,550);
})();
// AIRJOTTER_NOTES_MOBILE_FORMATTING_V2304P
(()=>{'use strict';
 let savedRange=null;
 const body=()=>document.querySelector('.aj-note-body');
 const inBody=range=>{const b=body();if(!b||!range)return false;const node=range.commonAncestorContainer;return node===b||b.contains(node.nodeType===1?node:node.parentNode)};
 const remember=()=>{const sel=getSelection();if(sel&&sel.rangeCount){const range=sel.getRangeAt(0);if(inBody(range))savedRange=range.cloneRange()}};
 const restore=()=>{const b=body();if(!b)return null;b.focus({preventScroll:true});const sel=getSelection();if(savedRange&&inBody(savedRange)){sel.removeAllRanges();sel.addRange(savedRange.cloneRange());return sel.getRangeAt(0)}return null};
 const finish=()=>{remember();schedule();requestAnimationFrame(()=>body()?.focus({preventScroll:true}))};
 function wrapSelection(style){const range=restore();if(!range||range.collapsed)return false;const span=document.createElement('span');Object.assign(span.style,style);try{range.surroundContents(span)}catch{const fragment=range.extractContents();span.appendChild(fragment);range.insertNode(span)}const selected=document.createRange();selected.selectNodeContents(span);const sel=getSelection();sel.removeAllRanges();sel.addRange(selected);savedRange=selected.cloneRange();return true}
 function applyFont(value){const family=String(value||'Arial').replace(/[<>"']/g,'');if(!wrapSelection({fontFamily:family})){const b=body();if(!b)return;b.style.fontFamily=family}finish()}
 function applySize(value){const px=Math.max(8,Math.min(72,Number(value)||16));if(!wrapSelection({fontSize:px+'px'})){const b=body();if(!b)return;b.style.fontSize=px+'px'}finish()}
 function applyCommand(command){restore();document.execCommand(command,false,null);finish()}
 function install(){
  const bar=document.querySelector('.aj-wordbar-v2301c'),b=body();if(!bar||!b)return;
  document.querySelectorAll('[data-aj-color-v2301d="#f8bbd0"],[data-note-color="#f8bbd0"]').forEach(pink=>pink.remove());
  if(!b.dataset.ajMobileFormattingV2304o){b.dataset.ajMobileFormattingV2304o='1';for(const type of ['selectionchange'])document.addEventListener(type,remember);for(const type of ['pointerup','touchend','keyup','mouseup'])b.addEventListener(type,remember,{passive:true})}
  if(bar.dataset.ajMobileFormattingV2304o)return;bar.dataset.ajMobileFormattingV2304o='1';
  bar.addEventListener('pointerdown',event=>{if(event.target.closest('button,select,input'))remember()},{capture:true,passive:true});
  bar.addEventListener('touchstart',event=>{if(event.target.closest('button,select,input'))remember()},{capture:true,passive:true});
  const font=bar.querySelector('[data-font]');if(font){font.onchange=event=>applyFont(event.target.value)}
  const size=bar.querySelector('[data-font-size]');if(size){size.onchange=()=>applySize(size.value);size.oninput=()=>{}}
  const minus=bar.querySelector('[data-size-minus]');if(minus)minus.onclick=event=>{event.preventDefault();size.value=Math.max(8,(Number(size.value)||16)-1);applySize(size.value)};
  const plus=bar.querySelector('[data-size-plus]');if(plus)plus.onclick=event=>{event.preventDefault();size.value=Math.min(72,(Number(size.value)||16)+1);applySize(size.value)};
  bar.querySelectorAll('[data-word]').forEach(button=>button.onclick=event=>{event.preventDefault();applyCommand(button.dataset.word)});
 }
 const previousSelect=select;select=function(note){savedRange=null;previousSelect(note);requestAnimationFrame(install)};
 const previousOpen=openApp;openApp=function(){previousOpen();requestAnimationFrame(install)};
 document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>setTimeout(install,0),{once:true}):setTimeout(install,0);
 document.addEventListener('click',event=>{if(event.target.closest('#ajNotesBtnV2301,.aj-note-card,[data-new]'))requestAnimationFrame(install)},true);
 addEventListener('resize',()=>requestAnimationFrame(install),{passive:true});
})();
// AIRJOTTER_NOTES_MOBILE_LOADING_COMPACT_SELECTION_V2304Q
(()=>{'use strict';
 const compact=()=>matchMedia('(max-width:760px),(min-width:761px) and (max-width:1024px) and (orientation:portrait)').matches;
 function installStyle(){if(document.getElementById('ajNotesV2304QStyle'))return;const style=document.createElement('style');style.id='ajNotesV2304QStyle';style.textContent=`
 .aj-note-loading-v2304q{position:fixed;inset:0;z-index:2147483646;display:none;align-items:center;justify-content:center;background:rgba(17,25,39,.28);backdrop-filter:blur(2px)}
 .aj-note-loading-v2304q.show{display:flex}.aj-note-loading-v2304q>div{background:#fff;color:#17365f;border:1px solid #d4deed;border-radius:12px;padding:13px 18px;font:700 15px Arial,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.22)}
 @media (max-width:760px),(min-width:761px) and (max-width:1024px) and (orientation:portrait){
  .aj-note-toolbar.aj-note-toolbar-single-v2304e{box-sizing:border-box!important;display:flex!important;flex-wrap:nowrap!important;align-items:center!important;gap:5px!important;overflow-x:auto!important;overflow-y:hidden!important;height:var(--aj-note-mobile-toolbar-height-v2304q,46px)!important;min-height:var(--aj-note-mobile-toolbar-height-v2304q,46px)!important;max-height:var(--aj-note-mobile-toolbar-height-v2304q,46px)!important;padding:4px 7px!important;background:#fff!important;scrollbar-width:thin;-webkit-overflow-scrolling:touch}
  .aj-note-toolbar.aj-note-toolbar-single-v2304e .aj-wordbar-v2301c{display:contents!important}
  .aj-note-toolbar.aj-note-toolbar-single-v2304e .aj-wordbar-v2301c>label{display:flex!important;flex:0 0 auto!important;align-items:center!important;margin:0!important;gap:3px!important}
  .aj-note-toolbar.aj-note-toolbar-single-v2304e .aj-wordbar-v2301c>label>span{display:none!important}
  .aj-note-toolbar.aj-note-toolbar-single-v2304e .aj-wordbar-v2301c>label>div{display:flex!important;align-items:center!important;gap:3px!important;white-space:nowrap!important}
  .aj-note-toolbar.aj-note-toolbar-single-v2304e select,.aj-note-toolbar.aj-note-toolbar-single-v2304e input,.aj-note-toolbar.aj-note-toolbar-single-v2304e button,.aj-note-toolbar.aj-note-toolbar-single-v2304e label{box-sizing:border-box!important;height:34px!important;min-height:34px!important;margin:0!important}
  .aj-note-toolbar.aj-note-toolbar-single-v2304e select{width:98px!important;min-width:98px!important;padding:0 5px!important}
  .aj-note-toolbar.aj-note-toolbar-single-v2304e input[data-font-size]{width:45px!important;min-width:45px!important;padding:0 3px!important;text-align:center!important}
  .aj-note-toolbar.aj-note-toolbar-single-v2304e button{min-width:34px!important;padding:0 7px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;white-space:nowrap!important}
  .aj-note-toolbar.aj-note-toolbar-single-v2304e>label{flex:0 0 auto!important;padding:0 9px!important;display:inline-flex!important;align-items:center!important;white-space:nowrap!important}
  .aj-note-body,.aj-note-body *{-webkit-user-select:text!important;user-select:text!important;-webkit-touch-callout:default!important}
  .aj-note-body{touch-action:pan-y!important;cursor:text!important}
 }
 `;document.head.appendChild(style)}
 function loader(){let el=document.querySelector('.aj-note-loading-v2304q');if(!el){el=document.createElement('div');el.className='aj-note-loading-v2304q';el.setAttribute('role','status');el.setAttribute('aria-live','polite');el.innerHTML='<div>Caricamento in corso...</div>';document.body.appendChild(el)}return el}
 function showLoading(){installStyle();loader().classList.add('show')}
 function hideLoading(){loader().classList.remove('show')}
 function compactToolbar(){installStyle();const toolbar=document.querySelector('.aj-note-toolbar'),top=document.querySelector('.aj-note-top');if(!toolbar)return;if(compact()){toolbar.classList.add('aj-note-toolbar-single-v2304e');const h=Math.max(42,Math.round(top?.getBoundingClientRect().height||46));toolbar.style.setProperty('--aj-note-mobile-toolbar-height-v2304q',h+'px')}else toolbar.style.removeProperty('--aj-note-mobile-toolbar-height-v2304q')}
 function textPoint(x,y){if(document.caretRangeFromPoint)return document.caretRangeFromPoint(x,y);const p=document.caretPositionFromPoint?.(x,y);if(!p)return null;const r=document.createRange();r.setStart(p.offsetNode,p.offset);r.collapse(true);return r}
 function wordRange(x,y){const editor=document.querySelector('.aj-note-body'),point=textPoint(x,y);if(!editor||!point)return null;let node=point.startContainer,offset=point.startOffset;if(node.nodeType!==3){const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);node=walker.firstChild();offset=0}if(!node||node.nodeType!==3||!editor.contains(node))return null;const text=node.nodeValue||'';if(!text)return null;offset=Math.min(offset,Math.max(0,text.length-1));if(/\s/.test(text[offset]||'')){if(offset>0&&!/\s/.test(text[offset-1]))offset--;else return null}let start=offset,end=offset+1;while(start>0&&!/\s/.test(text[start-1]))start--;while(end<text.length&&!/\s/.test(text[end]))end++;const range=document.createRange();range.setStart(node,start);range.setEnd(node,end);return range}
 function installSelection(){const editor=document.querySelector('.aj-note-body');if(!editor||editor.dataset.ajWordSelectionV2304q)return;editor.dataset.ajWordSelectionV2304q='1';let timer=0,startX=0,startY=0,lastX=0,lastY=0;
  editor.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch'&&e.pointerType!=='pen')return;startX=lastX=e.clientX;startY=lastY=e.clientY;clearTimeout(timer);timer=setTimeout(()=>{if(Math.hypot(lastX-startX,lastY-startY)>10)return;const range=wordRange(lastX,lastY);if(!range)return;const sel=getSelection();sel.removeAllRanges();sel.addRange(range);savedRange=range.cloneRange();ajFontRangeV2301S=range.cloneRange()},560)},{passive:true});
  editor.addEventListener('pointermove',e=>{lastX=e.clientX;lastY=e.clientY;if(Math.hypot(lastX-startX,lastY-startY)>10){clearTimeout(timer);timer=0}},{passive:true});
  for(const type of ['pointerup','pointercancel','pointerleave'])editor.addEventListener(type,()=>{clearTimeout(timer);timer=0},{passive:true});
 }
 function installQ(){compactToolbar();installSelection()}
 const loadBeforeV2304Q=load;load=async function(){try{return await loadBeforeV2304Q()}finally{hideLoading();requestAnimationFrame(installQ)}};
 const openBeforeV2304Q=openApp;openApp=function(){showLoading();openBeforeV2304Q();requestAnimationFrame(installQ)};
 const selectBeforeV2304Q=select;select=function(note){selectBeforeV2304Q(note);requestAnimationFrame(installQ)};
 document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>setTimeout(installQ,0),{once:true}):setTimeout(installQ,0);
 addEventListener('resize',()=>requestAnimationFrame(installQ),{passive:true});
 addEventListener('orientationchange',()=>requestAnimationFrame(installQ),{passive:true});
})();

// AIRJOTTER_NOTES_PIN_LOADING_V2304R
(()=>{'use strict';
 let loadingDepth=0,loadingFailsafe=0;
 function loadingBox(){let el=document.querySelector('.aj-note-loading-v2304q');if(!el){el=document.createElement('div');el.className='aj-note-loading-v2304q';el.setAttribute('role','status');el.setAttribute('aria-live','polite');el.innerHTML='<div>Caricamento in corso...</div>';document.body.appendChild(el)}return el}
 function startLoading(){installStyle();loadingDepth++;loadingBox().classList.add('show');clearTimeout(loadingFailsafe);loadingFailsafe=setTimeout(stopLoading,12000)}
 function stopLoading(){loadingDepth=0;clearTimeout(loadingFailsafe);loadingBox().classList.remove('show')}
 async function savePinState(){
  if(!current)return;
  clearTimeout(saveTimer);
  const originalUpdated=current.updated_at;
  current.pinned=!current.pinned;
  current.updated_at=new Date().toISOString();
  current.sync_state='pending';
  const snapshot={...current};
  const pin=document.querySelector('[data-pin]');if(pin)pin.textContent=current.pinned?'📌 Fissata':'📌 Fissa';
  await put(STORE,snapshot);
  await put(QUEUE,{id:snapshot.id,note:snapshot});
  notes=notes.map(note=>note.id===snapshot.id?snapshot:note);
  current=snapshot;
  render();
  try{await sync()}catch{current.updated_at=current.updated_at||originalUpdated}
 }
 function installPin(){const pin=document.querySelector('[data-pin]');if(!pin||pin.dataset.ajPinV2304r)return;pin.dataset.ajPinV2304r='1';pin.onclick=event=>{event.preventDefault();event.stopPropagation();savePinState()}}
 const loadBeforeV2304R=load;load=async function(){try{return await loadBeforeV2304R()}finally{stopLoading();requestAnimationFrame(installPin)}};
 const selectBeforeV2304R=select;select=function(note){selectBeforeV2304R(note);requestAnimationFrame(installPin)};
 document.addEventListener('pointerdown',event=>{if(event.target.closest('#ajNotesBtnV2301'))startLoading()},{capture:true,passive:true});
 document.addEventListener('click',event=>{if(event.target.closest('#ajNotesBtnV2301')){startLoading();requestAnimationFrame(installPin)}},true);
 document.readyState==='loading'?document.addEventListener('DOMContentLoaded',()=>setTimeout(installPin,0),{once:true}):setTimeout(installPin,0);
})();


})();

// AIRJOTTER_NOTES_BACK_ICON_V2304W
// AIRJOTTER_NOTES_MOBILE_SELECTION_TIMESTAMP_V2304N_REVISED
// Durante l idratazione mobile gli eventi input sintetici sono ignorati; selezione e colore non accodano PUT completi.
// AIRJOTTER_NOTES_TIMESTAMP_ROOT_V2301L
// Percorsi legacy colore neutralizzati: nessun cambio colore puo chiamare schedule/localSave o impostare updated_at.

// AIRJOTTER_NOTES_HEADER_PREVIEW_V2301M
// Le interruzioni di riga e i blocchi HTML diventano spazi leggibili nell anteprima.
