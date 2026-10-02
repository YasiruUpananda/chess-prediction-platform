export function reportMarkdown(result) {
  const lines = [`# Opponent report: ${result.opponent}`, '',
    `Supporting games: ${result.supporting_games}; available games: ${result.available_games}.`,
    `Context: ${result.context || 'None'}. Color: ${result.color || 'any'}.`, '',
    'Estimates are based on the cited dataset and bounded analysis.', ''];
  for (const section of ['profile','tendencies','weaknesses','recommendations']) {
    lines.push(`## ${section[0].toUpperCase()+section.slice(1)}`, '');
    for (const claim of result.report[section]) lines.push(`- ${claim.text} (${claim.confidence})`,
      `  Sources: ${claim.source_game_ids.join(', ') || 'none'}; statistics: ${claim.statistic_ids.join(', ') || 'none'}.`);
    if (!result.report[section].length) lines.push('Insufficient evidence for this section.');
    lines.push('');
  }
  lines.push('## Limitations', ...result.report.limitations.map((item)=>`- ${item}`), '',
    '## Verified statistics', '```json', JSON.stringify(result.statistics,null,2), '```', '',
    '## Source games', '');
  for (const game of result.sources) lines.push(`### ${game.id}: ${game.white} vs ${game.black}`,
    `${game.event}; ${game.date}; ${game.result}`, '```pgn',game.pgn,'```','');
  lines.push(`Model: ${result.model || 'Unknown'}; prompt: ${result.prompt_version || 'Unknown'}; data version: ${result.data_version || 'Unknown'}.`);
  return lines.join('\n');
}

export function downloadText(text, name, type='text/plain') {
  const url=URL.createObjectURL(new Blob([text],{type}));
  const link=document.createElement('a'); link.href=url; link.download=name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
