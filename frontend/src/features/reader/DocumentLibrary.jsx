import {useEffect,useState} from 'react';
import {listSessions} from './readingSession';
export default function DocumentLibrary({owner,refresh}) {
  const [documents,setDocuments]=useState([]);
  useEffect(()=>{let cancelled=false;listSessions(owner).then(items=>{if(!cancelled)setDocuments(items);}).catch(()=>{});return()=>{cancelled=true;};},[owner,refresh]);
  if(!documents.length)return null;
  return <section className="reader-library" aria-label="Recent books"><h3>Recent books on this device</h3>
    <p>Select the original PDF above to resume. Documents stay on your device.</p>
    <ul>{documents.slice(0,12).map(document=><li key={document.key}><strong>{document.fileName || 'Chess book'}</strong>
      <span>Page {document.pageNumber || 1} · {(document.documentGames?.length || 0)+(document.bookTree?1:0)} studies · {document.unresolvedSymbols || 0} unresolved symbols</span></li>)}</ul>
  </section>;
}
