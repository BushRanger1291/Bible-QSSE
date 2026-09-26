'use strict';
const $=selector=>document.querySelector(selector);
const ui={grid:$('#grid'),tree:$('#tree'),crumb:$('#crumb'),search:$('#search'),status:$('#status'),notice:$('#notice'),up:$('#up'),newFolder:$('#newFolder'),addFiles:$('#addFiles'),files:$('#files')};
let root=null,trail=[],generation=0;
const current=()=>trail.length?trail.at(-1):root;
function message(text){ui.notice.textContent=text}
function readableError(error){return error?.name==='NotAllowedError'?'Accès refusé. Autorise ce dossier dans le navigateur.':error?.message||'Une erreur est survenue.'}
async function sorted(dir){const items=[];for await(const [name,handle] of dir.entries())items.push({name,handle});return items.sort((a,b)=>a.handle.kind===b.handle.kind?a.name.localeCompare(b.name,'fr',{numeric:true}):a.handle.kind==='directory'?-1:1)}
function storage(){return new Promise((resolve,reject)=>{const request=indexedDB.open('bible-qsse',1);request.onupgradeneeded=()=>request.result.createObjectStore('settings');request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result)})}
async function remember(handle){const db=await storage();await new Promise((resolve,reject)=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put(handle,'root');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()}
async function recalled(){const db=await storage();const result=await new Promise((resolve,reject)=>{const req=db.transaction('settings').objectStore('settings').get('root');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});db.close();return result}
async function permission(handle,write=false,request=false){const options={mode:write?'readwrite':'read'};if(await handle.queryPermission(options)==='granted')return true;return request&&await handle.requestPermission(options)==='granted'}
async function choose(){if(!window.showDirectoryPicker){message('La sélection de dossier nécessite Chrome ou Edge sur une page HTTPS.');return}try{const selected=await showDirectoryPicker({mode:'readwrite'});root=selected;trail=[];ui.search.value='';try{await remember(root)}catch(error){message('Dossier ouvert, mais sa mémorisation a échoué.')}await render()}catch(error){if(error.name!=='AbortError')message(readableError(error))}}
function card(item,path,searchResult=false){const {name,handle}=item;const button=document.createElement('button');button.type='button';button.className='card';const type=document.createElement('div');type.className='type';type.textContent=handle.kind==='directory'?'DOSSIER':'DOCUMENT';const title=document.createElement('div');title.className='name';title.textContent=name;const meta=document.createElement('div');meta.className='meta';meta.textContent=searchResult?[root.name,...path.map(h=>h.name)].join(' / '):handle.kind==='directory'?'Ouvrir le dossier':'Ouvrir le document';button.append(type,title,meta);button.onclick=async()=>{if(handle.kind==='directory'){trail=[...path,handle];ui.search.value='';await render()}else await openFile(handle)};return button}
async function openFile(handle){try{const file=await handle.getFile();const url=URL.createObjectURL(file);const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.click();setTimeout(()=>URL.revokeObjectURL(url),120000)}catch(error){message(readableError(error))}}
async function searchEverywhere(term,token){const found=[];const walk=async(dir,path)=>{for(const item of await sorted(dir)){if(token!==generation)return;if(item.name.toLocaleLowerCase('fr').includes(term))found.push({item,path});if(item.handle.kind==='directory')await walk(item.handle,[...path,item.handle])}};await walk(root,[]);return found}
async function renderTree(){ui.tree.replaceChildren();if(!root)return;const rootButton=document.createElement('button');rootButton.className='folder'+(trail.length?'':' active');rootButton.textContent='⌂ '+root.name;rootButton.onclick=()=>{trail=[];ui.search.value='';render()};ui.tree.append(rootButton);for(const item of await sorted(root)){if(item.handle.kind!=='directory')continue;const button=document.createElement('button');button.className='folder'+(trail[0]?.name===item.name?' active':'');button.textContent='▸ '+item.name;button.onclick=()=>{trail=[item.handle];ui.search.value='';render()};ui.tree.append(button)}}
async function render(){const token=++generation;ui.grid.replaceChildren();const dir=current();ui.up.disabled=!trail.length||!!ui.search.value.trim();ui.newFolder.disabled=ui.addFiles.disabled=!dir;ui.crumb.textContent=dir?[root.name,...trail.map(h=>h.name)].join(' / '):'Bible QSSE';ui.status.textContent='';if(!dir){ui.grid.innerHTML='<div class="empty">Choisis le dossier qui contient tes documents QSSE pour commencer.</div>';return}try{await renderTree();if(token!==generation)return;const term=ui.search.value.trim().toLocaleLowerCase('fr');const results=term?await searchEverywhere(term,token):(await sorted(dir)).map(item=>({item,path:trail}));if(token!==generation)return;ui.status.textContent=term?`${results.length} résultat(s) dans tous les sous-dossiers`:`${results.length} élément(s) dans ce dossier`;if(!results.length){ui.grid.innerHTML=`<div class="empty">${term?'Aucun résultat.':'Ce dossier est vide.'}</div>`;return}for(const result of results)ui.grid.append(card(result.item,result.path,!!term))}catch(error){if(token===generation)message(readableError(error))}}
async function requireWrite(){if(!current())return false;if(await permission(current(),true,true))return true;message('Autorisation de modification refusée.');return false}
ui.newFolder.onclick=async()=>{try{if(!await requireWrite())return;const name=prompt('Nom du nouveau dossier :');if(!name?.trim())return;await current().getDirectoryHandle(name.trim(),{create:true});message('Dossier créé.');await render()}catch(error){message(readableError(error))}};
ui.addFiles.onclick=async()=>{try{if(await requireWrite())ui.files.click()}catch(error){message(readableError(error))}};
ui.files.onchange=async()=>{const files=[...ui.files.files];ui.files.value='';if(!files.length)return;let added=0,failed=0;for(const file of files){try{const name=file.name;try{await current().getFileHandle(name);if(!confirm(`« ${name} » existe déjà. Le remplacer ?`))continue}catch(error){if(error.name!=='NotFoundError')throw error}const handle=await current().getFileHandle(name,{create:true});const stream=await handle.createWritable();await stream.write(file);await stream.close();added++}catch(error){failed++;message(`Import impossible pour « ${file.name} » : ${readableError(error)}`)}}if(!failed)message(`${added} document(s) ajouté(s).`);await render()};
$('#choose').onclick=choose;ui.up.onclick=()=>{if(trail.length){trail.pop();render()}};ui.search.oninput=()=>render();$('#foldersToggle').onclick=()=>{const panel=$('#folderPanel');panel.classList.toggle('open');$('#foldersToggle').setAttribute('aria-expanded',String(panel.classList.contains('open')))};
(async()=>{if(!window.showDirectoryPicker){message('Ouvre cette application dans Chrome ou Edge sur HTTPS pour accéder à un dossier local.');render();return}try{const saved=await recalled();if(saved){root=saved;if(await permission(root)){message('Dossier précédent retrouvé.');await render()}else{root=null;message('Sélectionne à nouveau ton dossier pour autoriser son accès.');render()}}else render()}catch(error){message(readableError(error));render()}})();
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
  navigator.serviceWorker.register('sw.js?v=7',{updateViaCache:'none'}).catch(()=>{
    message('Le mode hors connexion n’est pas disponible. Recharge la page avec une connexion Internet.');
  });
}
