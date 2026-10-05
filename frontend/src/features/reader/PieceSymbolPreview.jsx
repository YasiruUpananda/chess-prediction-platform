import { useEffect, useRef, useState } from 'react';

export default function PieceSymbolPreview({ document, pageNumber, symbol }) {
  const canvas=useRef(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let cancelled=false, task;
    document.getPage(pageNumber).then(async(page)=>{
      if(cancelled) return;
      const viewport=page.getViewport({scale:3});
      const [a,b,c,d,e,f]=viewport.transform;
      const point=(x,y)=>[a*x+c*y+e,b*x+d*y+f];
      const rect=[...point(symbol.x,symbol.y),...point(symbol.x+symbol.width,symbol.y+symbol.height)];
      const x=Math.min(rect[0],rect[2])-5,y=Math.min(rect[1],rect[3])-5;
      const width=Math.min(256,Math.max(24,Math.ceil(Math.abs(rect[2]-rect[0])+10)));
      const height=Math.min(256,Math.max(24,Math.ceil(Math.abs(rect[3]-rect[1])+10)));
      const target=canvas.current;if(!target) return;
      target.width=width;target.height=height;
      task=page.render({canvas:target,viewport,transform:[1,0,0,1,-x,-y]});
      await task.promise;
      if(!cancelled)setError('');
    }).catch(()=>{if(!cancelled)setError('Printed preview unavailable. Compare with the page.');});
    return ()=>{cancelled=true;task?.cancel();};
  },[document,pageNumber,symbol]);
  return <span className="reader-symbol-preview"><canvas ref={canvas} role="img" hidden={Boolean(error)} aria-label={`Printed ${symbol.glyph} symbol in font ${symbol.fontName}`} />{error && <small>{error}</small>}</span>;
}
