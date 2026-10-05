import {useEffect,useState} from 'react';
import {requestJson,friendlyError} from './api';
type Coverage={name:string;fide_id:string|null;federation:string|null;groups:{color:string;date:string|null;event:string|null;games:number}[];limit:number};
export default function PlayerCoverage({id}:{id?:string|null}) {
 const [result,setResult]=useState<Coverage|null>(null),[error,setError]=useState('');
 useEffect(()=>{if(!id)return;const controller=new AbortController();
  requestJson(`/api/v1/players/${encodeURIComponent(id)}/coverage`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setResult(value as Coverage);}).catch(error=>{if(!controller.signal.aborted)setError(friendlyError(error));});
  return()=>controller.abort();
 },[id]);
 if(!id)return null;
 return <details className="player-coverage"><summary>Game coverage by date, color and tournament</summary>
  {error?<p role="alert">{error}</p>:result?<><p>{result.name} · {result.fide_id?'FIDE '+result.fide_id:'Provisional identity'} · {result.federation || 'Federation unknown'}</p>
   <table><caption>Most recent {result.limit} coverage groups</caption><thead><tr><th scope="col">Date</th><th scope="col">Color</th><th scope="col">Tournament</th><th scope="col">Games</th></tr></thead>
    <tbody>{result.groups.map((row,index)=><tr key={index}><td>{row.date || 'Unknown'}</td><td>{row.color}</td><td>{row.event || 'Unknown'}</td><td>{row.games}</td></tr>)}</tbody></table></>:<p role="status">Loading coverage…</p>}
 </details>;
}
