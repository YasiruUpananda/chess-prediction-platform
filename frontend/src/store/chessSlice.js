import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  moves: [],
  pgn: '',
  revision: 0,
  opponentName: '',
  strategyAnalysis: '',
  supportingGames: 0,
  availableGames: 0,
  predictedMove: null,
  loading: false,
  error: null,
};

export const chessSlice = createSlice({
  name: 'chess',
  initialState,
  reducers: {
    resetWorkspace: () => initialState,
    setFen: (state, action) => {
      state.fen = action.payload;
      state.initialFen = action.payload;
      state.moves = [];
      state.pgn = '';
      state.revision += 1;
      state.predictedMove = null;
    },
    setGameSnapshot: (state, action) => {
      if (action.payload.expectedRevision !== state.revision) return;
      state.fen = action.payload.fen;
      state.moves = action.payload.moves;
      state.pgn = action.payload.pgn;
      state.revision += 1;
      state.predictedMove = null;
    },
    setOpponentName: (state, action) => {
      state.opponentName = action.payload;
      state.strategyAnalysis = '';
      state.supportingGames = 0;
      state.availableGames = 0;
      state.predictedMove = null;
      state.error = null;
    },
    setLoading: (state, action) => {
      state.loading = action.payload;
      if (action.payload) {
        state.strategyAnalysis = '';
        state.supportingGames = 0;
        state.availableGames = 0;
        state.error = null;
      }
    },
    setStrategyAnalysis: (state, action) => {
      state.strategyAnalysis = action.payload;
      state.supportingGames = action.payload.supporting_games;
      state.availableGames = action.payload.available_games;
      state.loading = false;
      state.error = null;
    },
    setPredictedMove: (state, action) => {
      state.predictedMove = action.payload;
    },
    clearStrategy: (state) => {
      state.strategyAnalysis = '';
      state.supportingGames = 0;
      state.availableGames = 0;
      state.loading = false;
      state.error = null;
    },
    applyMovePrediction: (state, action) => {
      const { expectedFen, expectedRevision, opponent, response, nextFen, nextMoves, nextPgn } = action.payload;
      if (state.fen !== expectedFen || state.opponentName !== opponent || state.revision !== expectedRevision) return;
      state.predictedMove = response;
      state.fen = nextFen;
      state.moves = nextMoves;
      state.pgn = nextPgn;
      state.revision += 1;
    },
    setError: (state, action) => {
      state.error = action.payload;
      state.loading = false;
    },
  },
});

export const {
  resetWorkspace,
  setFen,
  setGameSnapshot,
  setOpponentName,
  setLoading,
  clearStrategy,
  setStrategyAnalysis,
  setPredictedMove,
  applyMovePrediction,
  setError,
} = chessSlice.actions;

export default chessSlice.reducer;
