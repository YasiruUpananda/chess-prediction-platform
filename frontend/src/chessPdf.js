import { Chess } from 'chess.js';

export function extractSanMoves(rawText) {
  const text = rawText
    .replace(/[♔♚]/g, 'K')
    .replace(/[♕♛]/g, 'Q')
    .replace(/[♖♜]/g, 'R')
    .replace(/[♗♝]/g, 'B')
    .replace(/[♘♞]/g, 'N')
    .replace(/[♙♟]/g, '')
    .replace(/t(?:ll|t:l|l)\s*(x?[a-h][1-8])/gi, 'N$1')
    .replace(/(^|[\s.])i\.\s*(x?[a-h][1-8])/gi, '$1B$2')
    .replace(/\uFFFD/g, 'Q')
    .replace(/!'W/gi, 'Q')
    .replace(/\bge[l1]\b/gi, 'Re1')
    .replace(/[0O]-[0O](-[0O])?/g, (castle) => castle.replace(/0/g, 'O'))
    .replace(/(\d)\s+(\.)/g, '$1$2')
    .replace(/(\d)\s+(\.\.)/g, '$1$2');

  const sanPattern = /(?<![A-Za-z0-9])(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)(?![A-Za-z0-9])/g;
  const tokens = [...text.matchAll(sanPattern)].map((match) => match[0]);
  const firstMove = text.search(/(?:^|\s)1\s*\.\s*(?=[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8])/);
  if (firstMove < 0) return tokens;

  // Chess books often print several analysis branches on one page. Starting
  // from the first numbered game and stopping at the first illegal move gives
  // a real playable position without mixing alternative variations together.
  const initialLine = [...text.slice(firstMove).matchAll(sanPattern)].map((match) => match[0]);
  const game = new Chess();
  const legalLine = [];
  for (const move of initialLine) {
    try {
      game.move(move);
      legalLine.push(move);
    } catch {
      break;
    }
  }
  return legalLine.length ? legalLine : tokens;
}
