# axfleet-ui-public

The **axfleet** TUI — a full-screen terminal dashboard for a fleet of agent
hosts — extracted as a public, self-contained demo. **Everything it shows is
fake**: the six hosts, every metric, token, cost, domain, and IP come from
generated fixture data (`fixtures/`). There is no network code; the "live"
stream is a simulated tick that regenerates the fleet state every few seconds,
so gauges drift and `ago` ages tick exactly like the real thing.

```
 AXFLEET · 5/6 up · 70/72 svc · 9 agents · 5 problems · $14.62 today                       ● live 0s
 ❯1 Fleet   2 VPN   3 Agents   4 Tokens   5 Accounts   6 Gateways   7 Alerts(5)
────────────────────────────────────────────────────────────────────────────────────────────────────
❯ ● atlas         cockpit · 云雀 · fleet hub              25c  60m  64d  svc 15/15
  ● forge         agent runner · persona fleet · factor…  35c  56m  71d  svc 24/26
  ● basalt        knowledge stack · gateways              21c  65m  58d  svc 25/25
  ◌ mica          asleep (expected)
  ● vpn-kiku      VPN · tokyo                              2c  35m  28d  svc 2/2
  ● vpn-cedar     VPN · oregon                            10c  34m  28d  svc 2/2

┌─ atlas · cockpit · 云雀 · fleet hub ────────────────────────────── up 41d · linux · snap 6s ago ─┐
│ cpu ▮▮▮▮▮▮▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯  25%  load 0.6 0.5 0.4 · 4c                                        │
│ mem ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▯▯▯▯▯▯▯▯▯▯  60%  9.9/16 GiB                                                   │
│ 48h ████████████████████████████████████████████████ cpu                                         │
│ dsk / 64% 38.4 GiB/60.0 GiB                                                                      │
│ net ts 100.64.0.11 · agents 1cl/0cx · mosh 1                                                     │
│ svc 15/15 running                                                                                │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
 1-7/←→/swipe tabs · j/k move · t range · r refresh · q/esc quit                demo · fixture data
```

## Run it

Requires [bun](https://bun.sh).

```bash
bun install
bun run tui              # the demo
bun run tui -- --compat  # force 256-color if your terminal lacks truecolor
bun run verify           # typecheck + 129 tests
```

Keys: `1-7` / `←→` / `tab` / `n`/`p` switch tabs · `j/k` move or scroll · `t`
cycles the token range · `r` refreshes · `q`/`esc` quits. Mouse and touch work
too (SGR mouse reporting): tap a tab label or a fleet/VPN row to select it,
scroll with the wheel or a drag, and a horizontally-locked drag-swipe switches
tabs. The layout is responsive down to ~45-column widths (Moshi portrait):
rows stack instead of truncating.

**Moshi note** (protocol reverse-engineered + verified end-to-end 2026-07):
Moshi's plain horizontal swipe never reaches a TUI as mouse data. Live
detection = the `moshi-hook` daemon doing a literal env read of `$TMUX_PANE` /
`$ZELLIJ` / `$HERDR_ENV` (precedence in that order); on detection, swipe sends
that multiplexer's prefix chord (`Ctrl-B n`/`p`). Two working recipes:

1. **Inside tmux** (Moshi's default attach) — install a conditional binding
   so the chord forwards into an axfleet pane instead of switching windows
   (the TUI advertises itself via an OSC 2 pane title):

   ```tmux
   bind-key n if-shell -F "#{m:axfleet*,#{pane_title}}" "send-keys n" "next-window"
   bind-key p if-shell -F "#{m:axfleet*,#{pane_title}}" "send-keys p" "previous-window"
   ```

2. **Bare (non-tmux) session** — launch with `HERDR_ENV=1 HERDR_SESSION=<name>`
   so detection reports `kind: herdr`; the TUI speaks the `Ctrl-B n/p` chord
   directly.

Zero-config alternatives: tap the tab labels, D-pad `←`/`→`, `n`/`p` keys, or
Mouse Mode drag-swipe. Vertical swipes and taps work out of the box.

On the Tokens tab, a vertical swipe cycles the time range when the body fits
the pane (the normal phone-portrait case) — wheel bursts are debounced by a
settle window and a drag may cycle at most once per gesture. When the body
overflows, swipes scroll like every other tab (edge-cycling was rejected: the
tab opens at the top edge, so a reflexive desktop wheel-up would flip the
range) and the header hint stops advertising swipe. Tapping the range header
always cycles.

## The seven tabs

| Tab | What it shows |
|---|---|
| **Fleet** | Host rows (cpu/mem/disk cells + expected-service KPI) and a detail box with htop-style gauges, a 48h cpu sparkline, disks, tailnet line, and per-host problems |
| **VPN** | sing-box boxes: state, version + pending update, live ↑/↓ throughput sparklines, connected clients, 30d traffic, cert countdown, subscription links |
| **Agents** | zylos personas fleet-wide (runtime tier, context %, idle, unanswered-message alerts, today tokens/cost), standalone tmux codex loops with per-agent token joins, openclaw gateway + per-bot connectivity |
| **Tokens** | Cost + usage from the usage DB: totals, all-time, daily sparkline, spike flags, per-host and per-model bars; `t` cycles today/7d/30d/90d |
| **Accounts** | Provider account usage deduped across hosts (5h/7d/opus window bars, ccu-style), per-host daemon lines with switch forecasts, machine-wide token feeds, codex per-host snapshots with freshness grading, and per-host auth posture |
| **Gateways** | App-level health that "container is Up" misses: omni per-source sync freshness (the shared ok/flaky/syncing/stale/dead classifier), embed-queue backlog, New API channel health, Factorio server telemetry, newsletter rollups |
| **Alerts** | Active problems annotated with push-delivery status, the out-of-band DM log (delivered/failed, active/resolved), endpoint health, and the rolling event log |

## Building your own

The full methodology — architecture, ANSI width math, diffed painting, input
decoding (incl. what phone terminals actually send), gesture recognition,
hit-testing, narrow-mode rules, and the testing strategy — is written up for
reuse in [docs/tui-methodology.md](docs/tui-methodology.md).

## Architecture (what's real here)

This is the real TUI code from a private fleet dashboard, minus its backend:

- `contracts/types.ts` — the shared contract every surface renders from.
  Fixtures must satisfy it, so `tsc` guarantees the demo data is
  shape-complete.
- `tui/` — terminal adapter (alt-screen, raw keys, line-diffed paints),
  ANSI-aware width math (CJK-wide, escape-code-safe truncation), pure state
  transitions, and one pure renderer per tab. `tui/api.ts` is the only module
  that differs from the private build: it serves fixtures instead of HTTP+SSE.
- `lib/` — pure view-model builders and display transforms shared (in the
  private repo) between the web UI and the TUI so the two can't drift.
- `fixtures/` — the demo fleet. Metrics are smooth deterministic functions of
  `(key, time)` (`fixtures/noise.ts`), so live gauges and the 48h history
  sparklines always agree, with zero mutable state.

The theme is Catppuccin Mocha (a port of clauth's cloudy-ui), truecolor with
an xterm-256 fallback.

## License

MIT
