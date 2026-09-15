import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  opponentName: 'Magnus Carlsen',
  strategyAnalysis: '',
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
    },
    setLoading: (state, action) => {
      state.loading = action.payload;
    },
    setStrategyAnalysis: (state, action) => {
      state.strategyAnalysis = action.payload;
      state.loading = false;
      state.error = null;
    },
    setPredictedMove: (state, action) => {
      state.predictedMove = action.payload;
      state.loading = false;
      state.error = null;
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
  setError,
} = chessSlice.actions;

export default chessSlice.reducer;