import { createApi } from '@reduxjs/toolkit/query/react';
import { friendlyError } from '../api';
import { getPlayers, type PlayerSummary } from '../apiClient';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';

const baseQuery: BaseQueryFn<string, unknown, { status: number | string; error: string }> = async (_path, api) => {
  try { return { data: await getPlayers({ signal: api.signal }) }; }
  catch (error: unknown) { return { error: { status: error instanceof Error && 'status' in error ? Number(error.status) : 'FETCH_ERROR', error: friendlyError(error) } }; }
};

export const chessApi = createApi({
  reducerPath: 'chessApi',
  baseQuery,
  endpoints: (build) => ({
    getPlayers: build.query<PlayerSummary[], string>({ query: () => '/api/v1/players', transformResponse: (response: { players: PlayerSummary[] }) => response.players,
      keepUnusedDataFor: 120 }),
  }),
});
export const { useGetPlayersQuery } = chessApi;
