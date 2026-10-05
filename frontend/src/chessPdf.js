import { Chess } from 'chess.js';
/** @typedef {{san:string,number?:number,turn?:string,comments?:string[]}} NotationStep */
/** @typedef {{rootId:number,steps:NotationStep[],label:string}} WorkingAnchor */
/** @typedef {{id:number,rootId:number,steps:NotationStep[],variation:boolean,parentSteps:NotationStep[]|null,hasOwnMoves:boolean,anchorOptions?:WorkingAnchor[]}} WorkingLine */
export const EXTRACTION_VERSION = 'layout-document-v8-token-sources';
const SAN = /^(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)$/;
const UNKNOWN_GLYPH = /[\uFFFD\uE000-\uF8FF¤]/;
const unreadableMove = (token) => UNKNOWN_GLYPH.test(token) || (!SAN.test(token) && /^[^\s]+[a-h][1-8][+#]?$/.test(token));

// A PDF chess font may encode a knight as an arbitrary character. Never map
// those characters globally: they can also occur in ordinary book prose.
/** @param {string} text @param {Record<string,string>} mappings */
export function applyPieceMappings(text, mappings = {}) {
  return Array.from(text).map((glyph, index, chars) => {
    const piece = mappings[glyph];
    if (!/^[KQRBN]$/.test(piece || '')) return glyph;
    if (index && /[\p{L}\p{N}]/u.test(chars[index - 1])) return glyph;
    const suffix = chars.slice(index + 1, index + 14).join('');
    return /^\s*[a-h]?[1-8]?x?[a-h][1-8](?:[+#!?\s.,()]|$)/.test(suffix) ? piece : glyph;
  }).join('');
}

export function customPieceSymbols(text) {
  const normalized = normalizeChessText(text);
  return [...new Set([...normalized.matchAll(/(?<![\p{L}\p{N}])([^\s.(){}\d])\s*([a-h]?[1-8]?x?[a-h][1-8])(?=[+#!?\s.,()]|$)/gu)]
    .filter((match) => !SAN.test(match[1] + match[2]))
    .map((match) => match[1]))];
}

// Suggest a symbol only when every complete legal reading agrees on its piece.
// Search is bounded; ambiguous or incomplete evidence stays manual.
export function suggestPieceMappings(raw, initialFen) {
  const tokens = normalizeChessText(raw).split(/\s+/).filter(Boolean);
  let budget = 512;
  const solutions = [];
  function visit(index, board, mappings) {
    if (--budget < 0) return;
    if (index === tokens.length) { solutions.push(mappings); return; }
    const token = tokens[index];
    const custom = /^([^\s])([a-h]?[1-8]?x?[a-h][1-8][+#]?)$/.exec(token);
    const glyph = !SAN.test(token) && custom ? custom[1] : null;
    const pieces = glyph ? (mappings[glyph] ? [mappings[glyph]] : ['K','Q','R','B','N']) : [''];
    for (const piece of pieces) {
      const next = new Chess(board.fen());
      try { next.move(glyph && custom ? piece + custom[2] : token); }
      catch { continue; }
      visit(index + 1, next, glyph ? { ...mappings, [glyph]: piece } : mappings);
    }
  }
  visit(0, new Chess(initialFen), {});
  if (budget < 0 || !solutions.length) return {};
  return Object.fromEntries(Object.entries(solutions[0]).filter(([glyph,piece]) => solutions.every((solution)=>solution[glyph]===piece)));
}

/** @param {string} text */
export function normalizeChessText(text) {
  return text.replace(/[\uFE0E\uFE0F]/g, '').replace(/[♔♚]/g, 'K').replace(/[♕♛]/g, 'Q').replace(/[♖♜]/g, 'R')
    .replace(/[♗♝]/g, 'B').replace(/[♘♞]/g, 'N').replace(/[♙♟]/g, '')
    .replace(/[0O]-[0O](-[0O])?/g, (castle) => castle.replace(/0/g, 'O'))
    .replace(/(\d+)\s*\.\s*\.\s*\./g, '$1...')
    .replace(/(\d)\s+(\.)/g, '$1$2')
    .replace(/\b([KQRBN])\s+(?=[a-h1-8x]*[a-h][1-8])/g, '$1')
    .replace(/(?<![\p{L}\p{N}])([A-Z\p{S}\p{Co}])\s+(?=[a-h]?[1-8]?x?[a-h][1-8](?:[+#!?\s.,()]|$))/gu, '$1')
    // PDF text runs can concatenate a pawn move and a figurine move.
    .replace(/([a-h][1-8](?:=[QRBN])?[+#]?)(?=[^\s.(){}\d][a-h1-8x]*[a-h][1-8])/g, '$1 ')
    .replace(/([^\p{L}\p{N}\s.(){}!?=+#$-])\s+(?=[a-h1-8x]*[a-h][1-8])/gu, '$1');
}

// Keep positions rather than joining PDF items in arbitrary extraction order.
// A persistent central gutter identifies two columns; ambiguous layouts are
// exposed as blocks so readers can select/correct a line instead of merging it.
/** @param {number|null} page */
export function textBlocks(items, pageWidth, page = null) {
  const positioned = items.filter((item) => item.str?.trim() && item.transform)
    .map((item, index) => ({ tokenId: item.tokenId || `${page ?? 'ocr'}:${index}:${item.transform[4]}:${item.transform[5]}`, text: item.str, rawText: item.str, page, fontSize: Math.hypot(item.transform[2], item.transform[3]), fontName: item.fontName || 'unknown', hasEOL: Boolean(item.hasEOL), transform: [...item.transform], x: item.transform[4], y: item.transform[5],
      width: item.width || 0, height: Math.abs(item.height || item.transform[3] || 10) }));
  const left = positioned.filter((item) => item.x + item.width < pageWidth * .52);
  const right = positioned.filter((item) => item.x > pageWidth * .48);
  const crossing = positioned.filter((item) => item.x < pageWidth * .48 && item.x + item.width > pageWidth * .52);
  const columns = left.length >= 3 && right.length >= 3 && crossing.length < positioned.length * .2
    ? [positioned.filter((item) => item.x < pageWidth / 2), positioned.filter((item) => item.x >= pageWidth / 2)] : [positioned];
  return columns.map((column, index) => {
    const rows = [];
    for (const item of column.sort((a, b) => b.y - a.y || a.x - b.x)) {
      let row = rows.at(-1);
      if (!row || Math.abs(row.y - item.y) >= Math.max(2, item.height * .35)) {
        row = { y: item.y, items: [] }; rows.push(row);
      }
      row.items.push(item);
    }
    return { column: index + 1, text: rows.map((row) => {
      const ordered=row.items.sort((a,b)=>a.x-b.x);
      return ordered.map((item,i)=>{
        const next=ordered[i+1],glyph=item.text.trim();
        const adjacent=next && next.x-(item.x+item.width)<=Math.max(2,item.height*.7);
        const custom=Array.from(glyph).length===1 && !/^[a-h0-9.KQRBN]$/.test(glyph);
        return item.text+(adjacent && custom && /^[a-h]?[1-8]?x?[a-h][1-8]/.test(next.text)?'':' ');
      }).join('').trim();
    }).join('\n'), items: column };
  });
}

export const fontIdentity = font => font.replace(/^g_d\d+_/, '');
export const symbolKey = (fontName, glyph) => JSON.stringify([fontIdentity(fontName), glyph]);

export function fontSymbols(blocks) {
  const symbols = new Map();
  for (const block of blocks) for (const item of block.items || [{text:block.text,fontName:'unknown',x:0,y:0,width:0,height:12}]) {
    for (const glyph of customPieceSymbols(item.text)) {
      const key = symbolKey(item.fontName, glyph);
      if (!symbols.has(key)) {
        const index = item.text.indexOf(glyph), width = item.width / Math.max(1, item.text.length);
        symbols.set(key, { key, glyph, fontName:item.fontName, x:item.x + index * width,
          y:item.y - item.height * .25, width:Math.max(width,item.height * .6), height:item.height });
      }
    }
    // Chess fonts often put a piece in a separate PDF text run.
    const glyph=item.text.trim();
    if (Array.from(glyph).length===1 && !/^[KQRBN]?$/.test(normalizeChessText(glyph)) && !/[a-h0-9.KQRBN]/.test(glyph) && /[A-Za-z\p{S}\p{Co}\uFFFD]/u.test(glyph)) {
      const key=symbolKey(item.fontName,glyph);
      if(!symbols.has(key)) symbols.set(key,{key,glyph,fontName:item.fontName,x:item.x,y:item.y-item.height*.25,width:Math.max(item.width,item.height*.6),height:item.height});
    }
  }
  return [...symbols.values()];
}

export function parseTextBlocks(blocks, fen, mappings={}, prefix='') {
  return blocks.flatMap((block)=>{
    let text=block.text;
    if(block.items?.length) {
      const items=block.items.map((item)=>{
        let str=item.text;
        for(const [key,piece] of Object.entries(mappings)) {
          const [font,glyph]=JSON.parse(key);
          if(font===fontIdentity(item.fontName) && /^[KQRBN]$/.test(piece)) {
            if(str.trim()===glyph) str=str.replace(glyph,piece);
            else str=applyPieceMappings(normalizeChessText(str),{[glyph]:piece});
          }
        }
        return {str,width:item.width,height:item.height,fontName:item.fontName,transform:item.transform};
      });
      // This is one already-separated column; do not run column detection again.
      text=textBlocks(items,Infinity)[0]?.text || '';
    } else {
      /** @type {Record<string,string>} */
      const fallback={};
      for(const [key,piece] of Object.entries(mappings)) {const [font,glyph]=JSON.parse(key);if(font==='unknown')fallback[glyph]=piece;}
      text=applyPieceMappings(normalizeChessText(text),fallback);
    }
    return parseChessText(prefix ? prefix+' '+text : text,fen).map((line)=>({...line,column:block.column,
      source: {page:block.items?.[0]?.page, items:block.items || [], rawText:block.text},
      moveSources: locateMoves(line.moves, block.items || [], mappings)}));
  });
}

// A highlight covers the original text run. Keep raw geometry rather than
// claiming sub-glyph accuracy for fonts with ligatures or split figurines.
export function locateMoves(moves, items, mappings={}) {
  let run=0, offset=0;
  return moves.map(san=>{
    for(let i=run;i<items.length;i++) {
      const item=items[i];
      /** @type {Record<string,string>} */
      const map={};
      for(const [key,piece] of Object.entries(mappings)) {const [font,glyph]=JSON.parse(key);if(font===fontIdentity(item.fontName))map[glyph]=piece;}
      const text=map[item.text.trim()] || applyPieceMappings(normalizeChessText(item.text),map);
      const index=text.indexOf(san,i===run?offset:0);
      if(index>=0) {
        run=i;offset=index+san.length;
        return {...item,x:item.x+item.width*index/Math.max(1,text.length),width:item.width*san.length/Math.max(1,text.length),approximate:true};
      }
      const next=items[i+1];
      if(next && /^[KQRBN]$/.test(text.trim()) && san.startsWith(text.trim()) &&
         Math.abs(item.y-next.y)<Math.max(item.height,next.height)*.5 &&
         next.x-(item.x+item.width)<Math.max(item.height,2)) {
        const destination=normalizeChessText(next.text).trim();
        if(destination.startsWith(san.slice(1))) {
          run=i+1;offset=san.length-1;
          return {...item,width:Math.max(item.width,next.x+next.width-item.x),tokenIds:[item.tokenId,next.tokenId],approximate:true};
        }
      }
    }
    return null;
  });
}

export function regionBlocks(blocks, region) {
  if(!region) return blocks;
  const items=blocks.flatMap(block=>block.items || []).flatMap(item=>{
    const y=item.y+item.height/2;
    if(y<region.y || y>region.y+region.height || item.x+item.width<region.x || item.x>region.x+region.width) return [];
    // PDF.js may emit an entire paragraph as one run. Retain only complete
    // whitespace tokens whose estimated centre is inside the selected region.
    const raw=item.rawText || item.text;
    const matches=[...raw.matchAll(/\S+/gu)].filter(match=>{
      const x=item.x+item.width*(match.index+match[0].length/2)/Math.max(1,raw.length);
      return x>=region.x && x<=region.x+region.width;
    });
    if(!matches.length)return [];
    const start=matches[0].index,end=matches.at(-1).index+matches.at(-1)[0].length;
    const text=raw.slice(start,end);
    const x=item.x+item.width*start/Math.max(1,raw.length);
    return [{...item,text,rawText:text,x,width:item.width*(end-start)/Math.max(1,raw.length),transform:[...item.transform.slice(0,4),x,item.y],approximate:true}];
  });
  return textBlocks(items.map(item=>({...item,str:item.rawText || item.text})),Infinity,items[0]?.page);
}

export function extractChessLines(rawText, initialFen = new Chess().fen(), allowUnnumbered = false) {
  const text = normalizeChessText(rawText).replace(/(\d+\.(?:\.\.)?)(?=[KQRBNabcdefghO])/g, '$1 ');
  const tokens = text.match(/\{[^}]*\}|;[^\n]*|\$\d+|\d+\.(?:\.\.)?|[()]|[^\s(){}]+/g) || [];
  /** @type {WorkingLine[]} */
  const lines = [];
  const stack = [];
  /** @type {WorkingLine|null} */
  let current = null;
  /** @type {{number:number,turn:string}|null} */
  let pendingNumber = null;
  let active = allowUnnumbered;
  let unmatchedClosing = false;
  let prose=[];
  const anchorsFor = (number, turn, candidate) => {
    const anchors=new Map();
    for(const line of lines) {
      if(line.anchorOptions) continue;
      const board=new Chess(initialFen), prefix=[];
      for(let i=0;i<=line.steps.length;i++) {
        if(board.moveNumber()===number && board.turn()===turn) {
          let legal=true;
          if(SAN.test(candidate || '')) { try { const copy=new Chess(board.fen());copy.move(candidate); } catch { legal=false; } }
          if(legal) {
            const key=JSON.stringify([line.rootId,prefix.map(step=>step.san)]);
            if(!anchors.has(key)) anchors.set(key,{rootId:line.rootId,steps:[...prefix],label:`Game ${line.rootId+1}: ${prefix.map(step=>step.san).join(' ') || 'starting position'}`});
          }
        }
        if(i===line.steps.length) break;
        try { board.move(line.steps[i].san);prefix.push(line.steps[i]); } catch { break; }
      }
    }
    return [...anchors.values()];
  };
  /** @param {NotationStep[]} prefix @param {boolean} variation @param {WorkingLine|null} parent @returns {WorkingLine} */
  const newLine = (prefix = [], variation = false, parent = null) => {
    const id = lines.length;
    const line = { id, rootId: parent?.rootId ?? id, steps: [...prefix], variation,
      parentSteps:parent?[...parent.steps]:null, hasOwnMoves:false };
    lines.push(line);
    return line;
  };
  for (let tokenIndex=0;tokenIndex<tokens.length;tokenIndex++) {
    let token=tokens[tokenIndex];
    if (token.startsWith('{') || token.startsWith(';')) {
      const step=current?.steps.at(-1);
      if(step) (step.comments ||= []).push(token.replace(/^[{;]|}$/g,''));
      continue;
    }
    if(token.startsWith('$')) continue;
    if (token === '(') {
      stack.push({ current, active, pendingNumber });
      current = newLine(current?.steps.slice(0, -1) || [], true, current);
      active = true; pendingNumber = null;
      continue;
    }
    if (token === ')') {
      const parent = stack.pop();
      if (parent) ({ current, active, pendingNumber } = parent);
      else unmatchedClosing = true;
      continue;
    }
    const number = /^(\d+)\.(\.\.)?$/.exec(token);
    if (number) {
      const next = { number: Number(number[1]), turn: number[2] ? 'b' : 'w' };
      const alternativeCue=/\b(?:alternative|instead|variation)\b/i.test(prose.join(' '));
      if(!stack.length && !active && current && (!(next.number===1 && next.turn==='w') || alternativeCue)) {
        const candidate=tokens[tokenIndex+1]?.replace(/[!?.,]+$/g,'');
        const anchors=anchorsFor(next.number,next.turn,candidate);
        if(anchors.length===1) {
          const anchor=anchors[0];
          if(current.rootId!==anchor.rootId || current.steps.length!==anchor.steps.length || current.steps.some((step,i)=>step.san!==anchor.steps[i].san)) {
            current=newLine(anchor.steps,true);current.rootId=anchor.rootId;
          }
          active=true;
        } else if(anchors.length>1) {
          current=newLine([],true);current.anchorOptions=anchors;active=true;
        }
      }
      // Books also place a numbered variation before the main reply. Its
      // move number/side identifies the anchor, rather than always undoing a ply.
      if(current?.parentSteps && !current.hasOwnMoves) {
        const board=new Chess(initialFen), prefix=[];
        for(const step of current.parentSteps) {
          if(board.moveNumber()===next.number && board.turn()===next.turn) break;
          try { board.move(step.san); prefix.push(step); } catch { break; }
        }
        if(board.moveNumber()===next.number && board.turn()===next.turn) current.steps=prefix;
      }
      const previous = current?.steps.findLast((step) => step.number);
      if (!current || !active || (!stack.length && previous && next.number <= (previous.number || 0) && next.turn === 'w')) current = newLine();
      pendingNumber = next; active = true;
      prose=[];
      continue;
    }
    token = token.replace(/[!?]+$/g, '').replace(/[.,]+$/g, '');
    if ((SAN.test(token) || unreadableMove(token)) && active) {
      if (!current) current = newLine();
      current.steps.push({ san: token, ...pendingNumber });
      current.hasOwnMoves=true;
      pendingNumber = null;
    } else if (token !== 'e.p.') {
      active = false;
      const step=current?.steps.at(-1);
      if(step) (step.comments ||= []).push(token);
      prose.push(token);prose=prose.slice(-32);
    }
  }
  return lines.filter((line) => line.steps.length).map((line) => {
    const game = new Chess(initialFen);
    const moves = [];
    let issue = line.anchorOptions ? 'Several earlier games fit this continuation. Choose its starting line.' : stack.length || unmatchedClosing ? 'Unbalanced variation parentheses. Review and correct the notation.' : '';
    for (const step of line.steps) {
      if(line.anchorOptions) break;
      if (step.number && (game.moveNumber() !== step.number || game.turn() !== step.turn)) {
        issue = `Move ${step.number}${step.turn === 'b' ? '...' : '.'} does not match the starting position. Set the book position FEN.`;
        break;
      }
      if (unreadableMove(step.san)) {
        issue = `Unrecognized PDF piece symbol in "${step.san}" after ${moves.length} plies. Correct it to K, Q, R, B or N, or try page OCR. The rest of the line has been retained.`;
        break;
      }
      try { moves.push(game.move(step.san).san); }
      catch { issue = `Cannot play ${step.san} after ${moves.length} moves. Correct the line or starting FEN.`; break; }
    }
    return { id: line.id, rootId: line.rootId, variation: line.variation, anchorOptions:line.anchorOptions?.map(anchor=>({rootId:anchor.rootId,prefix:anchor.steps.map(step=>step.san).join(' '),label:anchor.label})), raw: line.steps.map((step) => step.san).join(' '),
      moves, moveComments:line.steps.slice(0,moves.length).map(step=>(step.comments || []).join(' ')), candidates: line.steps.length, issue, confidence: issue ? 'low' : line.steps.length >= 4 ? 'high' : 'medium' };
  });
}

/** @param {string} text @param {string} fen @param {boolean} allowUnnumbered @param {Record<string,string>} mappings */
export function parseChessText(text, fen, allowUnnumbered = false, mappings = {}) {
  // Separate glued numbering without losing SAN tokens.
  return extractChessLines(normalizeChessText(applyPieceMappings(normalizeChessText(text), mappings)).replace(/(\d+\.(?:\.\.)?)(?=[KQRBNabcdefghO])/g, '$1 '), fen, allowUnnumbered);
}

export function resolveLineAnchor(line, option, fen) {
  const resolved=parseChessText(`${option.prefix} ${line.raw}`,fen,true)[0];
  return {...resolved,id:line.id,rootId:option.rootId,column:line.column,variation:true,anchorOptions:undefined};
}

export function extractSanMoves(rawText, initialFen) {
  return parseChessText(rawText, initialFen).find((line) => !line.variation)?.moves || [];
}
