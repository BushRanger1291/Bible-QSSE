'use strict';
const $=selector=>document.querySelector(selector);
const ui={grid:$('#grid'),tree:$('#tree'),crumb:$('#crumb'),search:$('#search'),quickFilter:$('#quickFilter'),status:$('#status'),notice:$('#notice'),up:$('#up'),newFolder:$('#newFolder'),addFiles:$('#addFiles'),files:$('#files')};
let root=null,pendingRoot=null,trail=[],generation=0;
let library=null,editingTag=null,editingNote=null,documentMeta=new Map();
let textIndex=new Map(),indexController=null;
let scope='all';
const noteTagFilters=new Set();
let documentCountCache=new WeakMap();
const categoryStyles=[
  [/^01\s*-\s*Sécurité/i,'Sécurité','#f28c28'],[/^02\s*-\s*Incendie/i,'Incendie','#e5484d'],[/^03\s*-\s*Santé/i,'Santé','#42b883'],[/^04\s*-\s*Sûreté/i,'Sûreté','#3b82f6'],
  [/^05\s*-\s*Qualité/i,'Qualité','#a855f7'],[/^06\s*-\s*Environnement/i,'Environnement','#b7791f'],[/^07\s*-\s*Directives de travail/i,'Directives de travail','#eab308'],[/^08\s*-\s*Bases légales/i,'Bases légales','#cbd5e1']
];
const categoryOf=name=>{const found=categoryStyles.find(([pattern])=>pattern.test(name||''));return found?{label:found[1],color:found[2]}:{label:'Autre',color:'#637390'}};
const itemCategory=(item,path)=>categoryOf(path[0]?.name||(item.handle.kind==='directory'?item.name:''));
const indexStatus=$('#indexStatus');
const folded=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').replace(/\s+/g,' ').trim();
const tagFilter=$('#tagFilter');
const dataToolbar=$('#indexPdfs').closest('.toolbar'),backupButton=document.createElement('button'),restoreButton=document.createElement('button'),restoreFile=document.createElement('input');backupButton.type=restoreButton.type='button';backupButton.id='backupData';restoreButton.id='restoreData';backupButton.textContent='Sauvegarder les données';restoreButton.textContent='Restaurer les données';restoreFile.id='restoreFile';restoreFile.type='file';restoreFile.accept='application/json,.json';restoreFile.hidden=true;dataToolbar.append(backupButton,restoreButton,restoreFile);
let view='grid',sortBy='title',sortDirection='asc';
try{view=localStorage.getItem('bible-qsse-view')==='list'?'list':'grid';sortBy=localStorage.getItem('bible-qsse-sort')||'title';sortDirection=localStorage.getItem('bible-qsse-sort-direction')==='desc'?'desc':'asc'}catch{}
$('#sortBy').value=sortBy;$('#sortDirection').textContent=sortDirection==='asc'?'↑':'↓';
function setView(value){view=value;ui.grid.classList.toggle('list',view==='list');$('#gridView').setAttribute('aria-pressed',String(view==='grid'));$('#listView').setAttribute('aria-pressed',String(view==='list'));try{localStorage.setItem('bible-qsse-view',view)}catch{}rerenderPreservingScroll()}
$('#gridView').onclick=()=>setView('grid');$('#listView').onclick=()=>setView('list');
tagFilter.onchange=()=>rerenderPreservingScroll();
function tagsFor(item,path){return library?.tags.get(BibleTags.key(path,item.name))||[]}
function availableTags(){return library?.catalog||new Map()}
function checkboxList(container,selected,onchange){container.replaceChildren();for(const [key,tag] of [...availableTags()].sort((a,b)=>a[1].localeCompare(b[1],'fr'))){const label=document.createElement('label'),input=document.createElement('input');label.className='tagChoice';input.type='checkbox';input.value=key;input.checked=selected.has(key);input.onchange=()=>onchange?.(key,input.checked);label.append(input,document.createTextNode(tag));container.append(label)}}
function updateTagFilter(){const selected=tagFilter.value,values=availableTags();tagFilter.replaceChildren(new Option('Tous les tags',''));for(const [key,tag] of [...values].sort((a,b)=>a[1].localeCompare(b[1],'fr')))tagFilter.add(new Option(tag,key));tagFilter.value=values.has(selected)?selected:'';for(const key of [...noteTagFilters])if(!values.has(key))noteTagFilters.delete(key);renderNoteTagFilters()}
function renderNoteTagFilters(){checkboxList($('#noteTagChoices'),noteTagFilters,(key,checked)=>{checked?noteTagFilters.add(key):noteTagFilters.delete(key);render()});const summary=$('#noteTagsFilter summary');summary.textContent=noteTagFilters.size?'Tags ('+noteTagFilters.size+') ▾':'Tags ▾'}
function canonicalTags(value){return BibleTags.normalize(value,availableTags())}
function clearFilters(){tagFilter.value=''}
async function loadTags(){library=null;textIndex=new Map();documentMeta=new Map();tagFilter.value='';try{library=await BibleTags.load(root);[textIndex,documentMeta]=await Promise.all([PDFStore.index(library.id),BibleMeta.load(library.id)])}catch{message('Le stockage local des métadonnées ou du texte PDF est indisponible.')}updateTagFilter();$('#indexPdfs').disabled=!library;indexStatus.textContent=textIndex.size?textIndex.size+' PDF indexé(s). Relance l’indexation après avoir ajouté ou modifié des documents.':'Recherche dans les noms et tags. Indexe les PDF pour chercher aussi dans leur texte.';}

async function rerenderPreservingScroll(){const x=window.scrollX||0,y=window.scrollY||0;await render();const restore=()=>window.scrollTo?.(x,y);window.requestAnimationFrame?window.requestAnimationFrame(restore):restore()}
function saveSort(){try{localStorage.setItem('bible-qsse-sort',sortBy);localStorage.setItem('bible-qsse-sort-direction',sortDirection)}catch{}}

const current=()=>trail.length?trail.at(-1):root;
function message(text){ui.notice.textContent=text}
function readableError(error){return error?.name==='NotAllowedError'?'Accès refusé. Autorise ce dossier dans le navigateur.':error?.message||'Une erreur est survenue.'}
async function sorted(dir){const items=[];for await(const [name,handle] of dir.entries())items.push({name,handle});return items.sort((a,b)=>a.handle.kind===b.handle.kind?a.name.localeCompare(b.name,'fr',{numeric:true}):a.handle.kind==='directory'?-1:1)}
function storage(){return new Promise((resolve,reject)=>{const request=indexedDB.open('bible-qsse',1);request.onupgradeneeded=()=>request.result.createObjectStore('settings');request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result)})}
async function remember(handle){const db=await storage();await new Promise((resolve,reject)=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put(handle,'root');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()}
async function recalled(){const db=await storage();const result=await new Promise((resolve,reject)=>{const req=db.transaction('settings').objectStore('settings').get('root');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});db.close();return result}
async function permission(handle,write=false,request=false){const options={mode:write?'readwrite':'read'};if(await handle.queryPermission(options)==='granted')return true;return request&&await handle.requestPermission(options)==='granted'}
async function activateRoot(handle){root=handle;pendingRoot=null;trail=[];scope='all';noteTagFilters.clear();documentCountCache=new WeakMap();ui.search.value='';ui.quickFilter.value='';$('#noteSearch').value='';clearFilters();$('#choose').textContent='Choisir un dossier';await loadTags();await render()}
async function choose(){if(!window.showDirectoryPicker){message('La sélection de dossier nécessite Chrome ou Edge sur une page HTTPS.');return}try{if(pendingRoot){if(await permission(pendingRoot,false,true)){await activateRoot(pendingRoot);message('Bibliothèque précédente rouverte.');return}message('Chrome demande une nouvelle sélection du dossier. Touche de nouveau « Choisir un dossier ».');pendingRoot=null;$('#choose').textContent='Choisir un dossier';return}const selected=await showDirectoryPicker({mode:'readwrite'});await activateRoot(selected);try{await remember(root)}catch(error){message('Dossier ouvert, mais sa mémorisation a échoué.')}}catch(error){if(error.name!=='AbortError')message(readableError(error))}}
async function countDocuments(dir){if(documentCountCache.has(dir))return documentCountCache.get(dir);let count=0;for(const item of await sorted(dir)){if(item.handle.kind==='directory')count+=await countDocuments(item.handle);else count++}documentCountCache.set(dir,count);return count}
function leaveSelection(){}
function favoriteVisual(button,name,value){button.textContent=value?'★ Favori':'☆ Favori';button.setAttribute('aria-pressed',String(value));button.setAttribute('aria-label',(value?'Retirer des favoris : ':'Ajouter aux favoris : ')+name)}
function refreshVisibleFavorite(key,value){for(const button of ui.grid.querySelectorAll('.favoriteToggle'))if(button.dataset.key===key)favoriteVisual(button,button.dataset.name,value)}
function card(item,path,searchResult=false,match=null){
  const {name,handle}=item;
  const category=itemCategory(item,path),article=document.createElement('article');article.className='card';article.style.setProperty('--category',category.color);
  const button=document.createElement('button');button.type='button';button.className='openDoc';
  const type=document.createElement('div');type.className='type';type.textContent=handle.kind==='directory'?(category.label==='Autre'?'DOSSIER':category.label.toUpperCase()):(name.includes('.')?name.split('.').pop().toUpperCase():'DOCUMENT');
  const title=document.createElement('div');title.className='name';title.textContent=name;
  const meta=document.createElement('div');meta.className='meta';meta.textContent=handle.kind==='directory'?'Ouvrir le dossier':'Ouvrir le document';
  button.append(type,title,meta);
  if(searchResult){const location=document.createElement('div');location.className='location';location.textContent=[root.name,...path.map(h=>h.name)].join(' / ');button.append(location)}
  button.onclick=async()=>{if(handle.kind==='directory'){scope='all';trail=[...path,handle];ui.search.value='';ui.quickFilter.value='';clearFilters();await render()}else await openFile(handle,match,item,path)};
  article.append(button);
  if(match){const excerpt=document.createElement('div');excerpt.className='searchExcerpt';excerpt.textContent='Texte PDF · page '+match.page+' : '+match.snippet;article.append(excerpt);}
  if(handle.kind==='file'){
    const bar=document.createElement('div');bar.className='tagBar';
    const key=BibleTags.key(path,name),favorite=document.createElement('button');favorite.type='button';favorite.className='favoriteToggle';favorite.dataset.key=key;favorite.dataset.name=name;favoriteVisual(favorite,name,!!documentMeta.get(key)?.favorite);favorite.disabled=!library;favorite.onclick=async()=>{const value=!documentMeta.get(key)?.favorite;favorite.disabled=true;try{const record=await BibleMeta.favorite(library.id,key,value);documentMeta.set(key,record);refreshVisibleFavorite(key,value);if(!value&&scope==='favorites'){article.remove();ui.status.textContent=ui.grid.querySelectorAll('.card').length+' favori(s)'}message('')}catch{message('Impossible d’enregistrer ce favori.')}finally{favorite.disabled=false}};bar.append(favorite);
    const edit=document.createElement('button');edit.type='button';edit.className='tagEdit';edit.textContent='Tags';edit.setAttribute('aria-label','Modifier les tags de '+name);edit.disabled=!library;
    edit.onclick=()=>{editingTag={library:library.id,key:BibleTags.key(path,name),tags:new Set(tagsFor(item,path).map(BibleTags.normalizedKey))};$('#tagFilename').textContent=name;$('#tagInput').value='';checkboxList($('#documentTagChoices'),editingTag.tags,(key,checked)=>checked?editingTag.tags.add(key):editingTag.tags.delete(key));$('#tagError').textContent='';$('#tagDialog').showModal()};bar.append(edit);article.append(bar);
    if(view==='list')handle.getFile().then(file=>{meta.textContent=(file.size<1024?file.size+' o':file.size<1048576?(file.size/1024).toFixed(1)+' Ko':(file.size/1048576).toFixed(1)+' Mo')+' · '+new Date(file.lastModified).toLocaleDateString('fr-CH')}).catch(()=>{meta.textContent='Informations indisponibles'});
  }
  const protectedCategory=handle.kind==='directory'&&path.length===0&&categoryOf(name).label!=='Autre';
  if(!protectedCategory){let bar=article.querySelector('.tagBar');if(!bar){bar=document.createElement('div');bar.className='tagBar';article.append(bar)}const remove=document.createElement('button');remove.type='button';remove.className='tagEdit deleteEntry';remove.textContent='Supprimer';remove.setAttribute('aria-label','Supprimer '+name);remove.onclick=()=>deleteEntry(item,path);bar.append(remove)}
  return article;
}
async function categoryCard(item){const node=card(item,[]);node.classList.add('categoryCard');const meta=node.querySelector('.meta');try{const count=await countDocuments(item.handle);meta.textContent=count+' document(s)'}catch{meta.textContent='Ouvrir la catégorie'}return node}
async function deleteEntry(item,path){const parent=path.at(-1)||root;if(!parent?.removeEntry){message('La suppression directe n’est pas disponible sur cet appareil.');return}const kind=item.handle.kind==='directory'?'le dossier vide':'le fichier';if(!confirm(`Supprimer ${kind} « ${item.name} » ? Cette action ne dispose pas de corbeille.`))return;try{if(!await permission(parent,true,true)){message('Autorisation de suppression refusée.');return}await parent.removeEntry(item.name,{recursive:false});documentCountCache=new WeakMap();if(item.handle.kind==='file'&&library){const key=BibleTags.key(path,item.name);await Promise.allSettled([BibleMeta.remove(library.id,key),BibleTags.save(library.id,key,[]),PDFStore.removeText(library.id,key)]);documentMeta.delete(key);library.tags.delete(key);textIndex.delete(key)}message(item.handle.kind==='directory'?'Dossier vide supprimé.':'Fichier supprimé.');await render()}catch(error){message(error.name==='InvalidModificationError'||error.name==='NoModificationAllowedError'?'Ce dossier n’est pas vide. Son contenu a été conservé.':readableError(error))}}
$('#tagCancel').onclick=()=>$('#tagDialog').close();
$('#tagForm').onsubmit=async event=>{
  event.preventDefault();if(!editingTag)return;
  const target=editingTag,chosen=[...target.tags].map(key=>availableTags().get(key)).filter(Boolean),tags=canonicalTags([...chosen,$('#tagInput').value]);
  $('#tagSave').disabled=true;
  try{const saved=await BibleTags.save(target.library,target.key,tags);if(library?.id===target.library){library.tags.set(target.key,saved);library=await BibleTags.load(root);updateTagFilter()}$('#tagDialog').close();message('Tags enregistrés sur cet appareil.');await rerenderPreservingScroll()}
  catch{ $('#tagError').textContent='Enregistrement impossible. Vérifie que le stockage du navigateur est disponible.'; }
  finally{$('#tagSave').disabled=false}
};
async function openFile(handle,match=null,item=null,path=[]){
  try{const file=await handle.getFile();let key=null,record=null,pageTimer=null;if(library&&item){key=BibleTags.key(path,item.name);record=await BibleMeta.opened(library.id,key,{name:item.name,category:itemCategory(item,path).label});documentMeta.set(key,record)}if(/\.pdf$/i.test(file.name)||file.type==='application/pdf'){const contentResult=match&&!match.resume;await BiblePDF.open(file,{startPage:match?.page||record?.page||1,searchQuery:contentResult?ui.search.value.trim():'',searchPage:contentResult?(match?.page||0):0,onPage:key?page=>{const next={...documentMeta.get(key),page};documentMeta.set(key,next);clearTimeout(pageTimer);pageTimer=setTimeout(()=>BibleMeta.page(library.id,key,page).catch(()=>{}),250)}:null,onCreateNote:key?({page})=>openNoteEditor({documentKey:key,documentName:item.name,page}):null,onLegacyNotes:key?(fingerprint,items)=>migrateLegacyNotes(fingerprint,items,key,item.name):null});return}
    const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.click();setTimeout(()=>URL.revokeObjectURL(url),120000);
  }catch(error){message(readableError(error))}
}
async function findDocument(key){let found=null;const walk=async(dir,path)=>{for(const item of await sorted(dir)){if(found)return;if(item.handle.kind==='directory')await walk(item.handle,[...path,item.handle]);else if(BibleTags.key(path,item.name)===key){found={item,path};return}}};if(root)await walk(root,[]);return found}
async function migrateLegacyNotes(fingerprint,items,documentKey,documentName){
  if(!library)return;let changed=false;
  for(const item of items.filter(entry=>entry.type==='note'&&entry.text?.trim())){const id='legacy-'+fingerprint+'-'+(item.id||item.page+'-'+folded(item.text));if(library.notes.some(note=>note.id===id))continue;const title=item.text.trim().split(/\n/)[0].slice(0,180)||'Note importée';const note=await BibleTags.saveNote(library.id,{id,title,text:item.text.trim(),documentKey,documentName,page:item.page||1,tags:[],created:Date.now()});library.notes.push(note);changed=true}
  if(changed&&scope==='notes')render();
}
function openNoteEditor(note){
  editingNote={...note,tags:[...(note.tags||[])]};$('#pdfNoteHeading').textContent=note.id?'Modifier la note':'Nouvelle note';$('#pdfNoteTitle').value=note.title||'';$('#pdfNoteText').value=note.text||'';$('#pdfNoteNewTag').value='';$('#pdfNoteError').textContent='';const chosen=new Set(editingNote.tags.map(BibleTags.normalizedKey));checkboxList($('#pdfNoteTags'),chosen,(key,checked)=>{const tag=availableTags().get(key);if(checked&&!editingNote.tags.some(value=>BibleTags.normalizedKey(value)===key))editingNote.tags.push(tag);if(!checked)editingNote.tags=editingNote.tags.filter(value=>BibleTags.normalizedKey(value)!==key)});$('#pdfNoteDialog').showModal();$('#pdfNoteTitle').focus()
}
$('#pdfNoteCancel').onclick=()=>$('#pdfNoteDialog').close();
$('#pdfNoteForm').onsubmit=async event=>{event.preventDefault();if(!editingNote||!library)return;const title=$('#pdfNoteTitle').value.trim();if(!title){$('#pdfNoteError').textContent='Le titre est obligatoire.';return}const added=$('#pdfNoteNewTag').value.trim(),tags=canonicalTags([...editingNote.tags,...(added?[added]:[])]);$('#pdfNoteSave').disabled=true;try{const saved=await BibleTags.saveNote(library.id,{...editingNote,title,text:$('#pdfNoteText').value,tags});const index=library.notes.findIndex(note=>note.id===saved.id);if(index>=0)library.notes[index]=saved;else library.notes.push(saved);library=await BibleTags.load(root);updateTagFilter();$('#pdfNoteDialog').close();message('Note enregistrée sur cet appareil.');if(scope==='notes')await render()}catch{$('#pdfNoteError').textContent='Enregistrement impossible sur cet appareil.'}finally{$('#pdfNoteSave').disabled=false}};
$('#openPdf').onclick=()=>$('#pdfFile').click();
$('#pdfFile').onchange=async()=>{const file=$('#pdfFile').files[0];$('#pdfFile').value='';if(file)await BiblePDF.open(file)};
async function buildBackup(){if(!library)throw new Error('Sélectionne d’abord le dossier BibleQSSE.');const positions={};for(let index=0;index<localStorage.length;index++){const key=localStorage.key(index);if(key?.startsWith('bible-qsse-page-'))positions[key]=localStorage.getItem(key)}return {format:'bible-qsse-backup',version:2,createdAt:new Date().toISOString(),libraryName:root?.name||'',tags:await BibleTags.export(library.id),tagCatalog:await BibleTags.exportCatalog(library.id),notes:await BibleTags.exportNotes(library.id),documents:await BibleMeta.export(library.id),annotations:await PDFStore.exportAnnotations(),positions,preferences:{view,sortBy,sortDirection}}}
async function restoreBackup(data){if(!library)throw new Error('Sélectionne d’abord le dossier BibleQSSE.');if(data?.format!=='bible-qsse-backup'||![1,2].includes(data.version))throw new Error('Format de sauvegarde non reconnu.');await BibleTags.mergeCatalog(library.id,data.tagCatalog||[]);await BibleTags.merge(library.id,data.tags);await BibleTags.mergeNotes(library.id,data.notes||[]);await BibleMeta.merge(library.id,data.documents);await PDFStore.mergeAnnotations(data.annotations);for(const [key,value] of Object.entries(data.positions||{}))if(key.startsWith('bible-qsse-page-')&&localStorage.getItem(key)===null)localStorage.setItem(key,String(value));if(data.preferences){view=data.preferences.view==='list'?'list':'grid';sortBy=['title','size','opened','modified'].includes(data.preferences.sortBy)?data.preferences.sortBy:'title';sortDirection=data.preferences.sortDirection==='desc'?'desc':'asc';saveSort();try{localStorage.setItem('bible-qsse-view',view)}catch{}}await loadTags();await render();return true}
window.BibleBackup={build:buildBackup,restore:restoreBackup};
backupButton.onclick=async()=>{try{const data=await buildBackup(),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='Bible-QSSE-sauvegarde-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),120000);message('Sauvegarde préparée. Les PDF ne sont pas inclus.')}catch(error){message(readableError(error))}};
restoreButton.onclick=()=>restoreFile.click();restoreFile.onchange=async()=>{const file=restoreFile.files[0];restoreFile.value='';if(!file)return;try{const data=JSON.parse(await file.text());if(!confirm('Fusionner cette sauvegarde avec les données présentes sur cet appareil ? Les données existantes seront conservées.'))return;await restoreBackup(data);message('Sauvegarde restaurée et fusionnée avec les données existantes.')}catch(error){message('Restauration impossible : '+readableError(error))}};
function contentMatch(record,term){
  for(let i=0;i<record.pages.length;i++){
    const text=record.pages[i],where=folded(text).indexOf(term);
    if(where>=0){const start=Math.max(0,where-45);return {page:i+1,snippet:(start?'…':'')+text.slice(start,start+190)+(start+190<text.length?'…':'')}}
  }
  return null;
}
async function searchEverywhere(term,token){
  const found=[],query=folded(term);
  const walk=async(dir,path)=>{for(const item of await sorted(dir)){
    if(token!==generation)return;
    const tags=tagsFor(item,path).map(BibleTags.normalizedKey);
    const key=BibleTags.key(path,item.name),tagMatches=!tagFilter.value||tags.includes(tagFilter.value);
    let match=null;
    const matchName=!query||folded(item.name).includes(query)||tags.some(tag=>folded(tag).includes(query));
    if(tagMatches&&query&&item.handle.kind==='file'&&/\.pdf$/i.test(item.name)){
      const record=textIndex.get(key);
      if(record){try{if(PDFStore.matches(record,await item.handle.getFile()))match=contentMatch(record,query)}catch{}}
    }
    if(tagMatches&&(matchName||match))found.push({item,path,match});
    if(item.handle.kind==='directory')await walk(item.handle,[...path,item.handle]);
  }};
  await walk(root,[]);return found;
}
async function allFiles(token){const found=[];const walk=async(dir,path)=>{for(const item of await sorted(dir)){if(token!==generation)return;if(item.handle.kind==='directory')await walk(item.handle,[...path,item.handle]);else found.push({item,path})}};await walk(root,[]);return found}
async function quickNameResults(dir,path,term,token){const found=[];const walk=async(folder,currentPath)=>{for(const item of await sorted(folder)){if(token!==generation)return;const next={item,path:currentPath};if(folded(item.name).includes(term))found.push(next);if(item.handle.kind==='directory')await walk(item.handle,[...currentPath,item.handle])}};await walk(dir,path);return found}
function passesMetadataFilters(result){return !tagFilter.value||tagsFor(result.item,result.path).map(BibleTags.normalizedKey).includes(tagFilter.value)}
async function sortResults(results){const decorated=await Promise.all(results.map(async result=>{const key=BibleTags.key(result.path,result.item.name),meta=documentMeta.get(key);let size=0,modified=0;if(result.item.handle.kind==='file'&&(sortBy==='size'||sortBy==='modified'))try{const file=await result.item.handle.getFile();size=file.size;modified=file.lastModified}catch{}return {...result,key,size,modified,opened:meta?.lastOpened||0}}));const factor=sortDirection==='asc'?1:-1;decorated.sort((a,b)=>{const aFolder=a.item.handle.kind==='directory',bFolder=b.item.handle.kind==='directory';if(aFolder!==bFolder)return aFolder?-1:1;let value=0;if(sortBy==='size')value=a.size-b.size;else if(sortBy==='modified')value=a.modified-b.modified;else if(sortBy==='opened')value=a.opened-b.opened;if(!value)value=a.item.name.localeCompare(b.item.name,'fr',{numeric:true});return value*factor});return decorated}
async function renderTree(){ui.tree.replaceChildren();if(!root)return;const rootButton=document.createElement('button');rootButton.className='folder'+(trail.length?'':' active');rootButton.textContent='⌂ '+root.name;rootButton.onclick=()=>{leaveSelection();scope='all';trail=[];ui.search.value='';ui.quickFilter.value='';clearFilters();render()};ui.tree.append(rootButton);for(const item of await sorted(root)){if(item.handle.kind!=='directory')continue;const button=document.createElement('button');button.className='folder'+(trail[0]?.name===item.name?' active':'');button.textContent='▸ '+item.name;button.onclick=()=>{leaveSelection();scope='all';trail=[item.handle];ui.search.value='';ui.quickFilter.value='';clearFilters();render()};ui.tree.append(button)}}
function updateScopeButtons(){for(const [id,value] of [['showAll','all'],['showFavorites','favorites'],['showRecent','recent'],['showNotes','notes']])$('#'+id).setAttribute('aria-pressed',String(scope===value));$('#documentTools').hidden=scope==='notes';$('#noteTools').hidden=scope!=='notes'}
function selectScope(value){scope=value;trail=[];ui.search.value='';ui.quickFilter.value='';clearFilters();render()}
$('#showAll').onclick=()=>selectScope('all');$('#showFavorites').onclick=()=>selectScope('favorites');$('#showRecent').onclick=()=>selectScope('recent');$('#showNotes').onclick=()=>selectScope('notes');
function noteCard(note){
  const article=document.createElement('article'),open=document.createElement('button'),title=document.createElement('div'),source=document.createElement('div'),text=document.createElement('div'),tags=document.createElement('div'),actions=document.createElement('div'),edit=document.createElement('button'),remove=document.createElement('button');article.className='card noteCard';open.type='button';open.className='noteOpen';title.className='noteTitle';title.textContent=note.title;source.className='noteSource';source.textContent=note.documentName+' — page '+note.page;text.className='noteText';text.textContent=note.text||'';tags.className='tagBar';for(const tag of note.tags||[]){const chip=document.createElement('span');chip.className='tagChip';chip.textContent=tag;tags.append(chip)}open.append(title,source);if(note.text)open.append(text);open.append(tags);open.onclick=async()=>{const found=await findDocument(note.documentKey);if(!found){message('Le document associé n’est plus disponible.');return}await openFile(found.item.handle,{page:note.page,resume:true},found.item,found.path)};actions.className='noteActions';edit.type=remove.type='button';edit.textContent='Modifier';remove.textContent='Supprimer';edit.onclick=()=>openNoteEditor(note);remove.onclick=async()=>{if(!confirm('Supprimer cette note ? Le PDF sera conservé.'))return;await BibleTags.deleteNote(note.id);library.notes=library.notes.filter(item=>item.id!==note.id);message('Note supprimée. Le document a été conservé.');render()};actions.append(edit,remove);article.append(open,actions);return article
}
function renderNotes(){const query=folded($('#noteSearch').value),notes=(library?.notes||[]).filter(note=>(!query||folded(note.title+' '+note.text+' '+note.documentName).includes(query))&&[...noteTagFilters].every(key=>(note.tags||[]).some(tag=>BibleTags.normalizedKey(tag)===key))).sort((a,b)=>(b.modified||0)-(a.modified||0));ui.grid.classList.add('list');ui.crumb.textContent='Mes notes';ui.status.textContent=notes.length+' note(s)';if(!notes.length){ui.grid.innerHTML='<div class="empty">Aucune note ne correspond à ces critères.</div>';return}for(const note of notes)ui.grid.append(noteCard(note))}
async function render(){
  ui.grid.classList.toggle('list',view==='list'||scope==='notes');$('#gridView').setAttribute('aria-pressed',String(view==='grid'));$('#listView').setAttribute('aria-pressed',String(view==='list'));updateScopeButtons();const token=++generation;ui.grid.replaceChildren();const dir=current(),contentTerm=ui.search.value.trim(),filtering=!!contentTerm||!!tagFilter.value,quickTerm=folded(ui.quickFilter.value||'');ui.up.disabled=!trail.length||filtering||!!quickTerm||scope!=='all';ui.newFolder.disabled=ui.addFiles.disabled=!dir||scope!=='all';ui.crumb.textContent=scope==='favorites'?'Favoris':scope==='recent'?'Documents récents':dir?[root.name,...trail.map(h=>h.name)].join(' / '):'Bible QSSE';ui.status.textContent='';if(!dir){ui.grid.innerHTML='<div class="empty">Choisis le dossier qui contient tes documents QSSE pour commencer.</div>';return}
  try{await renderTree();if(token!==generation)return;if(scope==='notes'){renderNotes();return}const term=contentTerm.toLocaleLowerCase('fr'),searching=filtering;if(scope!=='all'){let results=(await allFiles(token)).filter(result=>scope==='favorites'?documentMeta.get(BibleTags.key(result.path,result.item.name))?.favorite:documentMeta.get(BibleTags.key(result.path,result.item.name))?.lastOpened);if(scope==='recent')results.sort((a,b)=>(documentMeta.get(BibleTags.key(b.path,b.item.name))?.lastOpened||0)-(documentMeta.get(BibleTags.key(a.path,a.item.name))?.lastOpened||0));results=scope==='recent'?results.slice(0,20):await sortResults(results);ui.status.textContent=results.length+(scope==='favorites'?' favori(s)':' document(s) récent(s)');if(!results.length){ui.grid.innerHTML='<div class="empty">Aucun document pour le moment.</div>';return}for(const result of results)ui.grid.append(card(result.item,result.path,true));return}if(!trail.length&&!searching&&!quickTerm){const categories=(await sorted(root)).filter(item=>item.handle.kind==='directory');ui.status.textContent=categories.length+' catégorie(s)';for(const item of categories){if(token!==generation)return;ui.grid.append(await categoryCard(item))}return}let results;if(quickTerm)results=(await quickNameResults(dir,trail,quickTerm,token)).filter(passesMetadataFilters);else if(searching)results=await searchEverywhere(term,token);else results=(await sorted(dir)).map(item=>({item,path:trail})).filter(passesMetadataFilters);if(token!==generation)return;results=await sortResults(results);if(token!==generation)return;if(quickTerm){const total=await countDocuments(dir),documents=results.filter(result=>result.item.handle.kind==='file').length;ui.status.textContent=`${documents} résultat(s) sur ${total} documents`}else ui.status.textContent=searching?`${results.length} résultat(s) dans tous les sous-dossiers`:`${results.length} élément(s) dans ce dossier`;if(!results.length){ui.grid.innerHTML=`<div class="empty">${searching||quickTerm?'Aucun résultat.':'Ce dossier est vide.'}</div>`;return}for(const result of results)ui.grid.append(card(result.item,result.path,searching||quickTerm,result.match))}catch(error){if(token===generation)message(readableError(error))}}
async function requireWrite(){if(!current())return false;if(await permission(current(),true,true))return true;message('Autorisation de modification refusée.');return false}
ui.newFolder.onclick=async()=>{try{if(!await requireWrite())return;const name=prompt('Nom du nouveau dossier :');if(!name?.trim())return;await current().getDirectoryHandle(name.trim(),{create:true});documentCountCache=new WeakMap();message('Dossier créé.');await render()}catch(error){message(readableError(error))}};
ui.addFiles.onclick=async()=>{try{if(await requireWrite())ui.files.click()}catch(error){message(readableError(error))}};
ui.files.onchange=async()=>{const files=[...ui.files.files];ui.files.value='';if(!files.length)return;let added=0,failed=0;for(const file of files){try{const name=file.name;try{await current().getFileHandle(name);if(!confirm(`« ${name} » existe déjà. Le remplacer ?`))continue}catch(error){if(error.name!=='NotFoundError')throw error}const handle=await current().getFileHandle(name,{create:true});const stream=await handle.createWritable();await stream.write(file);await stream.close();added++}catch(error){failed++;message(`Import impossible pour « ${file.name} » : ${readableError(error)}`)}}documentCountCache=new WeakMap();if(!failed)message(`${added} document(s) ajouté(s).`);await render()};
$('#choose').onclick=choose;ui.up.onclick=()=>{if(trail.length){leaveSelection();trail.pop();ui.quickFilter.value='';render()}};let searchTimer;ui.search.oninput=()=>{clearTimeout(searchTimer);generation++;searchTimer=setTimeout(render,180)};ui.quickFilter.oninput=()=>{clearTimeout(searchTimer);generation++;searchTimer=setTimeout(render,120)};$('#contentSearch').onclick=()=>{const term=ui.quickFilter.value.trim();if(!term){ui.search.focus();return}ui.search.value=term;ui.quickFilter.value='';render()};$('#sortBy').onchange=()=>{sortBy=$('#sortBy').value;saveSort();rerenderPreservingScroll()};$('#sortDirection').onclick=()=>{sortDirection=sortDirection==='asc'?'desc':'asc';$('#sortDirection').textContent=sortDirection==='asc'?'↑':'↓';saveSort();rerenderPreservingScroll()};$('#foldersToggle').onclick=()=>{const panel=$('#folderPanel');panel.classList.toggle('open');$('#foldersToggle').setAttribute('aria-expanded',String(panel.classList.contains('open')))};
$('#noteSearch').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(render,100)};$('#clearNoteTags').onclick=()=>{noteTagFilters.clear();renderNoteTagFilters();render()};
window.addEventListener('scroll',()=>{$('#toTop').hidden=(window.scrollY||0)<500},{passive:true});$('#toTop').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});
$('#stopIndex').onclick=()=>indexController?.abort();
$('#indexPdfs').onclick=async()=>{
  if(!root||!library||indexController)return;
  const controller=new AbortController(),rootToIndex=root,libraryId=library.id;indexController=controller;
  $('#indexPdfs').disabled=true;$('#choose').disabled=true;$('#stopIndex').hidden=false;
  let processed=0,scans=0,errors=0;const seen=new Set();
  indexStatus.textContent='Préparation de la recherche dans les PDF…';
  async function walk(dir,path,engine){
    for(const item of await sorted(dir)){
      if(controller.signal.aborted)throw new DOMException('Indexation arrêtée','AbortError');
      if(item.handle.kind==='directory'){await walk(item.handle,[...path,item.handle],engine);continue}
      if(!/\.pdf$/i.test(item.name))continue;
      const key=BibleTags.key(path,item.name);seen.add(key);
      try{
        const file=await item.handle.getFile(),previous=textIndex.get(key);let pages=previous?.pages;
        if(!PDFStore.matches(previous,file)){
          const bytes=await file.arrayBuffer();
          pages=await engine.extractText(bytes,(page,total)=>{indexStatus.textContent='Indexation : '+item.name+' · page '+page+'/'+total+' · '+processed+' PDF terminé(s)'},controller.signal);
          if(controller.signal.aborted)throw new DOMException('Indexation arrêtée','AbortError');
          await PDFStore.saveText(libraryId,key,file,pages);
          textIndex.set(key,{size:file.size,modified:file.lastModified,pages});
        }
        processed++;if(!pages.some(text=>text.trim()))scans++;
      }catch(error){if(error.name==='AbortError')throw error;errors++;textIndex.delete(key)}
      indexStatus.textContent=processed+' PDF indexé(s) · '+errors+' non lisible(s)';
    }
  }
  try{
    await walk(rootToIndex,[],await BiblePDF.engine());
    for(const key of textIndex.keys())if(!seen.has(key))textIndex.delete(key);
    await PDFStore.keepPaths(libraryId,[...textIndex.keys()]);
    indexStatus.textContent=processed+' PDF indexé(s). '+(scans?scans+' sans texte sélectionnable (scan, OCR nécessaire). ':'')+(errors?errors+' PDF non lisible(s) ou protégé(s).':'Recherche dans le texte prête.');
  }catch(error){indexStatus.textContent=error.name==='AbortError'?'Indexation arrêtée. '+processed+' PDF traité(s) conservés.':'Indexation interrompue : '+readableError(error)}
  finally{indexController=null;$('#indexPdfs').disabled=!library;$('#choose').disabled=false;$('#stopIndex').hidden=true;if(ui.search.value.trim())await render()}
};
(async()=>{if(!window.showDirectoryPicker){message('Ouvre cette application dans Chrome ou Edge sur HTTPS pour accéder à un dossier local.');render();return}try{const saved=await recalled();if(saved){if(await permission(saved)){await activateRoot(saved);message('Dossier précédent retrouvé.')}else{pendingRoot=saved;root=null;$('#choose').textContent='Rouvrir '+saved.name;message('Touche « Rouvrir '+saved.name+' » pour réautoriser la bibliothèque sans la sélectionner de nouveau.');render()}}else render()}catch(error){message(readableError(error));render()}})();
let installPrompt=null;
const installButton=$('#install');
const installHelp=$('#installHelp');
const standalone=window.matchMedia('(display-mode: standalone)');
installButton.hidden=standalone.matches;
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  installPrompt=event;
  installButton.hidden=false;
  installButton.textContent='Installer maintenant';
});
window.addEventListener('appinstalled',()=>{
  installPrompt=null;
  installButton.hidden=true;
  installHelp.close();
  message('Bible QSSE est installée.');
});
installButton.onclick=async()=>{
  if(!installPrompt){installHelp.showModal();return}
  const prompt=installPrompt;
  installPrompt=null;
  installButton.textContent='Installer l’application';
  try{await prompt.prompt();await prompt.userChoice}
  catch(error){installHelp.showModal()}
};
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js?v=16',{updateViaCache:'none'}).catch(()=>{
    message('Le mode hors connexion n’est pas disponible. Recharge la page avec une connexion Internet.');
  });
}
