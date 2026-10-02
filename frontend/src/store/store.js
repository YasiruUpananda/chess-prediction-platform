import { configureStore } from '@reduxjs/toolkit';
import chessReducer, { resetWorkspace } from './chessSlice';
import { chessApi } from './chessApi';

export const store = configureStore({
  reducer: {
    chess: chessReducer,
    [chessApi.reducerPath]: chessApi.reducer,
  },
  middleware: (getDefault) => getDefault().concat(chessApi.middleware),
});

let owner;
export function workspaceStore(identity) {
  if (owner !== identity) {
    store.dispatch(chessApi.util.resetApiState());
    store.dispatch(resetWorkspace());
    owner = identity;
  }
  return store;
}
