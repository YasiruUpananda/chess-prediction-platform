import { requestJson } from './api';
import type { components } from './generated/api';

export type PlayerSummary = components['schemas']['PlayerSummary'];
export type MoveRequest = components['schemas']['MovePredictionRequest'];
export type MoveResponse = components['schemas']['MovePredictionResponse'];
export type StrategyRequest = components['schemas']['StrategyPredictionRequest'];
export type StrategyResponse = components['schemas']['StrategyPredictionResponse'];
export type OcrJob = components['schemas']['OcrJobResponse'];
type Options = { signal?: AbortSignal; timeout?: number; getAccessToken?: () => Promise<string> };

export function getPlayers(options: Options = {}): Promise<components['schemas']['PlayersResponse']> {
  return requestJson('/api/v1/players', { timeout: 12000, ...options });
}
export function predictMove(body: MoveRequest, options: Options = {}): Promise<MoveResponse> {
  return requestJson('/api/v1/predict-move', { method: 'POST', body, timeout: 15000, ...options });
}
export function predictStrategy(body: StrategyRequest, options: Options = {}): Promise<StrategyResponse> {
  return requestJson('/api/v1/predict-strategy', { method: 'POST', body, timeout: 85000, ...options });
}

export function extractPageImage(body: FormData, options: Options = {}): Promise<OcrJob> {
  return requestJson('/api/v1/extract-page-image', { method: 'POST', body, timeout: 30000, ...options });
}
export function getOcrJob(id: string, options: Options = {}): Promise<OcrJob> {
  return requestJson(`/api/v1/ocr-jobs/${encodeURIComponent(id)}`, { timeout: 10000, ...options });
}
