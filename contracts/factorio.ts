import type { FactorioInfo, Probe } from './types';

export type FactorioViewState = 'current' | 'incomplete' | 'stale' | 'unavailable';

export interface FactorioView {
  state: FactorioViewState;
  data: FactorioInfo | null;
  active_players: number | null;
  players_label: string;
}

export function factorioView(
  probe: Probe<FactorioInfo> | null | undefined,
  hostReachable: boolean,
): FactorioView {
  const data = probe?.data ?? null;
  if (!data) {
    return { state: 'unavailable', data: null, active_players: null, players_label: 'unknown' };
  }
  if (!hostReachable || !probe?.available) {
    return { state: 'stale', data, active_players: null, players_label: 'unknown' };
  }
  if (!data.players.complete) {
    return { state: 'incomplete', data, active_players: null, players_label: 'unknown' };
  }
  return {
    state: 'current',
    data,
    active_players: data.players.active,
    players_label: `${data.players.active}/${data.players.max}`,
  };
}
