/**
 * Tokens pane — the range-cycle hint must tell the truth (review catch):
 * swipe cycles only when the body fits the pane, so an overflowing pane must
 * not advertise swipe-to-cycle.
 */
import { describe, expect, test } from 'bun:test';
import type { TokensDetail } from '../../contracts/types';
import { stripAnsi } from '../ansi';
import { applyTokens, initialState, setTab, type AppState } from '../state';
import { renderTokens } from './tokens';

function tokensState(): AppState {
  const detail: TokensDetail = {
    range: 'today',
    as_of: new Date().toISOString(),
    totals: { cost_usd: 12.5, total_tokens: 1_000_000, messages: 42 },
    all_time: { cost_usd: 100, total_tokens: 9_000_000 },
    by_host: [{ instance_id: 'atlas', cost_usd: 10, total_tokens: 800_000 }],
    by_client: [],
    by_model: [{ model: 'claude-opus-4-8', client: 'claude-code', cost_usd: 10, total_tokens: 800_000 }],
    by_workspace: [],
    daily: [],
    hourly: [],
    spikes: [],
  };
  return applyTokens(setTab(initialState('x'), 'tokens'), detail, Date.now());
}

describe('tokens range hint honesty', () => {
  test('body fits the pane → swipe is advertised', () => {
    const lines = renderTokens(tokensState(), 45, 40);
    expect(lines.length).toBeLessThanOrEqual(40);
    expect(stripAnsi(lines[0] ?? '')).toContain('(t/swipe/tap to cycle)');
  });

  test('body overflows the pane → swipe (which would scroll) is not advertised', () => {
    const s = tokensState();
    const bodyH = renderTokens(s, 45, 40).length - 1; // force one-line overflow
    const lines = renderTokens(s, 45, bodyH);
    const head = stripAnsi(lines[0] ?? '');
    expect(head).toContain('(t/tap to cycle)');
    expect(head).not.toContain('swipe');
  });

  test('loading state (no tokens yet) shows the full hint', () => {
    const lines = renderTokens(setTab(initialState('x'), 'tokens'), 45, 40);
    expect(stripAnsi(lines[0] ?? '')).toContain('(t/swipe/tap to cycle)');
    expect(stripAnsi(lines[1] ?? '')).toContain('loading tokens');
  });
});
