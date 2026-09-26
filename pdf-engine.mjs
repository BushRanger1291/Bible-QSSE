import './pdf-highlight-touch-v11.js';
import * as pdfjs from './vendor/pdf.min.mjs';
import {PDFDocument,PDFName,PDFHexString,PDFString,rgb,BlendMode,StandardFonts} from './vendor/pdf-lib.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.min.mjs',import.meta.url).href;
export {pdfjs};
export async function loadDocument(bytes) {
  const task=pdfjs.getDocument({
    data:new Uint8Array(bytes.slice(0)),
    standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href,
    isEvalSupported:false,
    useWasm:false,
    verbosity:pdfjs.VerbosityLevel.ERRORS,
  });
  try { const document=await task.promise; document.destroy=()=>task.destroy(); return document; }
  catch(error) { await task.destroy(); throw error; }
}
export async function fingerprint(bytes) {
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
}
export function fold(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').replace(/\s+/g,' ').trim();
}
export async function extractText(bytes,progress=()=>{},signal) {
  let doc;
  try {
    doc=await loadDocument(bytes);
    const pages=[];
    for(let page=1;page<=doc.numPages;page++){
      if(signal?.aborted)throw new DOMException('Indexation arrêtée','AbortError');
      const source=await doc.getPage(page);
      const content=await source.getTextContent();
      pages.push(content.items.map(item=>item.str||'').join(' ').replace(/\s+/g,' ').trim());
      source.cleanup();progress(page,doc.numPages);
    }
    return pages;
  } finally {await doc?.destroy()}
}
export const colors={yellow:[1,.85,.1],green:[.3,.9,.5],pink:[1,.35,.65]};
export function pdfRect(viewport,rect) {
  const a=viewport.convertToPdfPoint(rect[0],rect[1]),b=viewport.convertToPdfPoint(rect[2],rect[3]);
  return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
}
export async function exportAnnotated(bytes,annotations) {
  const pdf=await PDFDocument.load(bytes);
  const font=await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages=pdf.getPages();
  for(const item of annotations){
    const page=pages[item.page-1];if(!page)continue;
    if(item.type==='highlight'){
      for(const rect of item.rects){
        page.drawRectangle({x:rect[0],y:rect[1],width:rect[2]-rect[0],height:rect[3]-rect[1],color:rgb(...(colors[item.color]||colors.yellow)),opacity:.35,blendMode:BlendMode.Multiply});
      }
    } else if(item.type==='note') {
      const [x,y]=item.point;
      page.drawRectangle({x,y:y-18,width:18,height:18,color:rgb(1,.8,.1),borderColor:rgb(.5,.3,0),borderWidth:.5});
      page.drawText('N',{x:x+4,y:y-14,size:11,font,color:rgb(.2,.15,0)});
      const annotation=pdf.context.obj({Type:'Annot',Subtype:'Text',Rect:[x,y-18,x+18,y],Contents:PDFHexString.fromText(item.text),T:PDFHexString.fromText('Bible QSSE'),Name:'Note',C:[1,.8,.1],F:4,Open:false,NM:PDFString.of(item.id)});
      page.node.addAnnot(pdf.context.register(annotation));
    }
  }
  return pdf.save();
}
