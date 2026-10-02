"""Canonical legal position identity and history reconstruction."""
import chess


def position_key(board):
    # Only a legal en-passant capture changes the available moves. Counters do
    # not define an opening position, but are retained in engine/cache inputs.
    return " ".join(board.fen(en_passant="legal").split()[:4])


def validated_board(fen, initial_fen=None, moves=None):
    try:
        requested = chess.Board(fen)
        if not requested.is_valid():
            raise ValueError("Invalid board: kings, pawns, checks or castling rights are inconsistent.")
        if initial_fen is None and moves is None:
            return requested
        board = chess.Board(initial_fen or chess.STARTING_FEN)
        if not board.is_valid():
            raise ValueError("Invalid starting position.")
        for uci in moves or []:
            if board.is_game_over():
                raise ValueError("Move history continues after the game ended.")
            move = chess.Move.from_uci(uci)
            if move not in board.legal_moves:
                raise ValueError("Move history contains an illegal move.")
            board.push(move)
        if board.fen() != requested.fen():
            raise ValueError("Move history does not match the supplied position.")
        return board
    except (ValueError, IndexError) as error:
        raise ValueError(str(error)) from error
