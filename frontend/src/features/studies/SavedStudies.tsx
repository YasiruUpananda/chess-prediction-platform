import { useState } from 'react';
import { useGetStudiesQuery, useSaveStudyMutation, useDeleteStudyMutation } from '../../store/chessApi';
import type { SavedStudy, StudyInput } from '../../lib/apiClient';
import { friendlyError } from '../../lib/api';

type Props = { owner: string; snapshot: Omit<StudyInput,'title'>; onLoad: (study: SavedStudy) => void; disabled?: boolean };
export default function SavedStudies({owner,snapshot,onLoad,disabled=false}: Props) {
  const [title,setTitle] = useState('');
  const [notice,setNotice] = useState('');
  const query = useGetStudiesQuery(owner);
  const [save,saving] = useSaveStudyMutation();
  const [remove,deleting] = useDeleteStudyMutation();
  const busy = saving.isLoading || deleting.isLoading;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setNotice('');
    try { await save({...snapshot,title:title.trim()}).unwrap(); setTitle(''); setNotice('Study saved.'); }
    catch(error) { setNotice(friendlyError(error)); }
  }
  return <section className="saved-studies panel" aria-label="Saved studies">
    <h3>Saved studies</h3><p>Private positions and preparation notes saved to your account.</p>
    <form onSubmit={submit}>
      <label htmlFor="study-title">Study name</label>
      <input id="study-title" value={title} maxLength={100} onChange={(event)=>setTitle(event.target.value)} required />
      <button className="reader-secondary-button" disabled={disabled || busy || !title.trim()}>Save study</button>
    </form>
    {query.isLoading && <p role="status">Loading studies...</p>}
    {query.error && <p role="alert">{friendlyError(query.error)} <button type="button" onClick={()=>query.refetch()}>Retry studies</button></p>}
    {notice && <p role="status">{notice}</p>}
    <ul>{query.data?.map((study)=><li key={study.id}>
      <span>{study.title} ({study.moves.length} plies)</span>
      <button type="button" className="reader-secondary-button" disabled={disabled || busy} onClick={()=>onLoad(study)} aria-label={`Open study ${study.title}`}>Open</button>
      <button type="button" className="reader-secondary-button" disabled={busy} onClick={async()=>{
        try { await remove(study.id).unwrap(); setNotice('Study deleted.'); }
        catch(error) { setNotice(friendlyError(error)); }
      }} aria-label={`Delete study ${study.title}`}>Delete</button>
    </li>)}</ul>
    {query.data?.length === 0 && <p>No saved studies yet.</p>}
  </section>;
}
