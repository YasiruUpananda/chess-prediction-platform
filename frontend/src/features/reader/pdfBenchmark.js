// Compare complete, ordered SAN lines and their actual parent game/prefix.
// A long legal prefix earns no complete-line credit.
export function gradePdfLines(actual, expected, attachments=[]) {
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const complete=expected.filter(moves=>actual.some(line=>!line.issue && same(line.moves,moves))).length;
  const attached=attachments.filter(({line,parent,prefix})=>{
    const child=actual.find(item=>same(item.moves,expected[line]));
    const root=actual.find(item=>same(item.moves,expected[parent]));
    return child?.variation && !child.issue && root && !root.issue && child.rootId===root.rootId && child.column===root.column && same(child.moves.slice(0,prefix.length),prefix);
  }).length;
  return {completeLines:complete,totalLines:expected.length,unexpectedLines:actual.filter(line=>!expected.some(moves=>same(line.moves,moves))).length,completeLineAccuracy:expected.length?complete/expected.length:null,
    attachedVariations:attached,totalVariations:attachments.length,variationAttachmentAccuracy:attachments.length?attached/attachments.length:null};
}
