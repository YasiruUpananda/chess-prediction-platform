import {useEffect,useRef} from 'react';
export default function ReaderMoves({labels,cursor,loaded,onMove,tree,path,onVariation}) {
  const active=useRef(null);
  const viewport=useRef(null);
  useEffect(()=>{
    const follow=()=>{
      if(!active.current || !viewport.current?.clientHeight)return;
      const move=active.current.getBoundingClientRect(),pane=viewport.current.getBoundingClientRect();
      if(move.bottom>pane.bottom)viewport.current.scrollTop+=move.bottom-pane.bottom;
      else if(move.top<pane.top)viewport.current.scrollTop-=pane.top-move.top;
    };
    follow();const observer=new ResizeObserver(follow);
    if(viewport.current)observer.observe(viewport.current);
    return()=>observer.disconnect();
  },[cursor]);
  const rows=[];
  labels.forEach((label,index)=>{
    const match=/^(\d+)(\.\.\.|\.)\s+(.*)$/.exec(label);
    const number=match?.[1] || String(index+1), side=match?.[2]==='...'?'black':'white';
    let row=rows.at(-1);if(!row || row.number!==number){row={number};rows.push(row);}
    row[side]={label,san:match?.[3] || label,index};
  });
  const branches=[];
  let node=tree;
  for(let ply=0;node && ply<=path.length;ply++) {
    if(node.children.length>1) branches.push({ply,choices:node.children.filter(child=>child.uci!==path[ply])});
    node=node.children.find(child=>child.uci===path[ply]);
  }
  return <div className="reader-move-scroll" ref={viewport}>
    <table className="reader-move-table"><caption className="sr-only">Book moves by move number, White and Black</caption>
      <thead><tr><th scope="col">Move</th><th scope="col">White</th><th scope="col">Black</th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.number}><th scope="row">{row.number}.</th>{['white','black'].map(side=>{
        const move=row[side],current=loaded && move?.index===cursor-1;
        return <td key={side}>{move && <button type="button" ref={current?active:undefined} className={`reader-move-chip${current?' is-current':''}`}
          aria-label={move.label} aria-current={current?'step':undefined} onClick={()=>onMove(move.index+1)}>{move.san}</button>}</td>;
      })}</tr>)}</tbody>
    </table>
    {branches.length>0 && <details className="reader-variation-list"><summary>Variations ({branches.reduce((count,branch)=>count+branch.choices.length,0)})</summary>
      {branches.map(branch=><div key={branch.ply} className="reader-variation-row"><span>After ply {branch.ply}</span>
        {branch.choices.map(choice=><button className="reader-secondary-button" type="button" key={choice.uci} onClick={()=>onVariation(branch.ply,choice)}>{choice.san}</button>)}</div>)}
    </details>}
  </div>;
}
