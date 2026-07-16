/**
 * Demo-data end-to-end contract: the SHIPPED fixture fleet (the exact data
 * `bun run tui` renders) draws every tab at every supported terminal size
 * without crashing, overflowing a line, or losing frame height. This is the
 * repo's strongest guarantee — if it passes, the demo runs.
 */
import { describe, expect, test } from 'bun:test';
import { buildFleetState } from '../../fixtures/fleet';
import { buildHistory } from '../../fixtures/history';
import { buildNotifications } from '../../fixtures/notifications';
import { buildTokensDetail } from '../../fixtures/tokens';
import type { HostId } from '../../contracts/types';
import { stripAnsi, visibleWidth } from '../ansi';
import { applyFleet, applyHistory, applyNotifications, applyTokens, initialState, setTab, TABS, type AppState } from '../state';
import { initTheme } from '../theme';
import { renderFrame } from './frame';

initTheme('compat');

const HOST_FIXTURE_IDS: HostId[] = ['atlas', 'forge', 'basalt', 'mica', 'vpn-kiku', 'vpn-cedar'];

function demoState(now = Date.now()): AppState {
  let s = applyFleet(initialState('demo · fixture data'), buildFleetState(now), now, 'sse');
  s = applyTokens(s, buildTokensDetail('today', now), now);
  s = applyNotifications(s, buildNotifications(now), now);
  for (const id of HOST_FIXTURE_IDS) s = applyHistory(s, buildHistory(id, now));
  return s;
}

const SIZES: Array<[number, number]> = [
  [45, 30], // phone portrait (Moshi)
  [76, 24], // small desktop
  [120, 40], // desktop
  [200, 60], // wide desktop
];

describe('shipped fixture fleet renders every tab at every size', () => {
  const s0 = demoState();
  for (const tab of TABS) {
    for (const [cols, rows] of SIZES) {
      test(`${tab} @ ${cols}x${rows}`, () => {
        const { lines } = renderFrame(setTab(s0, tab), cols, rows);
        expect(lines).toHaveLength(rows);
        for (const l of lines) expect(visibleWidth(l)).toBeLessThanOrEqual(cols);
      });
    }
  }

  test('fleet tab shows all six demo hosts', () => {
    const text = renderFrame(setTab(s0, 'fleet'), 120, 40).lines.map(stripAnsi).join('\n');
    for (const name of ['atlas', 'forge', 'basalt', 'mica', 'vpn-kiku', 'vpn-cedar']) {
      expect(text).toContain(name);
    }
  });

  test('agents tab shows personas, loops and openclaw agents', () => {
    const text = renderFrame(setTab(s0, 'agents'), 120, 60).lines.map(stripAnsi).join('\n');
    expect(text).toContain('云雀');
    expect(text).toContain('build-bot');
    expect(text).toContain('newsbot');
  });

  test('alerts tab shows the active crit problem with its push status', () => {
    const text = renderFrame(setTab(s0, 'alerts'), 120, 60).lines.map(stripAnsi).join('\n');
    expect(text).toContain('map-snapshotter failed');
    expect(text).toContain('飞书✓');
  });

  test('vpn tab shows both boxes; cedar flags the pending update + short cert', () => {
    const text = renderFrame(setTab(s0, 'vpn'), 120, 40).lines.map(stripAnsi).join('\n');
    expect(text).toContain('vpn-kiku');
    expect(text).toContain('vpn-cedar');
    expect(text).toContain('→1.12.4'); // update badge
    // Math.floor across the render-time gap can read 11d or 12d — both are the badge.
    expect(text).toMatch(/cert 1[12]d!/); // expiring cert badge
  });

  test('fixture stream is deterministic per timestamp', () => {
    const t = Date.parse('2026-07-16T12:00:00Z');
    expect(JSON.stringify(buildFleetState(t))).toBe(JSON.stringify(buildFleetState(t)));
  });
});
