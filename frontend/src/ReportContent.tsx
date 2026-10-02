import type { components } from './generated/api';

type Claim = components['schemas']['Claim'];
type Props = { content: Claim[]; sources: { id: string }[] };

export default function ReportContent({ content, sources }: Props) {
  'use memo';
  return <div className="report-content">{content.length ? content.map((claim, index) => <article key={index}>
    <p>{claim.text}</p><small>{claim.confidence === 'tentative' ? 'Tentative inference' : 'Evidence supported'}</small>
    <p>{claim.source_game_ids.map((id) => <a key={id} href={`#game-${id}`}>Game {sources.findIndex((source) => source.id === id) + 1} </a>)}
      {claim.statistic_ids.map((id) => <a key={id} href={`#stat-${id}`}>Statistic {id} </a>)}</p>
  </article>) : <p>Insufficient evidence for claims in this section.</p>}</div>;
}
