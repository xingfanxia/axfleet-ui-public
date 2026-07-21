import { describe, expect, test } from 'bun:test';
import type { FleetHost, FleetState } from '../contracts/types';
import {
  applyFleet,
  applyFleetError,
  applyStreamDown,
  cycleTab,
  cycleTokensRange,
  followSel,
  initialState,
  moveSel,
  selectedHostId,
  setTab,
  TABS,
  tokensSwipeIntent,
} from './state';

function host(id: string, singbox = false): FleetHost {
  return {
    host_id: id,
    display_name: id,
    role: 'r',
    reachable: true,
    expected_flaky: false,
    stale_sec: 0,
    tailnet_ip: '100.64.0.1',
    snapshot: singbox ? ({ singbox: { available: true } } as unknown as FleetHost['snapshot']) : null,
  } as FleetHost;
}

function fleet(hosts: FleetHost[]): FleetState {
  return { hosts, problems: [], kpis: {} as FleetState['kpis'], tokens: {} as FleetState['tokens'], endpoints: [], events: [] };
}

describe('tab navigation', () => {
  test('cycleTab wraps both directions', () => {
    let s = initialState('http://hub');
    s = cycleTab(s, -1);
    expect(s.tab).toBe('alerts');
    s = cycleTab(s, 1);
    expect(s.tab).toBe('fleet');
  });

  test('setTab resets selection and scroll', () => {
    let s = { ...initialState('x'), sel: 3, scroll: 5 };
    s = setTab(s, 'vpn');
    expect(s.sel).toBe(0);
    expect(s.scroll).toBe(0);
  });
});

describe('selection', () => {
  test('moveSel clamps to host count on fleet tab', () => {
    let s = applyFleet(initialState('x'), fleet([host('a'), host('b')]), 0, 'sse');
    s = moveSel(s, +5);
    expect(s.sel).toBe(1);
    s = moveSel(s, -5);
    expect(s.sel).toBe(0);
  });

  test('vpn tab selects only singbox hosts', () => {
    let s = applyFleet(initialState('x'), fleet([host('atlas'), host('vpn-kiku', true)]), 0, 'sse');
    s = setTab(s, 'vpn');
    expect(selectedHostId(s)).toBe('vpn-kiku');
    s = moveSel(s, +3); // only one vpn host — stays put
    expect(s.sel).toBe(0);
  });

  test('followSel scrolls to keep the cursor visible on short terminals', () => {
    let s = applyFleet(initialState('x'), fleet([host('atlas'), host('forge'), host('basalt'), host('mica')]), 0, 'sse');
    // bodyH 2: moving to row 3 must scroll down…
    s = followSel({ ...s, sel: 3 }, 2);
    expect(s.scroll).toBe(2);
    // …and moving back to row 0 must scroll up.
    s = followSel({ ...s, sel: 0 }, 2);
    expect(s.scroll).toBe(0);
  });

  test('applyFleet clamps a now-out-of-range selection', () => {
    let s = applyFleet(initialState('x'), fleet([host('a'), host('b'), host('c')]), 0, 'sse');
    s = moveSel(s, 2);
    s = applyFleet(s, fleet([host('a')]), 1, 'sse');
    expect(s.sel).toBe(0);
  });
});

describe('connection status', () => {
  test('sse vs poll set conn accordingly; error keeps last data', () => {
    let s = applyFleet(initialState('x'), fleet([host('a')]), 0, 'sse');
    expect(s.conn).toBe('live');
    s = applyFleet(s, fleet([host('a')]), 1, 'poll');
    expect(s.conn).toBe('polling');
    s = applyFleetError(s, 'ECONNREFUSED');
    expect(s.conn).toBe('lost');
    expect(s.fleet).not.toBeNull();
  });

  test('a stream drop degrades live → polling WITHOUT raising an error', () => {
    // Stream drops are routine (fetch timeouts, idle NAT, hub restart) — the
    // red footer must stay reserved for real fetch failures.
    let s = applyFleet(initialState('x'), fleet([host('a')]), 0, 'sse');
    s = applyStreamDown(s);
    expect(s.conn).toBe('polling');
    expect(s.fleetError).toBeNull();
    expect(s.fleet).not.toBeNull();
  });

  test('a stream drop never un-loses a lost link', () => {
    let s = applyFleetError(applyFleet(initialState('x'), fleet([host('a')]), 0, 'sse'), 'down');
    s = applyStreamDown(s);
    expect(s.conn).toBe('lost'); // still lost — polling is failing too
  });
});

describe('tokens range', () => {
  test('cycles through ranges and invalidates the cache', () => {
    let s: ReturnType<typeof initialState> = { ...initialState('x'), tokensFetchedAt: 123 };
    s = cycleTokensRange(s);
    expect(s.tokensRange).toBe('7d');
    expect(s.tokensFetchedAt).toBeNull();
  });

  test('full traversal in both directions (every hop pinned, not just the wraps)', () => {
    const forward = ['7d', '30d', '90d', 'all', 'today'];
    const backward = ['all', '90d', '30d', '7d', 'today'];
    let s = initialState('x'); // today
    for (const want of forward) {
      s = cycleTokensRange(s, 1);
      expect(s.tokensRange).toBe(want as ReturnType<typeof initialState>['tokensRange']);
    }
    for (const want of backward) {
      s = cycleTokensRange(s, -1);
      expect(s.tokensRange).toBe(want as ReturnType<typeof initialState>['tokensRange']);
    }
  });

  test('backward cycle invalidates the cache too', () => {
    const s = cycleTokensRange({ ...initialState('x'), tokensFetchedAt: 123 }, -1);
    expect(s.tokensRange).toBe('all');
    expect(s.tokensFetchedAt).toBeNull();
  });

  test('resets scroll — the new range starts at the top', () => {
    const s = cycleTokensRange({ ...initialState('x'), scroll: 12 });
    expect(s.scroll).toBe(0);
  });
});

describe('tokens swipe routing', () => {
  test('overflowing body → swipes always scroll (edge-cycling was rejected in review)', () => {
    expect(tokensSwipeIntent(10, true)).toBe('scroll');
    expect(tokensSwipeIntent(10, false)).toBe('scroll');
    expect(tokensSwipeIntent(1, true)).toBe('scroll');
  });

  test('body fits → a settled swipe cycles', () => {
    expect(tokensSwipeIntent(0, true)).toBe('cycle');
  });

  test('body fits → burst tail is swallowed until settled', () => {
    expect(tokensSwipeIntent(0, false)).toBe('ignore');
  });
});

describe('tabs constant', () => {
  test('all seven tabs are present in order', () => {
    expect(TABS).toEqual(['fleet', 'vpn', 'agents', 'tokens', 'accounts', 'gateways', 'alerts']);
  });
});
