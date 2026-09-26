'use strict';
const $=selector=>document.querySelector(selector);
const ui={grid:$('#grid'),tree:$('#tree'),crumb:$('#crumb'),search:$('#search'),status:$('#status'),notice:$('#notice'),up:$('#up'),newFolder:$('#newFolder'),addFiles:$('#addFiles'),files:$('#files')};
let root=null,trail=[],generation=0;
let library=null,editingTag=null;
let textIndex=new Map(),indexController=null;
const indexStatus=$('#indexStatus');
const folded=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').replace(/\s+/g,' ').trim();
const tagFilter=$('#tagFilter');
let view='grid';
try{view=localStorage.getItem('bible-qsse-view')==='list'?'list':'grid'}catch{}
function setView(value){view=value;ui.grid.classList.toggle('list',view==='list');$('#gridView').setAttribute('aria-pressed',String(view==='grid'));$('#listView').setAttribute('aria-pressed',String(view==='list'));try{localStorage.setItem('bible-qsse-view',view)}catch{}render()}
$('#gridView').onclick=()=>setView('grid');$('#listView').onclick=()=>setView('list');
tagFilter.onchange=()=>render();
function tagsFor(item,path){return library?.tags.get(BibleTags.key(path,item.name))||[]}
function updateTagFilter(){const selected=tagFilter.value;const values=new Map();for(const tags of library?.tags.values()||[]){for(const tag of tags)values.set(tag.toLocaleLowerCase('fr'),tag)}tagFilter.replaceChildren(new Option('Tous les tags',''));for(const [key,tag] of [...values].sort((a,b)=>a[1].localeCompare(b[1],'fr')))tagFilter.add(new Option(tag,key));tagFilter.value=values.has(selected)?selected:'';}
async function loadTags(){library=null;textIndex=new Map();tagFilter.value='';try{library=await BibleTags.load(root);textIndex=await PDFStore.index(library.id)}catch{message('Le stockage local des tags ou du texte PDF est indisponible.')}updateTagFilter();$('#indexPdfs').disabled=!library;indexStatus.textContent=textIndex.size?textIndex.size+' PDF indexé(s). Relance l’indexation après avoir ajouté ou modifié des documents.':'Recherche dans les noms et tags. Indexe les PDF pour chercher aussi dans leur texte.';}

const current=()=>trail.length?trail.at(-1):root;
function message(text){ui.notice.textContent=text}
function readableError(error){return error?.name==='NotAllowedError'?'Accès refusé. Autorise ce dossier dans le navigateur.':error?.message||'Une erreur est survenue.'}
async function sorted(dir){const items=[];for await(const [name,handle] of dir.entries())items.push({name,handle});return items.sort((a,b)=>a.handle.kind===b.handle.kind?a.name.localeCompare(b.name,'fr',{numeric:true}):a.handle.kind==='directory'?-1:1)}
function storage(){return new Promise((resolve,reject)=>{const request=indexedDB.open('bible-qsse',1);request.onupgradeneeded=()=>request.result.createObjectStore('settings');request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result)})}
async function remember(handle){const db=await storage();await new Promise((resolve,reject)=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put(handle,'root');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()}
async function recalled(){const db=await storage();const result=await new Promise((resolve,reject)=>{const req=db.transaction('settings').objectStore('settings').get('root');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});db.close();return result}
async function permission(handle,write=false,request=false){const options={mode:write?'readwrite':'read'};if(await handle.queryPermission(options)==='granted')return true;return request&&await handle.requestPermission(options)==='granted'}
async function choose(){if(!window.showDirectoryPicker){message('La sélection de dossier nécessite Chrome ou Edge sur une page HTTPS.');return}try{const selected=await showDirectoryPicker({mode:'readwrite'});root=selected;trail=[];ui.search.value='';await loadTags();try{await remember(root)}catch(error){message('Dossier ouvert, mais sa mémorisation a échoué.')}await render()}catch(error){if(error.name!=='AbortError')message(readableError(error))}}
function card(item,path,searchResult=false,match=null){
  const {name,handle}=item;
  const article=document.createElement('article');article.className='card';
  const button=document.createElement('button');button.type='button';button.className='openDoc';
  const type=document.createElement('div');type.className='type';type.textContent=handle.kind==='directory'?'DOSSIER':(name.includes('.')?name.split('.').pop().toUpperCase():'DOCUMENT');
  const title=document.createElement('div');title.className='name';title.textContent=name;
  const meta=document.createElement('div');meta.className='meta';meta.textContent=handle.kind==='directory'?'Ouvrir le dossier':'Ouvrir le document';
  button.append(type,title,meta);
  if(searchResult){const location=document.createElement('div');location.className='location';location.textContent=[root.name,...path.map(h=>h.name)].join(' / ');button.append(location)}
  button.onclick=async()=>{if(handle.kind==='directory'){trail=[...path,handle];ui.search.value='';tagFilter.value='';await render()}else await openFile(handle,match)};
  article.append(button);
  if(match){const excerpt=document.createElement('div');excerpt.className='searchExcerpt';excerpt.textContent='Texte PDF · page '+match.page+' : '+match.snippet;article.append(excerpt);}
  if(handle.kind==='file'){
    const bar=document.createElement('div');bar.className='tagBar';
    for(const tag of tagsFor(item,path)){
      const chip=document.createElement('button');chip.type='button';chip.className='tagChip';chip.textContent=tag;chip.title='Filtrer par '+tag;chip.onclick=()=>{tagFilter.value=tag.toLocaleLowerCase('fr');render()};bar.append(chip);
    }
    const edit=document.createElement('button');edit.type='button';edit.className='tagEdit';edit.textContent='Tags';edit.setAttribute('aria-label','Modifier les tags de '+name);edit.disabled=!library;
    edit.onclick=()=>{editingTag={library:library.id,key:BibleTags.key(path,name)};$('#tagFilename').textContent=name;$('#tagInput').value=tagsFor(item,path).join(', ');$('#tagError').textContent='';$('#tagDialog').showModal();$('#tagInput').focus()};bar.append(edit);article.append(bar);
    if(view==='list')handle.getFile().then(file=>{meta.textContent=(file.size<1024?file.size+' o':file.size<1048576?(file.size/1024).toFixed(1)+' Ko':(file.size/1048576).toFixed(1)+' Mo')+' · '+new Date(file.lastModified).toLocaleDateString('fr-CH')}).catch(()=>{meta.textContent='Informations indisponibles'});
  }
  return article;
}
$('#tagCancel').onclick=()=>$('#tagDialog').close();
$('#tagForm').onsubmit=async event=>{
  event.preventDefault();if(!editingTag)return;
  const target=editingTag,tags=BibleTags.normalize($('#tagInput').value);
  $('#tagSave').disabled=true;
  try{await BibleTags.save(target.library,target.key,tags);if(library?.id===target.library){library.tags.set(target.key,tags);updateTagFilter()}$('#tagDialog').close();message('Tags enregistrés sur cet appareil.');await render()}
  catch{ $('#tagError').textContent='Enregistrement impossible. Vérifie que le stockage du navigateur est disponible.'; }
  finally{$('#tagSave').disabled=false}
};
async function openFile(handle,match=null){
  try{const file=await handle.getFile();if(/\.pdf$/i.test(file.name)||file.type==='application/pdf'){await BiblePDF.open(file,{startPage:match?.page||1});return}
    const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.click();setTimeout(()=>URL.revokeObjectURL(url),120000);
  }catch(error){message(readableError(error))}
}
$('#openPdf').onclick=()=>$('#pdfFile').click();
$('#pdfFile').onchange=async()=>{const file=$('#pdfFile').files[0];$('#pdfFile').value='';if(file)await BiblePDF.open(file)};
function contentMatch(record,term){
  for(let i=0;i<record.pages.length;i++){
    const text=record.pages[i],where=folded(text).indexOf(term);
    if(where>=0){const start=Math.max(0,where-45);return {page:i+1,snippet:(start?'…':'')+text.slice(start,start+190)+(start+190<text.length?'…':'')}}
  }
  return null;
}
async function searchEverywhere(term,token){
  const found=[],selected=tagFilter.value,query=folded(term);
  const walk=async(dir,path)=>{for(const item of await sorted(dir)){
    if(token!==generation)return;
    const tags=tagsFor(item,path).map(tag=>tag.toLocaleLowerCase('fr'));
    const tagMatches=!selected||tags.includes(selected);
    let match=null;
    const matchName=!query||folded(item.name).includes(query)||tags.some(tag=>folded(tag).includes(query));
    if(tagMatches&&query&&item.handle.kind==='file'&&/\.pdf$/i.test(item.name)){
      const record=textIndex.get(BibleTags.key(path,item.name));
      if(record){try{if(PDFStore.matches(record,await item.handle.getFile()))match=contentMatch(record,query)}catch{}}
    }
    if(tagMatches&&(matchName||match))found.push({item,path,match});
    if(item.handle.kind==='directory')await walk(item.handle,[...path,item.handle]);
  }};
  await walk(root,[]);return found;
}
async function renderTree(){ui.tree.replaceChildren();if(!root)return;const rootButton=document.createElement('button');rootButton.className='folder'+(trail.length?'':' active');rootButton.textContent='⌂ '+root.name;rootButton.onclick=()=>{trail=[];ui.search.value='';tagFilter.value='';render()};ui.tree.append(rootButton);for(const item of await sorted(root)){if(item.handle.kind!=='directory')continue;const button=document.createElement('button');button.className='folder'+(trail[0]?.name===item.name?' active':'');button.textContent='▸ '+item.name;button.onclick=()=>{trail=[item.handle];ui.search.value='';tagFilter.value='';render()};ui.tree.append(button)}}
async function render(){ui.grid.classList.toggle('list',view==='list');$('#gridView').setAttribute('aria-pressed',String(view==='grid'));$('#listView').setAttribute('aria-pressed',String(view==='list'));const token=++generation;ui.grid.replaceChildren();const dir=current();ui.up.disabled=!trail.length||!!ui.search.value.trim()||!!tagFilter.value;ui.newFolder.disabled=ui.addFiles.disabled=!dir;ui.crumb.textContent=dir?[root.name,...trail.map(h=>h.name)].join(' / '):'Bible QSSE';ui.status.textContent='';if(!dir){ui.grid.innerHTML='<div class="empty">Choisis le dossier qui contient tes documents QSSE pour commencer.</div>';return}try{await renderTree();if(token!==generation)return;const term=ui.search.value.trim().toLocaleLowerCase('fr');const searching=!!term||!!tagFilter.value;const results=searching?await searchEverywhere(term,token):(await sorted(dir)).map(item=>({item,path:trail}));if(token!==generation)return;ui.status.textContent=searching?`${results.length} résultat(s) dans tous les sous-dossiers`:`${results.length} élément(s) dans ce dossier`;if(!results.length){ui.grid.innerHTML=`<div class="empty">${searching?'Aucun résultat.':'Ce dossier est vide.'}</div>`;return}for(const result of results)ui.grid.append(card(result.item,result.path,searching,result.match))}catch(error){if(token===generation)message(readableError(error))}}
async function requireWrite(){if(!current())return false;if(await permission(current(),true,true))return true;message('Autorisation de modification refusée.');return false}
ui.newFolder.onclick=async()=>{try{if(!await requireWrite())return;const name=prompt('Nom du nouveau dossier :');if(!name?.trim())return;await current().getDirectoryHandle(name.trim(),{create:true});message('Dossier créé.');await render()}catch(error){message(readableError(error))}};
ui.addFiles.onclick=async()=>{try{if(await requireWrite())ui.files.click()}catch(error){message(readableError(error))}};
ui.files.onchange=async()=>{const files=[...ui.files.files];ui.files.value='';if(!files.length)return;let added=0,failed=0;for(const file of files){try{const name=file.name;try{await current().getFileHandle(name);if(!confirm(`« ${name} » existe déjà. Le remplacer ?`))continue}catch(error){if(error.name!=='NotFoundError')throw error}const handle=await current().getFileHandle(name,{create:true});const stream=await handle.createWritable();await stream.write(file);await stream.close();added++}catch(error){failed++;message(`Import impossible pour « ${file.name} » : ${readableError(error)}`)}}if(!failed)message(`${added} document(s) ajouté(s).`);await render()};
$('#choose').onclick=choose;ui.up.onclick=()=>{if(trail.length){trail.pop();render()}};let searchTimer;ui.search.oninput=()=>{clearTimeout(searchTimer);generation++;searchTimer=setTimeout(render,180)};$('#foldersToggle').onclick=()=>{const panel=$('#folderPanel');panel.classList.toggle('open');$('#foldersToggle').setAttribute('aria-expanded',String(panel.classList.contains('open')))};
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
(async()=>{if(!window.showDirectoryPicker){message('Ouvre cette application dans Chrome ou Edge sur HTTPS pour accéder à un dossier local.');render();return}try{const saved=await recalled();if(saved){root=saved;if(await permission(root)){await loadTags();message('Dossier précédent retrouvé.');await render()}else{root=null;message('Sélectionne à nouveau ton dossier pour autoriser son accès.');render()}}else render()}catch(error){message(readableError(error));render()}})();
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
  navigator.serviceWorker.register('sw.js?v=9',{updateViaCache:'none'}).catch(()=>{
    message('Le mode hors connexion n’est pas disponible. Recharge la page avec une connexion Internet.');
  });
}
