import {useEffect,useState} from 'react';
import {authenticatedRequest,friendlyError} from './api';

export default function EvidenceReferences({player,color,version,statistic}) {
  const [open,setOpen]=useState(false);
  const [offset,setOffset]=useState(0);
  const [page,setPage]=useState(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController();
    const params=new URLSearchParams({player,color,version,statistic_id:statistic.id,offset:String(offset),limit:'25'});
    authenticatedRequest(`/api/v1/evidence/references?${params}`,{signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted)setPage(result);}).catch(error=>{if(!controller.signal.aborted)setError(friendlyError(error));});
    return()=>controller.abort();
  },[open,offset,player,color,version,statistic.id]);
  return <div>
    <p>Showing {statistic.game_ids.length} sample references of {statistic.games} games.</p>
    <button className="text-button" type="button" onClick={()=>{setOpen(!open);setPage(null);setError('');}}>{open?'Hide':'Browse all'} references</button>
    {open && <div aria-live="polite">
      {error?<p role="alert">{error}</p>:!page?<p>Loading references…</p>:<>
        <ul>{page.games.map(game=><li key={game.id}>{game.white} — {game.black}<br/><code>{game.id}</code></li>)}</ul>
        <button type="button" className="text-button" disabled={!offset} onClick={()=>{setOffset(Math.max(0,offset-25));setPage(null);setError('');}}>Previous references</button>
        <button type="button" className="text-button" disabled={offset+25>=page.total} onClick={()=>{setOffset(offset+25);setPage(null);setError('');}}>Next references</button>
      </>}
    </div>}
  </div>;
}
