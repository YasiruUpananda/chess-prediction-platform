export function statisticText(stat) {
  if(stat.type==='sample') return `${stat.games} indexed games in this sample`;
  if(stat.type==='result') {
    const outcome=stat.result==='1/2-1/2'?'draw':stat.result==='*'?'unfinished':
      stat.result===(stat.color==='white'?'1-0':'0-1')?'win':'loss';
    return `${stat.color}: ${outcome} in ${stat.games} games`;
  }
  if(stat.type==='opening') return `${stat.line}: played in ${stat.games} games`;
  return `Recurring position: found in ${stat.games} games`;
}
