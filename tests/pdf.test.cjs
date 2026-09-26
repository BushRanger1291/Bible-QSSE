const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {indexedDB}=require('fake-indexeddb');
const canvas=require('@napi-rs/canvas');
Object.assign(globalThis,{DOMMatrix:canvas.DOMMatrix,ImageData:canvas.ImageData,Path2D:canvas.Path2D});
const root=path.resolve(__dirname,'..');
let engine,bytes;
async function fixture(){
  if(bytes)return;
  engine=await import('../pdf-engine.mjs');
  const {PDFDocument,degrees}=await import('../vendor/pdf-lib.min.mjs');
  const pdf=await PDFDocument.create();
  const first=pdf.addPage([480,680]);
  first.drawText('Bible QSSE - Test',{x:45,y:620,size:22});
  first.drawText('Prevention incendie et evacuation.',{x:45,y:565,size:14});
  const second=pdf.addPage([480,680]);second.setRotation(degrees(90));
  second.drawText('Protection auditive : porter les EPI.',{x:45,y:565,size:14});
  pdf.addPage([480,680]);bytes=await pdf.save();
}
test('PDF extraction preserves page numbers, accents folding and empty scanned pages',async()=>{
  await fixture();
  const pages=await engine.extractText(bytes);
  assert.equal(pages.length,3);assert.match(pages[0],/incendie/);assert.match(pages[1],/auditive/);assert.equal(pages[2],'');
  assert.equal(engine.fold('  ÉVACUATION\n sécurisée  '),'evacuation securisee');
});
test('annotations export preserves source and produces visible highlights plus Unicode PDF notes',async()=>{
  await fixture();
  const before=await engine.fingerprint(bytes);
  const edited=await engine.exportAnnotated(bytes,[{id:'highlight',type:'highlight',page:1,color:'yellow',rects:[[45,560,350,582]]},{id:'note',type:'note',page:1,point:[380,600],text:'À vérifier : évacuation. Contrôle QSSE.'}]);
  assert.equal(await engine.fingerprint(bytes),before);
  const doc=await engine.loadDocument(edited);
  try{
    assert.equal(doc.numPages,3);
    const page=await doc.getPage(1),notes=await page.getAnnotations();
    assert.ok(notes.some(note=>note.subtype==='Text'&&note.contentsObj.str.includes('À vérifier')));
    const viewport=page.getViewport({scale:1}),surface=canvas.createCanvas(viewport.width,viewport.height);
    await page.render({canvasContext:surface.getContext('2d'),viewport}).promise;
    const [r,g,b]=surface.getContext('2d').getImageData(340,108,1,1).data;
    assert.ok(r>240&&g>200&&b<220,'yellow highlight is visible');
  } finally {await doc.destroy()}
});
test('highlight coordinates survive page rotation and zoom',async()=>{
  await fixture();const doc=await engine.loadDocument(bytes);
  try{const page=await doc.getPage(2),viewport=page.getViewport({scale:1.7});const original=[50,520,200,550];const a=viewport.convertToViewportPoint(original[0],original[1]),b=viewport.convertToViewportPoint(original[2],original[3]);const converted=engine.pdfRect(viewport,[...a,...b]);converted.forEach((value,i)=>assert.ok(Math.abs(value-original[i])<.001));}finally{await doc.destroy()}
});
test('cancelling extraction rejects without keeping a worker alive',async()=>{
  await fixture();const controller=new AbortController();controller.abort();await assert.rejects(engine.extractText(bytes,()=>{},controller.signal),{name:'AbortError'});
});
test('notes and text index survive reopening storage, and different libraries stay separate',async()=>{
  function store(){const context={window:{},indexedDB,Map,Promise,Error};vm.runInNewContext(fs.readFileSync(path.join(root,'pdf-store.js'),'utf8'),context);return context.window.PDFStore;}
  const one=store();await one.saveAnnotations('same-file',[{type:'note',text:'Vérifier'}]);
  await one.saveText('library-A','plan.pdf',{size:40,lastModified:10},['Texte important']);
  const two=store();assert.equal((await two.annotations('same-file'))[0].text,'Vérifier');
  assert.equal((await two.index('library-A')).get('plan.pdf').pages[0],'Texte important');assert.equal((await two.index('library-B')).size,0);
  const record=(await two.index('library-A')).get('plan.pdf');assert.equal(two.matches(record,{size:40,lastModified:10}),true);assert.equal(two.matches(record,{size:41,lastModified:10}),false);
});
