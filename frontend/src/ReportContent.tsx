import type { components } from './generated/api';
import { statisticText } from './statisticText';

type Claim = components['schemas']['Claim'];
type Props = { content: Claim[]; sources: { id: string }[]; statistics?: components['schemas']['GameStatistic'][] };

export default function ReportContent({ content, sources, statistics=[] }: Props) {
  'use memo';
  return <div className="report-content">{content.length ? content.map((claim, index) => <article key={index}>
    <small>AI interpretation · verify against the cited evidence</small><p>{claim.text}</p>
    {claim.statistic_ids.map(id=>statistics.find(stat=>stat.id===id)).filter(Boolean).map(stat=><p key={stat!.id} className="verified-fact">Verified statistic: {statisticText(stat!)}</p>)}
    <p>{claim.source_game_ids.map((id) => <a key={id} href={`#game-${id}`}>Game {sources.findIndex((source) => source.id === id) + 1} </a>)}
      {claim.statistic_ids.map((id) => <a key={id} href={`#stat-${id}`}>Statistic {id} </a>)}</p>
  </article>) : <p>Insufficient evidence for claims in this section.</p>}</div>;
}
