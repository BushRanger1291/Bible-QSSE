'use strict';
(()=>{
  let savedRange=null;
  const pages=document.getElementById('pdfPages');
  const highlight=document.getElementById('pdfHighlight');
  if(!pages||!highlight)return;

  function rememberSelection(){
    const selection=window.getSelection();
    if(!selection?.rangeCount||selection.isCollapsed)return;
    const range=selection.getRangeAt(0);
    const common=range.commonAncestorContainer.nodeType===Node.TEXT_NODE?range.commonAncestorContainer.parentElement:range.commonAncestorContainer;
    if(common?.closest?.('.pdfPage')&&pages.contains(common.closest('.pdfPage'))){
      savedRange=range.cloneRange();
    }
  }

  function restoreSelection(){
    if(!savedRange)return;
    const selection=window.getSelection();
    try{
      selection.removeAllRanges();
      selection.addRange(savedRange.cloneRange());
    }catch{savedRange=null}
  }

  document.addEventListener('selectionchange',rememberSelection);
  pages.addEventListener('pointerup',()=>setTimeout(rememberSelection,0),{passive:true});
  pages.addEventListener('touchend',()=>setTimeout(rememberSelection,0),{passive:true});

  highlight.addEventListener('pointerdown',event=>{
    restoreSelection();
    event.preventDefault();
  },true);
  highlight.addEventListener('touchstart',event=>{
    restoreSelection();
    event.preventDefault();
  },{capture:true,passive:false});
  highlight.addEventListener('click',()=>{
    setTimeout(()=>{savedRange=null},0);
  });
})();
