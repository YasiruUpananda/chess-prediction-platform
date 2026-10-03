import { Chess } from 'chess.js';

// A tree belongs to one printed game in one column, not every line on the page.
export function buildBookTree(lines, selected, initialFen) {
  const root = { children: [], fen: initialFen };
  for (const line of lines) {
    if (line.rootId !== selected.rootId || line.column !== selected.column) continue;
    const board = new Chess(initialFen);
    let node = root;
    for (const [ply,san] of line.moves.entries()) {
      const move = board.move(san);
      const uci = move.from + move.to + (move.promotion || '');
      let child = node.children.find(item=>item.uci===uci);
      if(!child) {
        child = { uci, san:move.san, fen:board.fen(), parentFen:node.fen, sources:[], comments:[], mainLine:false, children:[] };
        node.children.push(child);
      }
      if(!line.variation) child.mainLine=true;
      const source=line.moveSources?.[ply];
      if(source && !child.sources.some(item=>JSON.stringify(item)===JSON.stringify(source))) child.sources.push(source);
      const comment=line.moveComments?.[ply];
      if(comment && !child.comments.includes(comment)) child.comments.push(comment);
      node=child;
    }
  }
  return root;
}

export function mergeBookTrees(target, incoming) {
  if(!target) return incoming;
  if(target.fen!==incoming.fen) throw new Error('Trees have different starting positions');
  for(const child of incoming.children) {
    const existing=target.children.find(item=>item.uci===child.uci);
    if(existing) {
      existing.mainLine ||= child.mainLine;
      existing.sources=[...(existing.sources || []),...(child.sources || [])];
      existing.comments=[...new Set([...(existing.comments || []),...(child.comments || [])])];
      mergeBookTrees(existing,child);
    } else target.children.push(child);
  }
  return target;
}

// Carry reviewed alternatives as PGN RAV context so a later prose continuation
// can anchor to any earlier branch, rather than only the currently chosen line.
export function treeNotation(root, selectedPath=[]) {
  function emit(node, path, depth) {
    if(!node?.children.length)return '';
    const main=node.children.find(child=>child.uci===path[depth]) || node.children.find(child=>child.mainLine) || node.children[0];
    const board=new Chess(node.fen);
    const numbered=child=>`${board.moveNumber()}${board.turn()==='w'?'.':'...'} ${child.san}`;
    const alternatives=node.children.filter(child=>child!==main).map(child=>`(${numbered(child)} ${emit(child,[],depth+1)})`).join(' ');
    return `${numbered(main)} ${alternatives} ${emit(main,path,depth+1)}`.trim();
  }
  return emit(root,selectedPath,0);
}

export function nodeAt(root, moves) {
  let node=root;
  for(const uci of moves) {
    node=node?.children.find(child=>child.uci===uci);
    if(!node) return null;
  }
  return node;
}

export function continuation(node) {
  const moves=[];
  while(node) {
    moves.push(node.uci);
    node=node.children.find(child=>child.mainLine) || node.children[0];
  }
  return moves;
}

export function bookMoveLabels(initialFen, moves, uci=false) {
  const board=new Chess(initialFen);
  return moves.map(value=>{
    const number=board.moveNumber(), turn=board.turn();
    const move=board.move(uci?{from:value.slice(0,2),to:value.slice(2,4),promotion:value[4]}:value);
    return `${number}${turn==='w'?'.':'...'} ${move.san}`;
  });
}
