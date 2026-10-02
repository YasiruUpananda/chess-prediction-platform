import type { MoveRequest, StrategyRequest, PlayerSummary } from './apiClient';

// These rejected assignments protect against accidental contract widening.
// @ts-expect-error A position is required by the prediction API.
const missingPosition: MoveRequest = { opponent_username: 'Player' };
// @ts-expect-error Backend accepts only any, white or black.
const invalidColor: StrategyRequest = { opponent_name: 'Player', color: 'red' };
// @ts-expect-error Counts must remain numeric.
const invalidCount: PlayerSummary = { name: 'Player', games: 'many' };
void missingPosition; void invalidColor; void invalidCount;
