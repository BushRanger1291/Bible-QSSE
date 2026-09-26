'use strict';
window.BiblePDF=(()=>{
  const el=id=>document.getElementById(id);
  const ui=Object.fromEntries(['Dialog','Title','Export','Original','Close','Prev','Next','Page','Total','Zoom','Read','Highlight','Area','Note','Color','Undo','Scroll','Stage','Canvas','Text','Marks','Draw','Annotations','AnnotationCount','Status','NoteDialog','NoteForm','NoteText','NoteSave','NoteCancel'].map(name=>[name,el('pdf'+name)]));
  let enginePromise,session=null,openToken=0,renderToken=0,renderTask=null,textLayer=null,selected=[],drag=null,noteDraft=null;
  const engine=()=>enginePromise ||= import('./pdf-engine.mjs?v=9').catch(error=>{enginePromise=null;throw error});
  const status=(text,error=false)=>{ui.Status.textContent=text;ui.Status.classList.toggle('error',error)};
  function download(bytes,name,type='application/pdf'){
    const url=URL.createObjectURL(new Blob([bytes],{type})),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),120000);
  }
  function controls(){
    const ready=!!session?.doc&&!session.loading;
    for(const key of ['Prev','Next','Page','Zoom','Read','Highlight','Area','Note','Color','Export'])ui[key].disabled=!ready;
    if(ready){ui.Prev.disabled=session.page<=1;ui.Next.disabled=session.page>=session.doc.numPages}
    ui.Undo.disabled=!ready||!session?.history.length||session?.saving;
    ui.Original.disabled=!session?.bytes;
  }
  function mode(value){if(!session)return;session.mode=value;ui.Draw.classList.toggle('active',value!=='read');ui.Read.setAttribute('aria-pressed',String(value==='read'));ui.Area.setAttribute('aria-pressed',String(value==='area'));ui.Note.setAttribute('aria-pressed',String(value==='note'));status(value==='area'?'Trace une zone à surligner avec le doigt ou la souris.':value==='note'?'Touche la page pour placer une note.':'Sélectionne du texte, puis « Surligner la sélection ».')}
  function viewportRect(rect){const a=session.viewport.convertToViewportPoint(rect[0],rect[1]),b=session.viewport.convertToViewportPoint(rect[2],rect[3]);return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1])];}
  function marks(){
    ui.Marks.replaceChildren();ui.Annotations.replaceChildren();if(!session?.viewport)return;
    ui.AnnotationCount.textContent='Annotations ('+session.items.length+')';
    for(const item of session.items){
      if(item.page===session.page){
        if(item.type==='highlight')for(const rect of item.rects){const [x,y,w,h]=viewportRect(rect),mark=document.createElement('div');mark.className='pdfMark';Object.assign(mark.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px','--mark-color':{yellow:'#ffe033',green:'#4ee680',pink:'#ff59a6'}[item.color]||'#ffe033'});ui.Marks.append(mark)}
        else {const [x,y]=session.viewport.convertToViewportPoint(...item.point),pin=document.createElement('button');pin.type='button';pin.className='pdfNotePin';pin.textContent='N';pin.setAttribute('aria-label','Modifier la note : '+item.text);pin.title=item.text;pin.style.left=x+'px';pin.style.top=y+'px';pin.onclick=()=>editNote(item);ui.Marks.append(pin)}
      }
      const li=document.createElement('li'),jump=document.createElement('button'),text=document.createElement('p'),remove=document.createElement('button');jump.type=remove.type='button';jump.textContent='Page '+item.page;jump.onclick=()=>go(item.page);text.textContent=item.type==='note'?item.text:('Surlignage '+({yellow:'jaune',green:'vert',pink:'rose'}[item.color]||'jaune'));remove.textContent='Supprimer';remove.onclick=()=>commit(session.items.filter(entry=>entry.id!==item.id));li.append(jump,text);
      if(item.type==='note'){const edit=document.createElement('button');edit.type='button';edit.textContent='Modifier';edit.onclick=()=>editNote(item);li.append(edit)}li.append(remove);ui.Annotations.append(li);
    }
    for(const note of session.nativeNotes||[]){const li=document.createElement('li'),title=document.createElement('strong'),text=document.createElement('p');title.textContent='Note du PDF · page '+session.page;text.textContent=note;li.append(title,text);ui.Annotations.append(li)}
    controls();
  }
  async function commit(items,undo=false){
    const s=session;if(!s||s.saving)return false;s.saving=true;controls();
    try{await PDFStore.saveAnnotations(s.fingerprint,items);if(session!==s)return false;if(!undo){s.history.push(s.items);if(s.history.length>30)s.history.shift()}s.items=items;marks();status('Annotations enregistrées sur cet appareil.');return true}
    catch{status('Enregistrement impossible sur cet appareil. Aucune nouvelle annotation n’a été ajoutée.',true);return false}
    finally{s.saving=false;controls()}
  }
  async function render(){
    const s=session;if(!s?.doc)return;const token=++renderToken;s.loading=true;controls();selected=[];window.getSelection()?.removeAllRanges();ui.Draw.replaceChildren();drag=null;
    try{
      renderTask?.cancel();textLayer?.cancel();await renderTask?.promise.catch(()=>{});if(session!==s||token!==renderToken)return;
      const page=await s.doc.getPage(s.page);if(session!==s||token!==renderToken)return;
      const base=page.getViewport({scale:1});const scale=ui.Zoom.value==='fit'?Math.min(2,Math.max(.25,(ui.Scroll.clientWidth-36)/base.width)):Number(ui.Zoom.value);
      s.viewport=page.getViewport({scale});const viewport=s.viewport,dpr=Math.min(window.devicePixelRatio||1,2);
      ui.Stage.style.width=viewport.width+'px';ui.Stage.style.height=viewport.height+'px';ui.Stage.style.setProperty('--total-scale-factor',String(viewport.scale*viewport.userUnit));
      ui.Canvas.width=Math.ceil(viewport.width*dpr);ui.Canvas.height=Math.ceil(viewport.height*dpr);ui.Canvas.style.width=viewport.width+'px';ui.Canvas.style.height=viewport.height+'px';ui.Text.replaceChildren();ui.Text.removeAttribute('data-main-rotation');
      renderTask=page.render({canvasContext:ui.Canvas.getContext('2d'),viewport,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null});await renderTask.promise;if(session!==s||token!==renderToken)return;
      const content=await page.getTextContent();if(session!==s||token!==renderToken)return;
      textLayer=new s.engine.pdfjs.TextLayer({textContentSource:content,container:ui.Text,viewport});await textLayer.render();if(session!==s||token!==renderToken)return;
      const existing=await page.getAnnotations();if(session!==s||token!==renderToken)return;s.nativeNotes=existing.filter(item=>['Text','FreeText'].includes(item.subtype)&&item.contentsObj?.str).map(item=>item.contentsObj.str);
      ui.Page.value=s.page;ui.Total.textContent='/ '+s.doc.numPages;ui.Page.max=s.doc.numPages;marks();
      status(content.items.some(item=>item.str?.trim())?'Sélectionne du texte pour le surligner, ou utilise les outils Zone et Note.':'Cette page ne contient pas de texte sélectionnable. Utilise « Surligner une zone » ou « Ajouter une note ».');
    }catch(error){if(token===renderToken&&session===s&&error.name!=='RenderingCancelledException')status('Lecture de la page impossible : '+error.message,true)}
    finally{if(session===s&&token===renderToken){s.loading=false;controls()}}
  }
  async function go(page){if(!session?.doc)return;session.page=Math.min(session.doc.numPages,Math.max(1,Math.floor(Number(page)||1)));ui.Scroll.scrollTop=0;await render()}
  async function open(file,{startPage=1}={}){
    const token=++openToken;++renderToken;renderTask?.cancel();textLayer?.cancel();const old=session;session=null;await old?.doc?.destroy().catch(()=>{});
    ui.Title.textContent=file.name;ui.Canvas.width=ui.Canvas.height=0;ui.Stage.style.width=ui.Stage.style.height='0px';ui.Text.replaceChildren();ui.Marks.replaceChildren();ui.Annotations.replaceChildren();ui.Zoom.value='fit';ui.AnnotationCount.textContent='Annotations (0)';ui.Total.textContent='/ 0';ui.Page.value='1';if(!ui.Dialog.open)ui.Dialog.showModal();status('Ouverture du PDF…');controls();
    try{
      const bytes=await file.arrayBuffer(),lib=await engine();if(token!==openToken)return;
      const s={file,bytes,engine:lib,doc:null,fingerprint:await lib.fingerprint(bytes),items:[],history:[],page:1,mode:'read',loading:true};session=s;controls();
      s.items=await PDFStore.annotations(s.fingerprint);s.doc=await lib.loadDocument(bytes);if(token!==openToken){await s.doc.destroy();return}
      s.page=Math.min(s.doc.numPages,Math.max(1,startPage));mode('read');await render();
    }catch(error){if(token===openToken){if(session)session.loading=false;controls();status(error.name==='PasswordException'?'Ce PDF est protégé par un mot de passe. Ouvre-le avec ton lecteur habituel.':'Ouverture impossible : '+error.message,true)}}
  }
  function close(){ui.NoteDialog.close();ui.Dialog.close()}
  ui.Dialog.addEventListener('close',()=>{++openToken;++renderToken;renderTask?.cancel();textLayer?.cancel();const s=session;session=null;selected=[];drag=null;s?.doc?.destroy().catch(()=>{});ui.Text.replaceChildren();ui.Marks.replaceChildren();ui.Canvas.width=ui.Canvas.height=0});
  ui.Close.onclick=close;ui.Prev.onclick=()=>go(session.page-1);ui.Next.onclick=()=>go(session.page+1);ui.Page.onchange=()=>go(ui.Page.value);ui.Zoom.onchange=render;
  ui.Read.onclick=()=>mode('read');ui.Area.onclick=()=>mode('area');ui.Note.onclick=()=>mode('note');
  document.addEventListener('selectionchange',()=>{
    if(!session?.viewport||!ui.Dialog.open)return;const selection=window.getSelection();if(!selection?.rangeCount||selection.isCollapsed)return;
    const range=selection.getRangeAt(0);if(!ui.Text.contains(range.commonAncestorContainer))return;
    const stage=ui.Stage.getBoundingClientRect(),sx=session.viewport.width/stage.width,sy=session.viewport.height/stage.height;
    selected=Array.from(range.getClientRects()).map(rect=>[Math.max(0,(rect.left-stage.left)*sx),Math.max(0,(rect.top-stage.top)*sy),Math.min(session.viewport.width,(rect.right-stage.left)*sx),Math.min(session.viewport.height,(rect.bottom-stage.top)*sy)]).filter(rect=>rect[2]-rect[0]>1&&rect[3]-rect[1]>1);
  });
  ui.Highlight.onpointerdown=event=>event.preventDefault();
  ui.Highlight.onclick=async()=>{if(!session?.viewport)return;if(!selected.length){status('Sélectionne d’abord le texte à surligner.',true);return}const item={id:crypto.randomUUID(),type:'highlight',page:session.page,color:ui.Color.value,rects:selected.map(rect=>session.engine.pdfRect(session.viewport,rect))};if(await commit([...session.items,item])){selected=[];window.getSelection()?.removeAllRanges()}};
  function position(event){const rect=ui.Draw.getBoundingClientRect();return [Math.max(0,Math.min(session.viewport.width,(event.clientX-rect.left)*session.viewport.width/rect.width)),Math.max(0,Math.min(session.viewport.height,(event.clientY-rect.top)*session.viewport.height/rect.height))]}
  ui.Draw.onpointerdown=event=>{
    if(!session?.viewport||session.loading||session.saving||session.mode==='read'||event.button!==0)return;event.preventDefault();const point=position(event);
    if(session.mode==='note'){const [x,y]=session.viewport.convertToPdfPoint(...point);editNote({id:crypto.randomUUID(),type:'note',page:session.page,point:[x,y],text:''});return}
    ui.Draw.setPointerCapture(event.pointerId);const node=document.createElement('div');node.className='pdfDrag';ui.Draw.append(node);drag={point,node,id:event.pointerId};
  };
  ui.Draw.onpointermove=event=>{if(!drag||event.pointerId!==drag.id)return;const end=position(event),[x,y]=drag.point;Object.assign(drag.node.style,{left:Math.min(x,end[0])+'px',top:Math.min(y,end[1])+'px',width:Math.abs(end[0]-x)+'px',height:Math.abs(end[1]-y)+'px'})};
  ui.Draw.onpointerup=async event=>{if(!drag||event.pointerId!==drag.id)return;const start=drag.point,end=position(event);drag.node.remove();drag=null;ui.Draw.releasePointerCapture(event.pointerId);if(Math.abs(end[0]-start[0])<4||Math.abs(end[1]-start[1])<4)return;await commit([...session.items,{id:crypto.randomUUID(),type:'highlight',page:session.page,color:ui.Color.value,rects:[session.engine.pdfRect(session.viewport,[...start,...end])]}])};
  ui.Draw.onpointercancel=()=>{drag?.node.remove();drag=null};
  function editNote(item){if(session?.saving)return;noteDraft=item;ui.NoteText.value=item.text;ui.NoteDialog.showModal();ui.NoteText.focus()}
  ui.NoteCancel.onclick=()=>ui.NoteDialog.close();
  ui.NoteForm.onsubmit=async event=>{event.preventDefault();if(!noteDraft||!session)return;const text=ui.NoteText.value.trim();if(!text)return;ui.NoteSave.disabled=true;try{const next=session.items.filter(item=>item.id!==noteDraft.id);next.push({...noteDraft,text});if(await commit(next))ui.NoteDialog.close()}finally{ui.NoteSave.disabled=false}};
  ui.Undo.onclick=async()=>{if(!session?.history.length)return;const previous=session.history.at(-1);if(await commit(previous,true)){session.history.pop();controls()}};
  ui.Original.onclick=()=>{if(session?.bytes)download(session.bytes,session.file.name)};
  ui.Export.onclick=async()=>{const s=session;if(!s?.doc)return;ui.Export.disabled=true;status('Préparation de la copie annotée…');try{const data=await s.engine.exportAnnotated(s.bytes,structuredClone(s.items));download(data,s.file.name.replace(/\.pdf$/i,'')+' — annoté.pdf');status('Copie annotée préparée. Le téléchargement a été demandé.')}catch(error){status('Export impossible : '+error.message,true)}finally{controls()}};
  let resizeTimer;window.addEventListener('resize',()=>{if(session?.doc&&ui.Zoom.value==='fit'){clearTimeout(resizeTimer);resizeTimer=setTimeout(render,180)}});
  return {open,engine};
})();
