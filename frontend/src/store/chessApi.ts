import { createApi } from '@reduxjs/toolkit/query/react';
import { friendlyError, requestJson } from '../lib/api';
import type { PlayerSummary, SavedStudy, StudyInput } from '../lib/apiClient';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';

const baseQuery: BaseQueryFn<string | {url: string; method?: string; body?: StudyInput}, unknown, { status: number | string; error: string }> = async (args, api) => {
  const {url,...options} = typeof args === 'string' ? {url: args} : args;
  try { return { data: await requestJson(url, { ...options, signal: api.signal, timeout:12000 }) }; }
  catch (error: unknown) { return { error: { status: error instanceof Error && 'status' in error ? Number(error.status) : 'FETCH_ERROR', error: friendlyError(error) } }; }
};

export const chessApi = createApi({
  reducerPath: 'chessApi',
  baseQuery,
  tagTypes: ['Studies'],
  endpoints: (build) => ({
    getPlayers: build.query<PlayerSummary[], string>({ query: () => '/api/v1/players', transformResponse: (response: { players: PlayerSummary[] }) => response.players,
      keepUnusedDataFor: 120 }),
    getStudies: build.query<SavedStudy[], string>({ query: () => '/api/v1/studies',
      transformResponse: (response: {studies: SavedStudy[]}) => response.studies, providesTags:['Studies'] }),
    saveStudy: build.mutation<SavedStudy, StudyInput>({query: (body) => ({url:'/api/v1/studies',method:'POST',body}),invalidatesTags:['Studies']}),
    deleteStudy: build.mutation<void,string>({query: (id) => ({url:`/api/v1/studies/${encodeURIComponent(id)}`,method:'DELETE'}),invalidatesTags:['Studies']}),
  }),
});
export const { useGetPlayersQuery } = chessApi;
export const { useGetStudiesQuery, useSaveStudyMutation, useDeleteStudyMutation } = chessApi;
