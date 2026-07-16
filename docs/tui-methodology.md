# Building a phone-friendly monitoring TUI — methodology

This document distills how the axfleet TUI is built so the same approach can
be reused for a different TUI. (Also packaged as the agent skill
[`tui-engineering`](https://github.com/xingfanxia/AX-skills/tree/main/tui-engineering)
— same content organized as SKILL.md + references with copy-ready code.) It is written for an implementing agent: every
rule states the failure it prevents, and every mechanism has a reference
implementation in this repo. The stack here is Bun + TypeScript with zero
terminal libraries — the whole terminal layer is ~500 lines you own — but the
architecture is stack-agnostic.

## 1. Architecture: pure core, one adapter

```
contracts/  typed data model — the single shape everything renders from
state.ts    app state + pure transitions: (state, event) → new state
render/     pure renderers: (state, cols, rows) → string[] (one per tab)
term.ts     THE ONLY module touching stdin/stdout (raw mode, paints, decode)
api.ts      data source behind a tiny interface (HTTP+SSE, or fixtures)
index.ts    impure event loop: wires term events → state → render → paint
```

Rules:

- **Everything except `term.ts` and `index.ts` is a pure function.** This is
  what makes the TUI testable without a TTY: layout bugs, input decoding, and
  gesture recognition are all plain unit tests.
- **State transitions return new objects** (`{ ...s, tab }`), never mutate,
  and return the *same* reference when nothing changed — the paint loop uses
  identity (`next === state`) to skip redraws.
- **The data source hides behind fetch/stream functions** with a
  failure-as-value result (`{ ok, data } | { ok, error }`). Swapping HTTP for
  fixtures (this demo) touches one file.

## 2. ANSI width math (`tui/ansi.ts`)

`String.length` is wrong twice in a terminal: escape codes count as characters,
and CJK/emoji occupy two cells. Every layout decision must go through one
module:

- `visibleWidth(s)` — strips ANSI, counts wide code points as 2 cells.
- `truncate(s, w)` — cuts at a cell boundary, preserves escape codes, appends
  `…` and a color RESET so a cut can never leak color into the next cell.
- `padEnd/padStart(s, w)` — pad by *visible* width.
- `wrapPlain(text, w)` — word-wrap plain text; hard-break over-long words
  (URLs) at the cell boundary.
- `packParts(parts, w)` (in `render/agents.ts`) — greedy-pack ` · `-separated
  metadata, breaking only *between* parts. Wrapping metadata with a word
  wrapper leaves dangling `·` at line ends; packing keeps units like
  `today 3.2M $1.80` whole.

If host names or labels can be bilingual, get the wide-char table right on day
one — mixed-width rows are the classic source of "the box borders are jagged".

## 3. Painting (`term.ts`)

- Enter: alternate screen (`\x1b[?1049h`) + hide cursor. Exit restores in
  reverse. **Register `uncaughtException`/`unhandledRejection` handlers that
  call `term.exit()` before dying** — a renderer crash must never strand the
  user in a raw-mode alt screen.
- **Line-diffed paints**: keep the previous frame's lines; rewrite only rows
  that changed, cursor-addressed (`\x1b[row;1H` + line + clear-to-EOL). A 1s
  clock tick then costs a few bytes, which matters over mosh/SSH. On resize,
  drop the previous frame (full repaint).
- The frame composer guarantees **exactly `rows` lines, each ≤ `cols` cells**
  — the terminal never soft-wraps, which would corrupt the diff.

## 4. The frame contract (`render/frame.ts`)

- Fixed chrome: row 0 header, row 1 tab bar, row 2 rule, rows 3..N-2 body,
  last row footer. **Export these as named constants** (`TAB_BAR_ROW`,
  `BODY_TOP_ROW`) — mouse hit-testing depends on them and magic numbers drift.
- Scroll is clipped at the frame level: tab renderers return their *full*
  content; the composer slices `[scroll, scroll+bodyH)` and reports
  `bodyTotal` so the event loop can clamp scrolling.
- The tab bar is **measured, not assumed**: build full labels, measure with
  `visibleWidth`, degrade to 3-letter labels if they don't fit. (Assuming a
  breakpoint left tabs truncated in a 4-column window of widths, 76–79.)
- The tab-bar builder returns **hit ranges** (`{tab, start, end}` per label)
  alongside the line — computed from the same string it renders, so click
  targets can't drift from pixels. `hitTab(ranges, x)` resolves a tap.

## 5. Input decoding (`term.ts`)

Raw mode delivers bytes; decode them with a **pure function**
`decodeEvents(chunk) → (key | mouse)[]` so every rule below is a unit test.

- Recognize the arrows/tab/enter you use in both CSI (`\x1b[A`) and SS3
  (`\x1bOA`) forms.
- **Consume unknown CSI/SS3 sequences through their final byte** (0x40–0x7E).
  Otherwise F5 (`\x1b[15~`) leaks `1`, `5` as number-key presses — in a TUI
  where digits switch tabs, that's a visible bug.
- **Split-chunk carry-over**: fast drags flood dozens of mouse reports and
  mosh/SSH can split one across reads. Hold back a trailing incomplete escape
  (`incompleteEscapeStart`), prepend it to the next chunk. Without this,
  `\x1b[<32;12` + `;5M` decodes as garbage and leaks digits.
- **Escape timeout**: a chunk ending in exactly `\x1b` is ambiguous — the ESC
  key, or a split sequence head. Hold it; if no continuation arrives in ~40 ms,
  flush-decode it (lone ESC ⇒ the ESC key). Never resolve this ambiguity
  eagerly if ESC quits your app: a drag flood would randomly quit it.

## 6. Mouse and touch

Enable SGR mouse reporting on enter, disable on exit (reverse order):

```
on:  \x1b[?1000h \x1b[?1002h \x1b[?1006h   (buttons + drags + SGR encoding)
off: \x1b[?1006l \x1b[?1002l \x1b[?1000l
```

Decode SGR reports `\x1b[<code;col;row(M|m)`: `code & 64` ⇒ wheel
(`code & 3`: 0 up, 1 down, 2 left, 3 right); else `m` ⇒ release, `code & 32`
⇒ drag, otherwise press. Coordinates are 1-based; convert once at the decoder.
Ignore `(code & 3) === 3` motion (mode 1003, not enabled).

### Gesture recognition (`tui/gesture.ts`)

A pure state machine over press/drag/release with a **direction lock**:

- No action until total travel from the press exceeds ~2 cells (wobble zone).
- Then lock an axis: horizontal if `|dx| ≥ 2·|dy|` in cells (cells are ~1:2
  w:h, so this ≈ a 45° physical threshold), else vertical.
- Vertical lock ⇒ emit scrolls that follow the finger (`lastY - y` per drag).
- Horizontal lock ⇒ emit **nothing** during the drag; at release, ≥5 cells of
  net horizontal travel ⇒ swipe.
- Release with no lock and ≤1 cell wobble ⇒ tap.

The naive version (emit scroll on every dy, veto swipe if "scrolled too much")
fails on real fingers: a horizontal swipe always wobbles across a few rows, so
it scroll-jitters the pane and then vetoes itself.

Wheel-left/right also switch tabs, **debounced (~250 ms)** — some terminals
report one swipe as a burst of tilt-wheel events.

### Hit-testing without a widget tree

No retained widgets — hit-testing is two rules:

- Tap on `TAB_BAR_ROW` → `hitTab(tabRanges, x)`.
- Tap in the body → `paneY = y - BODY_TOP_ROW + scroll`; if the current tab
  has a selectable list and `paneY < selectableCount`, select it. This works
  because of a **layout invariant: selectable lists render one line per item
  at the top of the pane** (item k is pane line k) — the same invariant the
  keyboard follow-selection logic uses. Guard this invariant in narrow-mode
  work: selectable rows may compress but must never become two lines.

### What phone terminals actually send (measured with Moshi, 2026-07)

| Phone action     | What the TUI receives                                        |
|------------------|--------------------------------------------------------------|
| tap              | SGR press + release at the cell                              |
| vertical pan     | a burst of wheel-up/down events                              |
| horizontal swipe | **nothing by default** — swipe is armed only when Moshi's live multiplexer detection fires. That detection (verified empirically) is the closed-source `moshi-hook` daemon doing a literal env read of `$TMUX_PANE` / `$ZELLIJ` / `$HERDR_ENV` — precedence in that order — and on detection swipe sends that multiplexer's prefix chord (`Ctrl-B n`/`p` for tmux/Herdr). The SSH preflight (`command -v tmux/zellij/herdr` + `herdr session list --json`) only drives the session picker. No plugin API; other TUIs report "no active window"; swipe is NOT bindable to custom keys — only tap/long-press/D-pad slots accept the custom shortcut builder. |
| Mouse-Mode drag  | press/drag/release forwarded to the TUI (gesture recognizer applies) |

Design consequences:

- **Never make swipe the only path to anything.** Tab labels are tappable and
  `1-9` direct-select always works — on phones, tap-the-label is the primary
  navigation, not a fallback.
- **Map arrow keys to next/prev** — phone terminals ship a D-pad, so `←`/`→`
  works with zero configuration — and expose single-key aliases too (`n`/`p`
  here) for custom D-pad/tap slots and for terminals whose gestures CAN send
  arbitrary keys.
- Keep the drag-swipe recognizer anyway — it works in Moshi's Mouse Mode and
  on desktop terminals that forward drags.
- **The impersonation path** (verified against `moshi-hook context`): because
  detection is a bare env read, a TUI launched with
  `HERDR_ENV=1 HERDR_SESSION=<name>` reports `kind: "herdr"` and arms swipe,
  which then delivers `Ctrl-B n`/`Ctrl-B p` as ordinary key input. Support
  the prefix chord (Ctrl-B, then n/p/digit, ~2s window, tmux-style swallow of
  unknown keys) and swipe becomes native. Preconditions: the moshi-hook
  daemon must be serving on the host, and the session must be a plain shell —
  `$TMUX_PANE` wins precedence, so inside a tmux-attached session the chord
  goes to tmux instead. The chord support is worth shipping regardless: it
  matches tmux/herdr muscle memory and is inert otherwise.

## 7. Responsive narrow mode (phone floor ≈ 45 cols)

- **Pick one narrow breakpoint** (`width < 60` here) and pass `width` into
  every renderer. Phones have abundant *rows* and starved *columns*, so the
  narrow strategy is: **stack, don't truncate**. A message wrapped onto an
  indented continuation line survives; a message truncated at 10 chars is
  gone — and on a monitoring tool the message IS the product.
- Exceptions — selectable list rows must stay one line each (see the hit-test
  invariant), so they *compress* instead: status words become glyphs
  (`running` → `●`), units abbreviate (`3.94 Mbps` → `3.9M`), healthy-state
  detail moves to the detail box and only warnings keep badges.
- **Shrink decoration before data**: a bar chart's bar gives up cells before
  the label does (a 5-cell bar next to a readable name beats a 7-cell bar next
  to `claude-opus-4-8…`).
- Right-aligned metadata (`as of 8m ago`) drops to its own line rather than
  colliding.
- Verify by *rendering*: dump every tab at 45×38 with fixture data and read
  it. The audit that drove this repo's narrow mode found six information-loss
  sites the width-limit tests couldn't see (they only assert lines *fit*, not
  that content *survives*).

## 8. Testing strategy

Layered, all runnable headless (`bun run verify`):

1. **Layout contract** (`render/frame.test.ts`) — for every tab × several
   sizes (45×30, 76×24, 120×40): exactly `rows` lines, every line's
   `visibleWidth ≤ cols`. This is the "never soft-wrap" guarantee.
2. **Information-survival assertions** — at 45 cols, the full text of things
   narrow mode must preserve (push messages, error details, forecasts, model
   names) appears in the rendered output. These pin the stack-don't-truncate
   behavior against regressions.
3. **Pure input tests** — key decode table, SGR mouse decode, the F-key
   digit-leak case, and a reassembly property test: split a mouse report at
   *every* byte boundary and assert carry-over + decode yields exactly one
   event with no key leaks.
4. **Gesture tests** — drive the state machine with event lists: tap, wobbly
   swipe (no scroll actions emitted), fast flick (press+release only),
   vertically-locked drag never swipes, sub-threshold wobble emits nothing.
5. **Hit-range tests** — ranges cover all tabs in order, stay in bounds at
   every size, and the midpoint of each label resolves to its tab.
6. **Demo e2e** — boot the app against shipped fixtures and walk every tab at
   several sizes. Catches "the fixture doesn't satisfy the contract" and
   "this tab crashes on empty data" classes.

Render tests initialize the theme in 256-color compat mode for deterministic
escape codes.

## 9. Deterministic demo fixtures (`fixtures/`)

For a shareable demo (or tests), generate metrics as a **pure function of
(key, time)** — layered incommensurate sine waves seeded by a string hash
(`fixtures/noise.ts`). Properties that matter:

- Live gauges and history sparklines *agree* (same function, different `t`),
  with zero mutable state.
- The "stream" is a `setInterval` re-invoking the builders — the real
  event-loop code runs unmodified.
- Day-sampled series must use a period that does **not** divide a day evenly,
  or the series aliases into a short repeating pattern (this repo uses
  `37 * DAY` for daily periods).
- Type fixtures against the same `contracts/` the renderers consume — `tsc`
  then proves the demo data is shape-complete.

## 10. Build order for a new TUI

1. `contracts/` — the data model, typed. Everything else renders this.
2. `ansi.ts` + tests — width math first; all layout flows through it.
3. `term.ts` — alt screen, raw mode, diffed paints, crash restore, pure
   `decodeEvents` with carry-over + escape timeout.
4. `state.ts` + tests — tabs, selection, scroll, data-application transitions.
5. `render/frame.ts` — chrome + one tab renderer; layout-contract test
   immediately (every future tab inherits it by being added to the loop).
6. Remaining tabs, one pure renderer each.
7. Fixtures + demo api — now the TUI runs headless and every later change is
   eyeball-verifiable without infrastructure.
8. Mouse: SGR decode → gesture machine → hit ranges. Tests before wiring.
9. Narrow-mode pass: render every tab at ~45 cols, catalog information loss,
   fix by stacking/compressing, pin with survival assertions.
10. Footer hints + README; keep key aliases bindable from phone-terminal
    gesture settings.
