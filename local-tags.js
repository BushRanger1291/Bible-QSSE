'use strict';
// Tags, note references and their catalogue stay in this browser.
window.BibleTags = (() => {
  const locale='fr';
  function clean(value){return String(value||'').trim().replace(/\s+/g,' ')}
  function singular(value){return value.length>4&&value.endsWith('s')&&!value.endsWith('ss')&&!['temps','processus'].includes(value.toLocaleLowerCase(locale))?value.slice(0,-1):value}
  function normalizedKey(value){
    let key=clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase(locale);
    key=singular(key);
    return key;
  }
  function display(value){const text=singular(clean(value));return text?text[0].toLocaleUpperCase(locale)+text.slice(1):''}
  function normalize(value,catalog=new Map()){
    const source=(Array.isArray(value)?value:[value]).flatMap(item=>String(item||'').split(',')),seen=new Set(),result=[];
    for(const raw of source){const tagKey=normalizedKey(raw);if(!tagKey||seen.has(tagKey))continue;seen.add(tagKey);result.push(catalog.get(tagKey)||display(raw))}
    return result;
  }
  function key(path,name){return JSON.stringify([...path.map(handle=>handle.name),name])}
  function open(){
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open('bible-qsse-tags',2);
      request.onupgradeneeded=()=>{
        const database=request.result;
        if(!database.objectStoreNames.contains('libraries'))database.createObjectStore('libraries',{keyPath:'id'});
        if(!database.objectStoreNames.contains('documents')){const documents=database.createObjectStore('documents',{keyPath:'id'});documents.createIndex('library','library')}
        if(!database.objectStoreNames.contains('catalog')){const catalog=database.createObjectStore('catalog',{keyPath:'id'});catalog.createIndex('library','library')}
        if(!database.objectStoreNames.contains('notes')){const notes=database.createObjectStore('notes',{keyPath:'id'});notes.createIndex('library','library')}
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }
  async function records(store,index,value){const database=await open();try{return await new Promise((resolve,reject)=>{const object=database.transaction(store).objectStore(store),request=index?object.index(index).getAll(value):object.getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}finally{database.close()}}
  async function put(store,value){const database=await open();try{await new Promise((resolve,reject)=>{const tx=database.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('Enregistrement interrompu'));tx.onerror=()=>reject(tx.error)})}finally{database.close()}}
  async function remove(store,id){const database=await open();try{await new Promise((resolve,reject)=>{const tx=database.transaction(store,'readwrite');tx.objectStore(store).delete(id);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error)})}finally{database.close()}}
  async function ensureCatalog(library,tags,current){
    const catalog=current||new Map((await records('catalog','library',library)).map(record=>[record.key,record.name]));
    for(const raw of tags||[]){const tag=clean(raw),tagKey=normalizedKey(tag);if(!tagKey||catalog.has(tagKey))continue;const name=display(tag);await put('catalog',{id:[library,tagKey],library,key:tagKey,name});catalog.set(tagKey,name)}
    return catalog;
  }
  async function load(handle){
    const libraries=await records('libraries');let library;
    for(const candidate of libraries){try{if(await candidate.handle.isSameEntry(handle)){library=candidate;break}}catch{}}
    if(!library){library={id:crypto.randomUUID(),handle};await put('libraries',library)}
    const [documents,catalogRecords,notes]=await Promise.all([records('documents','library',library.id),records('catalog','library',library.id),records('notes','library',library.id)]);
    const catalog=new Map(catalogRecords.map(record=>[record.key,record.name]));
    await ensureCatalog(library.id,[...documents.flatMap(record=>record.tags||[]),...notes.flatMap(note=>note.tags||[])],catalog);
    return {id:library.id,tags:new Map(documents.map(doc=>[doc.path,normalize(doc.tags,catalog)])),catalog,notes:notes.map(note=>({...note,tags:normalize(note.tags,catalog)}))};
  }
  async function save(library,path,tags){const catalog=await ensureCatalog(library,tags);const canonical=normalize(tags,catalog);await put('documents',{id:[library,path],library,path,tags:canonical});return canonical}
  async function saveNote(library,note){const catalog=await ensureCatalog(library,note.tags);const now=Date.now(),record={...note,id:note.id||crypto.randomUUID(),library,title:clean(note.title),text:clean(note.text),tags:normalize(note.tags,catalog),created:note.created||now,modified:now};await put('notes',record);return record}
  async function exportTags(library){return (await records('documents','library',library)).map(({path,tags})=>({path,tags}))}
  async function merge(library,items){const current=new Map((await records('documents','library',library)).map(record=>[record.path,record.tags]));for(const item of items||[]){if(typeof item.path!=='string'||!Array.isArray(item.tags))continue;await save(library,item.path,[...(current.get(item.path)||[]),...item.tags])}}
  async function mergeNotes(library,items){const current=new Map((await records('notes','library',library)).map(note=>[note.id,note]));for(const source of items||[]){if(!source?.id||!source.title||!source.documentKey)continue;const existing=current.get(source.id);if(existing&&(existing.modified||0)>(source.modified||0))continue;await saveNote(library,{...source,library})}}
  async function mergeCatalog(library,items){await ensureCatalog(library,(items||[]).map(item=>typeof item==='string'?item:item?.name).filter(Boolean))}
  return {
    normalize,normalizedKey,key,load,save,saveNote,deleteNote:id=>remove('notes',id),
    export:exportTags,exportNotes:library=>records('notes','library',library),exportCatalog:async library=>(await records('catalog','library',library)).map(({key,name})=>({key,name})),
    merge,mergeNotes,mergeCatalog
  };
})();
