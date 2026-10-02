import { Chess } from 'chess.js';
export const EXTRACTION_VERSION = 'layout-rav-v3';
const SAN = /^(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)$/;
const UNKNOWN_GLYPH = /[\uFFFD\uE000-\uF8FF¤]/;
const unreadableMove = (token) => UNKNOWN_GLYPH.test(token) || (!SAN.test(token) && /^[^\s]+[a-h][1-8][+#]?$/.test(token));

export function normalizeChessText(text) {
  return text.replace(/[♔♚]/g, 'K').replace(/[♕♛]/g, 'Q').replace(/[♖♜]/g, 'R')
    .replace(/[♗♝]/g, 'B').replace(/[♘♞]/g, 'N').replace(/[♙♟]/g, '')
    .replace(/[0O]-[0O](-[0O])?/g, (castle) => castle.replace(/0/g, 'O'))
    .replace(/(\d+)\s*\.\s*\.\s*\./g, '$1...')
    .replace(/(\d)\s+(\.)/g, '$1$2')
    .replace(/\b([KQRBN])\s+(?=[a-h1-8x]*[a-h][1-8])/g, '$1')
    // PDF text runs can concatenate a pawn move and a figurine move.
    .replace(/([a-h][1-8](?:=[QRBN])?[+#]?)(?=[KQRBN][a-h1-8x]*[a-h][1-8])/g, '$1 ')
    .replace(/([^\p{L}\p{N}\s.(){}!?=+#$-])\s+(?=[a-h1-8x]*[a-h][1-8])/gu, '$1');
}

// Keep positions rather than joining PDF items in arbitrary extraction order.
// A persistent central gutter identifies two columns; ambiguous layouts are
// exposed as blocks so readers can select/correct a line instead of merging it.
export function textBlocks(items, pageWidth) {
  const positioned = items.filter((item) => item.str?.trim() && item.transform)
    .map((item) => ({ text: item.str, x: item.transform[4], y: item.transform[5],
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
    return { column: index + 1, text: rows.map((row) => row.items.sort((a,b) => a.x-b.x).map((item) => item.text).join(' ')).join('\n'), items: column };
  });
}

export function extractChessLines(rawText, initialFen = new Chess().fen(), allowUnnumbered = false) {
  const text = normalizeChessText(rawText).replace(/(\d+\.(?:\.\.)?)(?=[KQRBNabcdefghO])/g, '$1 ');
  const tokens = text.match(/\{[^}]*\}|;[^\n]*|\$\d+|\d+\.(?:\.\.)?|[()]|[^\s(){}]+/g) || [];
  const lines = [];
  const stack = [];
  let current = null;
  let pendingNumber = null;
  let active = allowUnnumbered;
  let unmatchedClosing = false;
  const newLine = (prefix = [], variation = false) => {
    const line = { steps: [...prefix], variation };
    lines.push(line);
    return line;
  };
  for (let token of tokens) {
    if (token.startsWith('{') || token.startsWith(';') || token.startsWith('$')) continue;
    if (token === '(') {
      stack.push({ current, active, pendingNumber });
      current = newLine(current?.steps.slice(0, -1) || [], true);
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
      const previous = current?.steps.findLast((step) => step.number);
      if (!current || !active || (!stack.length && previous && next.number <= (previous.number || 0) && next.turn === 'w')) current = newLine();
      pendingNumber = next; active = true;
      continue;
    }
    token = token.replace(/[!?]+$/g, '').replace(/[.,]+$/g, '');
    if ((SAN.test(token) || unreadableMove(token)) && active) {
      if (!current) current = newLine();
      current.steps.push({ san: token, ...pendingNumber });
      pendingNumber = null;
    } else if (token !== 'e.p.') {
      active = false;
    }
  }
  return lines.filter((line) => line.steps.length).map((line, index) => {
    const game = new Chess(initialFen);
    const moves = [];
    let issue = stack.length || unmatchedClosing ? 'Unbalanced variation parentheses. Review and correct the notation.' : '';
    for (const step of line.steps) {
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
    return { id: index, variation: line.variation, raw: line.steps.map((step) => step.san).join(' '),
      moves, candidates: line.steps.length, issue, confidence: issue ? 'low' : line.steps.length >= 4 ? 'high' : 'medium' };
  });
}

export function parseChessText(text, fen, allowUnnumbered = false) {
  // Separate glued numbering without losing SAN tokens.
  return extractChessLines(normalizeChessText(text).replace(/(\d+\.(?:\.\.)?)(?=[KQRBNabcdefghO])/g, '$1 '), fen, allowUnnumbered);
}

export function extractSanMoves(rawText, initialFen) {
  return parseChessText(rawText, initialFen).find((line) => !line.variation)?.moves || [];
}
