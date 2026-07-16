/**
 * Frame composer — header, tab bar, body pane, footer. Pure: (state, cols,
 * rows) → exactly `rows` lines, every line ≤ `cols` cells. The body pane is
 * scroll-clipped here; panes just return their full content.
 */
import { ago } from '../../lib/format';
import { truncate, visibleWidth } from '../ansi';
import { paint } from '../theme';
import { TABS, type AppState, type Tab } from '../state';
import { renderAgents } from './agents';
import { renderAlerts } from './alerts';
import { renderAccounts } from './accounts';
import { renderFleet } from './fleet';
import { renderGateways } from './gateways';
import { renderVpn } from './singbox';
import { renderTokens } from './tokens';

const TAB_LABELS: Record<Tab, string> = {
  fleet: 'Fleet',
  vpn: 'VPN',
  agents: 'Agents',
  tokens: 'Tokens',
  accounts: 'Accounts',
  gateways: 'Gateways',
  alerts: 'Alerts',
};

export interface Frame {
  lines: string[];
  /** total body-pane lines before clipping — index.ts uses it to clamp scroll */
  bodyTotal: number;
}

export function renderFrame(s: AppState, cols: number, rows: number): Frame {
  const bodyH = Math.max(1, rows - 4);
  const pane = renderPane(s, cols, bodyH);
  const body = pane.slice(s.scroll, s.scroll + bodyH);
  while (body.length < bodyH) body.push('');
  const lines = [header(s, cols), tabBar(s, cols), paint('─'.repeat(cols), { fg: 'line' }), ...body, footer(s, cols)];
  return { lines: lines.map((l) => truncate(l, cols)), bodyTotal: pane.length };
}

function renderPane(s: AppState, cols: number, bodyH: number): string[] {
  switch (s.tab) {
    case 'fleet':
      return renderFleet(s, cols, bodyH);
    case 'vpn':
      return renderVpn(s, cols, bodyH);
    case 'agents':
      return renderAgents(s, cols);
    case 'tokens':
      return renderTokens(s, cols);
    case 'accounts':
      return renderAccounts(s, cols);
    case 'gateways':
      return renderGateways(s, cols);
    case 'alerts':
      return renderAlerts(s, cols);
  }
}

function header(s: AppState, cols: number): string {
  const title = paint(' AXFLEET ', { fg: 'accent', bold: true });
  const k = s.fleet?.kpis;
  const kpiParts: string[] = [];
  if (k) {
    kpiParts.push(paint(`${k.hosts_up}/${k.hosts_total} up`, { fg: k.hosts_up === k.hosts_total ? 'success' : 'danger' }));
    kpiParts.push(paint(`${k.services_ok}/${k.services_expected} svc`, { fg: k.services_ok === k.services_expected ? 'dim' : 'warning' }));
    if (cols >= 76) kpiParts.push(paint(`${k.agents_active} agents`, { fg: 'dim' }));
    if (k.problems > 0) kpiParts.push(paint(`${k.problems} problem${k.problems > 1 ? 's' : ''}`, { fg: 'danger', bold: true }));
    if (cols >= 76 && k.today_cost_usd != null) kpiParts.push(paint(`$${k.today_cost_usd.toFixed(2)} today`, { fg: 'accent2' }));
  }
  const left = title + paint('· ', { fg: 'faint' }) + kpiParts.join(paint(' · ', { fg: 'faint' }));
  const right = connStatus(s);
  const gap = cols - visibleWidth(left) - visibleWidth(right);
  if (gap < 1) return truncate(left, cols);
  return left + ' '.repeat(gap) + right;
}

function connStatus(s: AppState): string {
  const upd = s.lastUpdate ? ago(new Date(s.lastUpdate).toISOString()) : '—';
  switch (s.conn) {
    case 'live':
      return paint('● live ', { fg: 'success' }) + paint(upd, { fg: 'faint' });
    case 'polling':
      return paint('◌ poll ', { fg: 'warning' }) + paint(upd, { fg: 'faint' });
    case 'lost':
      return paint('✖ link lost ', { fg: 'danger', bold: true }) + paint(upd, { fg: 'faint' });
    default:
      return paint('… connecting', { fg: 'faint' });
  }
}

function tabBar(s: AppState, cols: number): string {
  const narrow = cols < 76;
  const parts = TABS.map((t, i) => {
    const label = narrow ? TAB_LABELS[t].slice(0, 3) : TAB_LABELS[t];
    const probs = t === 'alerts' && s.fleet && s.fleet.problems.length > 0 ? paint(`(${s.fleet.problems.length})`, { fg: 'danger' }) : '';
    // narrow drops the number-label space too: 7 tabs must fit 45 cols
    const text = narrow ? `${i + 1}${label}${probs}` : `${i + 1} ${label}${probs}`;
    return t === s.tab ? paint('❯', { fg: 'accent', bold: true }) + paint(text, { fg: 'text', bold: true }) : ' ' + paint(text, { fg: 'faint' });
  });
  return ' ' + parts.join(narrow ? ' ' : '  ');
}

function footer(s: AppState, cols: number): string {
  const err = s.fleetError && s.conn === 'lost' ? paint(` hub unreachable: ${s.fleetError} · retrying `, { fg: 'danger' }) : null;
  if (err) return truncate(err, cols);
  const keys = cols < 76 ? ' 1-7 tabs · jk move · r refresh · q quit' : ' 1-7/←→ tabs · j/k move · t range · r refresh · q quit';
  const hub = s.hubUrl.replace(/^https?:\/\//, '');
  const gap = cols - visibleWidth(keys) - visibleWidth(hub) - 1;
  const right = gap >= 1 ? ' '.repeat(gap) + hub : '';
  return paint(keys, { fg: 'faint' }) + paint(right, { fg: 'faint' });
}
