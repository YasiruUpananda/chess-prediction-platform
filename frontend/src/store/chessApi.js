import { createApi } from '@reduxjs/toolkit/query/react';
import { requestJson, friendlyError } from '../api';

export const chessApi = createApi({
  reducerPath: 'chessApi',
  baseQuery: async (path, api) => {
    try { return { data: await requestJson(path, { signal: api.signal, timeout: 12000 }) }; }
    catch (error) { return { error: { status: error.status || 'FETCH_ERROR', error: friendlyError(error) } }; }
  },
  endpoints: (build) => ({
    getPlayers: build.query({ query: () => '/api/v1/players', transformResponse: (response) => response.players,
      keepUnusedDataFor: 120 }),
  }),
});
export const { useGetPlayersQuery } = chessApi;
