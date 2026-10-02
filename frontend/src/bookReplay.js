import { Chess } from 'chess.js';

// A tree belongs to one printed game in one column, not every line on the page.
export function buildBookTree(lines, selected, initialFen) {
  const root = { children: [], fen: initialFen };
  for (const line of lines) {
    if (line.rootId !== selected.rootId || line.column !== selected.column) continue;
    const board = new Chess(initialFen);
    let node = root;
    for (const san of line.moves) {
      const move = board.move(san);
      const uci = move.from + move.to + (move.promotion || '');
      let child = node.children.find(item=>item.uci===uci);
      if(!child) {
        child = { uci, san:move.san, fen:board.fen(), mainLine:false, children:[] };
        node.children.push(child);
      }
      if(!line.variation) child.mainLine=true;
      node=child;
    }
  }
  return root;
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
