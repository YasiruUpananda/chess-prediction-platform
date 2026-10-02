import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  opponentName: 'Magnus Carlsen',
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
    setFen: (state, action) => {
      state.fen = action.payload;
    },
    setOpponentName: (state, action) => {
      state.opponentName = action.payload;
      state.strategyAnalysis = '';
      state.supportingGames = 0;
      state.availableGames = 0;
      state.predictedMove = null;
    },
    setLoading: (state, action) => {
      state.loading = action.payload;
    },
    setStrategyAnalysis: (state, action) => {
      state.strategyAnalysis = action.payload.strategy_analysis;
      state.supportingGames = action.payload.supporting_games;
      state.availableGames = action.payload.available_games;
      state.loading = false;
      state.error = null;
    },
    setPredictedMove: (state, action) => {
      state.predictedMove = action.payload;
    },
    applyMovePrediction: (state, action) => {
      const { expectedFen, opponent, response, nextFen } = action.payload;
      if (state.fen !== expectedFen || state.opponentName !== opponent) return;
      state.predictedMove = response;
      state.fen = nextFen;
    },
    setError: (state, action) => {
      state.error = action.payload;
      state.loading = false;
    },
  },
});

export const {
  setFen,
  setOpponentName,
  setLoading,
  setStrategyAnalysis,
  setPredictedMove,
  applyMovePrediction,
  setError,
} = chessSlice.actions;

export default chessSlice.reducer;
