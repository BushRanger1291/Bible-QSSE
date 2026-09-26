const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');const {indexedDB}=require('fake-indexeddb');
const rootPath=path.resolve(__dirname,'..');
const dirs=new Map();
class Dir{constructor(id,name,children=[]){this._testDirId=id;this.name=name;this.kind='directory';this.children=children;dirs.set(id,this)}async *entries(){for(const child of this.children)yield [child.name,child]}async queryPermission(){return 'granted'}async requestPermission(){return 'granted'}async isSameEntry(other){return this._testDirId===other._testDirId}}
class FileHandle{constructor(name,contents){this.name=name;this.kind='file';this.contents=contents;this.modified=1}async getFile(){return {name:this.name,size:this.contents.length,lastModified:this.modified,arrayBuffer:async()=>new TextEncoder().encode(this.contents).buffer}}}
const manual=new FileHandle('manuel.pdf','Page une.\nProcédure evacuation et sécurité incendie.'),scan=new FileHandle('scan.pdf','');
const primary=new Dir('one','Bible QSSE',[manual,new Dir('sub','Formation',[scan])]);
const other=new Dir('two','Bible QSSE',[new FileHandle('manuel.pdf','Autre bibliothèque')]);
const nativeClone=global.structuredClone;
global.structuredClone=value=>{const clone=nativeClone(value);const restore=v=>{if(v&&typeof v==='object'){if(v._testDirId)return dirs.get(v._testDirId);for(const k of Object.keys(v))v[k]=restore(v[k])}return v};return restore(clone)};
const wait=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10))}throw new Error('Timed out')};
function app(){const dom=new JSDOM(fs.readFileSync(path.join(rootPath,'index.html'),'utf8'),{url:'https://example.test/Bible-QSSE/',runScripts:'outside-only'});const w=dom.window;w.indexedDB=indexedDB;w.matchMedia=()=>({matches:false});w.showDirectoryPicker=async()=>primary;w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.BiblePDF={engine:async()=>({extractText:async(bytes,progress)=>{progress(1,1);return new TextDecoder().decode(bytes).split('\n')}}),open:async(file,options)=>{w.lastOpened={file,options}}};for(const script of ['local-tags.js','pdf-store.js','app.js'])w.eval(fs.readFileSync(path.join(rootPath,script),'utf8'));return dom}
test('library flow: tags, list, content indexing, page navigation and persistence',async()=>{
 let dom=app(),w=dom.window,d=w.document;
 try{
  await wait(()=>d.querySelector('.empty'));d.querySelector('#choose').click();await wait(()=>d.querySelectorAll('.card').length===2);
  d.querySelector('#listView').click();await wait(()=>[...d.querySelectorAll('.grid.list .meta')].some(el=>el.textContent.includes('o')));assert.equal(d.querySelector('#listView').getAttribute('aria-pressed'),'true');
  d.querySelector('.tagEdit').click();d.querySelector('#tagInput').value='Incendie, SUVA, incendie';d.querySelector('#tagForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await wait(()=>d.querySelectorAll('.tagChip').length===2);
  d.querySelector('#indexPdfs').click();await wait(()=>d.querySelector('#indexStatus').textContent.includes('OCR nécessaire'));
  d.querySelector('#search').value='evacuation';d.querySelector('#search').dispatchEvent(new w.Event('input'));await wait(()=>d.querySelector('#status').textContent.startsWith('1 résultat'));assert.match(d.querySelector('.searchExcerpt').textContent,/page 2/);
  d.querySelector('.openDoc').click();await wait(()=>w.lastOpened);assert.equal(w.lastOpened.options.startPage,2);
  dom.window.close();dom=app();w=dom.window;d=w.document;await wait(()=>d.querySelectorAll('.tagChip').length===2);assert.match(d.querySelector('#indexStatus').textContent,/2 PDF indexé/);
  w.showDirectoryPicker=async()=>other;d.querySelector('#choose').click();await wait(()=>d.querySelectorAll('.card').length===1&&d.querySelectorAll('.tagChip').length===0);assert.match(d.querySelector('#indexStatus').textContent,/Indexe les PDF/);
  w.showDirectoryPicker=async()=>primary;d.querySelector('#choose').click();await wait(()=>d.querySelectorAll('.tagChip').length===2);
  manual.contents='Nouveau texte';manual.modified=2;d.querySelector('#search').value='evacuation';d.querySelector('#search').dispatchEvent(new w.Event('input'));await wait(()=>d.querySelector('#status').textContent.startsWith('0 résultat'));
  d.querySelector('#search').value='';d.querySelector('#search').dispatchEvent(new w.Event('input'));await wait(()=>d.querySelector('.tagEdit'));d.querySelector('.tagEdit').click();d.querySelector('#tagInput').value='';d.querySelector('#tagForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await wait(()=>!d.querySelector('#tagDialog').open&&d.querySelectorAll('.tagChip').length===0);
 }finally{dom.window.close();global.structuredClone=nativeClone}
});
