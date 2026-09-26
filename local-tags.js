'use strict';
// Metadata stays in this browser. Documents are never uploaded or modified.
window.BibleTags = (() => {
  function normalize(value) {
    const seen = new Set();
    return value.split(',').map(tag => tag.trim()).filter(tag => {
      const key = tag.toLocaleLowerCase('fr');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function key(path, name) { return JSON.stringify([...path.map(handle => handle.name), name]); }
  function open() {
    return new Promise((resolve,reject) => {
      const request = indexedDB.open('bible-qsse-tags',1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('libraries',{keyPath:'id'});
        const documents=request.result.createObjectStore('documents',{keyPath:'id'});
        documents.createIndex('library','library');
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }
  async function records(store,index,value) {
    const db=await open();
    try { return await new Promise((resolve,reject)=>{
      const object=db.transaction(store).objectStore(store);
      const request=index?object.index(index).getAll(value):object.getAll();
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    }); } finally { db.close(); }
  }
  async function put(store,value) {
    const db=await open();
    try { await new Promise((resolve,reject)=>{
      const tx=db.transaction(store,'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete=resolve;
      tx.onabort=()=>reject(tx.error||new Error('Enregistrement interrompu'));
      tx.onerror=()=>reject(tx.error);
    }); } finally { db.close(); }
  }
  async function load(handle) {
    const libraries=await records('libraries');
    let library;
    for (const candidate of libraries) {
      try { if(await candidate.handle.isSameEntry(handle)){library=candidate;break;} }
      catch { /* Removed or inaccessible former directory. */ }
    }
    if(!library){library={id:crypto.randomUUID(),handle};await put('libraries',library);}
    const documents=await records('documents','library',library.id);
    return {id:library.id,tags:new Map(documents.map(doc=>[doc.path,doc.tags]))};
  }
  async function save(library,path,tags) {
    await put('documents',{id:[library,path],library,path,tags});
  }
  return {normalize,key,load,save};
})();
