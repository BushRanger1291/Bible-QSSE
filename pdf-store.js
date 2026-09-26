'use strict';
// All extracted text and annotations stay in IndexedDB on this device.
window.PDFStore = (() => {
  let connection;
  function db() {
    return connection ||= new Promise((resolve,reject) => {
      const request=indexedDB.open('bible-qsse-pdf',1);
      request.onupgradeneeded=()=>{
        request.result.createObjectStore('annotations',{keyPath:'fingerprint'});
        const index=request.result.createObjectStore('text',{keyPath:'id'});
        index.createIndex('library','library');
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>{connection=null;reject(request.error)};
    });
  }
  async function read(store,key,index) {
    const database=await db();
    return new Promise((resolve,reject)=>{
      const source=database.transaction(store).objectStore(store);
      const request=index?source.index(index).getAll(key):source.get(key);
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }
  async function write(store,record) {
    const database=await db();
    return new Promise((resolve,reject)=>{
      const tx=database.transaction(store,'readwrite');
      tx.objectStore(store).put(record);
      tx.oncomplete=resolve;
      tx.onabort=()=>reject(tx.error||new Error('Enregistrement interrompu'));
      tx.onerror=()=>reject(tx.error);
    });
  }
  return {
    annotations:async fingerprint=>(await read('annotations',fingerprint))?.items||[],
    saveAnnotations:(fingerprint,items)=>write('annotations',{fingerprint,items}),
    index:async library=>new Map((await read('text',library,'library')).map(record=>[record.path,record])),
    saveText:(library,path,file,pages)=>write('text',{id:[library,path],library,path,size:file.size,modified:file.lastModified,pages}),
    keepPaths:async(library,paths)=>{
      const database=await db();const keep=new Set(paths);
      return new Promise((resolve,reject)=>{
        const tx=database.transaction('text','readwrite');
        const request=tx.objectStore('text').index('library').openCursor(library);
        request.onsuccess=()=>{const cursor=request.result;if(cursor){if(!keep.has(cursor.value.path))cursor.delete();cursor.continue()}};
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
      });
    },
    matches:(record,file)=>record?.size===file.size&&record?.modified===file.lastModified,
  };
})();
