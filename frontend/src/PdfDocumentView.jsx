import { Document, Page, pdfjs } from 'react-pdf';
import { useCallback, useRef, useState } from 'react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

export default function PdfDocumentView({ file, onLoadSuccess, onLoadError, pageNumber, width, geometryReady, safe, selecting, selection, onSelect, highlight }) {
  const surface=useRef(null), start=useRef(null);
  const [viewport,setViewport]=useState(null);
  const [drag,setDrag]=useState(null);
  const [selectionError,setSelectionError]=useState('');
  const [box,setBox]=useState({left:0,top:0,width:100,height:100});
  const loadedPage=useCallback(page=>setViewport(page.getViewport({scale:1})),[]);
  function pdfRegion(rect) {
    const bounds=surface.current.getBoundingClientRect(), v=viewport;
    if(!v) return null;
    const [a,b,c,d,e,f]=v.transform,det=a*d-b*c;
    const convert=(x,y)=>{
      x=Math.max(bounds.left,Math.min(bounds.right,x));
      y=Math.max(bounds.top,Math.min(bounds.bottom,y));
      x=(x-bounds.left)*v.width/bounds.width-e;y=(y-bounds.top)*v.height/bounds.height-f;
      return [(d*x-c*y)/det,(-b*x+a*y)/det];
    };
    const corners=[convert(rect.left,rect.top),convert(rect.right,rect.bottom)];
    return {x:Math.min(...corners.map(p=>p[0])),y:Math.min(...corners.map(p=>p[1])),width:Math.abs(corners[1][0]-corners[0][0]),height:Math.abs(corners[1][1]-corners[0][1])};
  }
  function overlay(region) {
    const v=viewport;if(!v || !region) return undefined;
    const [a,b,c,d,e,f]=v.transform;
    const corners=[[region.x,region.y],[region.x+region.width,region.y+region.height]].map(([x,y])=>[a*x+c*y+e,b*x+d*y+f]);
    return {left:`${100*Math.min(...corners.map(p=>p[0]))/v.width}%`,top:`${100*Math.min(...corners.map(p=>p[1]))/v.height}%`,width:`${100*Math.abs(corners[1][0]-corners[0][0])/v.width}%`,height:`${100*Math.abs(corners[1][1]-corners[0][1])/v.height}%`};
  }
  function selectText() {
    const selected=window.getSelection();
    if(!selected?.rangeCount || !surface.current.contains(selected.anchorNode)) {setSelectionError('Select text on this PDF page first.');return;}
    onSelect(pdfRegion(selected.getRangeAt(0).getBoundingClientRect()));setSelectionError('');
  }
  return <Document file={file} onLoadSuccess={onLoadSuccess} onLoadError={onLoadError}
    loading={<div className="reader-placeholder">Opening your PDF…</div>}>
    {geometryReady ? safe ? <><div className="pdf-selection-surface" ref={surface}>
      <Page pageNumber={pageNumber} width={width} onLoadSuccess={loadedPage}
        devicePixelRatio={Math.min(2, window.devicePixelRatio || 1)} renderAnnotationLayer renderTextLayer />
      {selecting && <div className="pdf-region-selector" aria-label="Drag around a move line"
        onPointerDown={event=>{start.current={x:event.clientX,y:event.clientY};event.currentTarget.setPointerCapture(event.pointerId);setDrag(null);}}
        onPointerMove={event=>{if(start.current)setDrag(pdfRegion({left:Math.min(start.current.x,event.clientX),right:Math.max(start.current.x,event.clientX),top:Math.min(start.current.y,event.clientY),bottom:Math.max(start.current.y,event.clientY)}));}}
        onPointerUp={event=>{const point=start.current;start.current=null;if(!point)return;const rect={left:Math.min(point.x,event.clientX),right:Math.max(point.x,event.clientX),top:Math.min(point.y,event.clientY),bottom:Math.max(point.y,event.clientY)};if(rect.right-rect.left>4 && rect.bottom-rect.top>4)onSelect(pdfRegion(rect));setDrag(null);}}
        onPointerCancel={()=>{start.current=null;setDrag(null);}} />}
      {selection && <div className="pdf-source-highlight" style={overlay(selection)} />}
      {highlight && <div className="pdf-source-highlight is-move" style={overlay(highlight)} />}
      {drag && <div className="pdf-source-highlight" style={overlay(drag)} />}
    </div><button className="reader-secondary-button" type="button" onClick={selectText}>Read selected PDF text</button>
    {selecting && <form className="reader-region-form" onSubmit={event=>{
      event.preventDefault();
      const bounds=surface.current.getBoundingClientRect();
      if(box.width<=0 || box.height<=0 || box.left+box.width>100 || box.top+box.height>100){setSelectionError('Keep the region within the page and use positive width and height.');return;}
      onSelect(pdfRegion({left:bounds.left+bounds.width*box.left/100,top:bounds.top+bounds.height*box.top/100,
        right:bounds.left+bounds.width*(box.left+box.width)/100,bottom:bounds.top+bounds.height*(box.top+box.height)/100}));setSelectionError('');
    }}><fieldset><legend>Choose a region with the keyboard (percent of page)</legend>
      {Object.entries(box).map(([key,value])=><label className="reader-field" key={key}>{key}<input type="number" required min="0" max="100" step="0.1" value={value} onChange={event=>setBox(current=>({...current,[key]:Number(event.target.value)}))} /></label>)}
      <button className="reader-secondary-button" type="submit">Read this region</button>
    </fieldset></form>}
    {selectionError && <p role="alert">{selectionError}</p>}</>
      : <p className="reader-error">Page dimensions exceed the rendering limit.</p>
      : <div className="reader-placeholder">Checking page dimensions…</div>}
  </Document>;
}
