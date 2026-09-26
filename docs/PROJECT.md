# PROJECT

What this repository is for, what it will not grow into, and what has to be true before it
is submitted anywhere.

## Why it exists

nazar-tray measures two quota windows and writes them to `~/.nazar/limits.json`. On Windows
it also draws them, in the notification area. On a stock GNOME there is no notification
area, so the icon is invisible and the product looks broken on the desktop where the
measurement still works perfectly.

The answer is not to make the tray work on GNOME. It is to let GNOME read the file:
nazar-tray runs as the engine (`--headless`), this extension is the face, and the split
costs nothing because `limits.json` was written as "one writer, many readers" from the
start. Three readers now share it — Nazar's quota strip, the Waybar module in nazar-tray's
own `faces/`, and this — and not one line of the contract changed to admit any of them.

## The contract

[`docs/limits-contract.md`](https://github.com/xfurqan0/nazar-tray/blob/main/docs/limits-contract.md)
in nazar-tray. The rules this extension is built on, in the order they matter:

1. **A window with no `percent` is unknown**, and unknown is drawn as `?`, never as `0 %`.
2. **Rounding happens at display time, downwards.** 99.6 % is 99 %.
3. **Derived values are the consumer's.** Which window binds, when it resets, how old a
   reading is and whether the tray is alive are all computed here, from the file plus the
   current time — never read out of the file as facts about a moment that has passed. The
   one exception is `binding`, which the file carries as a summary; where our arithmetic
   disagrees with it, the contract says to trust the arithmetic, and we do, always.
4. **Unknown fields, states and providers survive.** The window key set is never
   hard-coded: `windowMinutes` names a window, the object is iterated, and a provider a
   newer tray adds appears without a release here.
5. **Times are UTC in the file and local on screen.**
6. **A reading expires with the window it measured.** Ours rather than the contract's, and a
   consequence of rule 3: a percentage is a measurement of a window, so when that window is
   over the number is history. Either the tray says so — `state: "stale"` — or the window's
   `resetsAt` is behind the clock with no tray running to correct it; in both cases the menu
   shows `?` and the indicator has no reading behind it. A reset that has just passed with
   the tray **up** is left alone, because it
   re-reads within the minute and Claude's five-hour window renews from the first request of
   a session rather than on the clock. `panelReading` is the whole of this.

`lib/contract.js` is the whole of that, and it imports nothing — not `gi://`, not the Shell
— so `tests/run.js` can check every rule under plain `gjs -m`.

## Out of scope for v1

| Not here | Why |
|---|---|
| Preferences (`prefs.js`, a gschema) | Nothing to configure here. The thresholds are nazar-tray's, so that every face answers the same question the same way, and the gear at the foot of the menu opens the tray's own settings page (`nazar-tray --view settings`) rather than a second set of them. |
| Translations | English only. A locale layer is worth adding once the strings stop moving. |
| Notifications | nazar-tray already sends them. A second source doubles every warning. |
| A refresh button | The tray writes the file and the monitor notices; a refresh would mean either a subprocess or a file this extension is not allowed to write. `tray.request` is an *internal* format in nazar-tray, not part of the consumer contract, and opening it to consumers is a change in that repository first. |
| `usage/YYYY-MM.json` | The usage history is the user's own. A month of hourly token counts is a usage profile — when this machine works, how long the sessions are, which model does the heavy lifting — and the contract that describes it says no other program reads it. |
| Multi-account (`limits/<profile>.json`) | Reserved for schema v2 in the contract. A v1 consumer may assume the single file, and this one does. |

## Two things the nested session found that reading could not

Both were caught by driving a real Shell rather than by reasoning about one, and both are
now pinned by a test or a comment:

- **A rename arrives on the other argument.** The tray writes a temporary file beside the
  target and renames it over the top, and GIO reports that as one event whose `file` is the
  temporary name and whose `otherFile` is `limits.json`. A handler that reads only the
  first argument never fires; the panel then updates on the slow tick instead of within a
  second, which is exactly what the first run measured.
- **An empty menu never opens.** `PopupMenu.open()` returns immediately when the menu has
  no items, so an extension that fills its menu only when the menu opens has a button that
  does nothing. The menu is built with the data now, and the open handler only refreshes
  the countdowns.

## Review rules this is built against

`gjs.guide/extensions/review-guidelines`, the two sections that reject extensions:

- **No binaries, no privilege elevation, and nothing started on its own.** No binary is
  shipped, nothing is elevated, and nothing at all runs on a tick, on a timer or when the
  panel is drawn. One command can be launched, `nazar-tray --view settings`, and only from
  the `activate` handler of the gear a person clicked: it goes to the session through an app
  info and the session's launch context, the way a `.desktop` entry does, so the Shell never
  becomes anybody's parent. A test counts the launches in the tree, counts the call sites,
  and fails if either grows.
- **`disable()` undoes `enable()`.** Every source removed, the monitor cancelled and
  disconnected, the cancellable cancelled, the button destroyed, every field dropped. A
  test reads both bodies and fails if `enable()` sets a field that `disable()` does not let
  go of; a nested session ran ten disable/enable cycles and ended with one panel button and
  no errors.
- **No excessive logging.** Nothing is logged in the ordinary path — not a read, not a
  render. A genuine failure logs one line, and the same line is not logged twice.
- **Small and readable.** Hand-written, one purpose, no minification, and deliberately
  short: the review queue prioritises small diffs.

## Versions

`shell-version` claims 46 to 50. **50.4 is the only one this has been run on**, on Fedora
44 Wayland; 46 to 49 share the GNOME 45+ ESM API and this extension uses nothing outside
it, but the claim is inherited rather than measured, and saying so is cheaper than being
told.

No `version` key in `metadata.json`: extensions.gnome.org assigns that number. No
`session-modes`: `user` is the default and saying it is noise.

Every `St.BoxLayout` here is horizontal and none of them says so. The
`vertical`/`orientation` property is the one piece of API under extensions that has moved
between GNOME 45 and 51, and a face that never sets it does not have to care which spelling
a given Shell wants.

## Publishing

Two routes, and they are not exclusive:

1. **A GitHub release zip** — `make zip`, then `gnome-extensions install`. Immediate, no
   review, our own pace, no automatic updates.
2. **extensions.gnome.org** — discoverable and self-updating, at the cost of a volunteer
   human review with no promised turnaround. Submitting is a public act: the account, the
   description, the screenshot and the review correspondence are all outward-facing, and
   the text goes past the maintainer before it is sent.

Both are written out step by step in [RELEASE.md](RELEASE.md), including the two version
numbers that are easy to confuse — the tag, which is ours, and the whole number the store
assigns on every upload — and a rule-by-rule reading of what the review looks for against
what is actually in this repository.

## Work packages

v1 landed as one piece, so this table starts where the repository began changing for a
reason it did not think of first.

| WP | What | Acceptance | State |
|---|---|---|---|
| G-WP1 | Drop the "Open Nazar canvas" menu item | No menu row, no loopback URL, no call that leaves the process for one; the source check fails if either name comes back | landed 2026-09-23 |
| G-WP2 | A gear that opens nazar-tray's settings page | One row at the foot of the menu launching `nazar-tray --view settings` from its `activate` handler; insensitive with a reason when the tray is not on the path; one launch and one call site, both counted by a test | landed 2026-09-23 |
| G-WP3 | A reading expires with the window it measured | `panelReading` refuses the number when the binding window is `stale`, or its reset has passed with no tray running; a reset that has passed with the tray up is kept; cannot-tell keeps it; the refused row's detail carries the cause | landed 2026-09-23 |
| G-WP4 | A dead tray that cannot be misread | Panel dims to 0.4 **and** the value carries a marker; the marker's glyphs are in both Cantarell and Adwaita Sans, pinned by a test | landed 2026-09-23, the marker half superseded by G-WP7 |
| G-WP5 | The engine is part of the install | README says the engine must run and how to autostart it, and says why the extension will not do that itself | landed 2026-09-23 |
| G-WP6 | One D-Bus method, so Nazar can raise a terminal | `org.gnome.Shell.Extensions.Nazar.Raise(au pids, s title_hint) → (b raised, s detail)` at `/org/gnome/Shell/Extensions/Nazar`; the choice of window is pure and in `lib/raise.js`; exported once in `enable()`, unexported in `disable()`, both counted by a test; the interface declares one method and no property or signal; a pid outside the caller's list is never raised; every branch driven over a nested session's own bus | landed 2026-09-23 |
| G-WP7 | The bead alone in the panel | The indicator carries the bead and no label: no percentage, no `?`, no dead-tray marker, and `_render` writes no text; severity and the numbers are the menu's, the fade at 0.4 stays, and a test fails the day a label comes back | landed 2026-09-26 |

## Log

Dated notes for the things that were measured rather than reasoned about, newest last.

### 2026-09-23 · four days of a number that was not wrong about anything

The engine stopped on 17 September and nothing noticed. On the 19th the weekly window it had
last measured reset. On the 23rd the panel was showing **67 %**, the menu said *reset was due
19 Sept 02:00* under it, the indicator had been dimmed the whole time — and the real figure,
once an engine was running again, was **5 %**.

Every individual thing the code did was defensible, which is what makes it worth a log entry:

- The number was a true reading, taken while the tray was alive, and the old rule kept it on
  the honest argument that quota does not burn while nothing is using it. That argument has a
  deadline and the code did not know it: it is valid exactly until the window resets, and
  after that the reading is not stale — it is the wrong answer in the reassuring direction.
- The menu *did* report the expired reset. "reset was due" is a fact, sitting underneath a
  number in the same typeface as five other facts; it is not a warning, and it was not read
  as one.
- The dimming *was* applied, at 0.55, for four days. Nobody sees a dimmed panel beside an
  undimmed one, so it read as the way the panel looks.

So three changes rather than one, because any single one of them would have left the failure
reachable: the reading now expires with its window (G-WP3, the rule is in the contract file
where a test can reach it), the dead-tray state changes the text and not only the paint
(G-WP4), and the README stops treating the engine as somebody else's problem (G-WP5). What is
deliberately *not* here is an extension that starts or restarts the engine: the fix for a
daemon that does not come back is an autostart entry, not a panel face growing the ability to
spawn things.

### 2026-09-23 · what `nazar-tray --view settings` actually does to a running engine

The gear launches the tray's documented settings command, so the question is what that
command does on the machine this extension is for: a GNOME session with the tray already
running headless, which is the only configuration the README recommends. Measured against
the engine that was up at the time (pid 88706, `nazar-tray --headless`, GNOME Shell 50.4,
Fedora 44 Wayland), with `setsid -f nazar-tray --view settings` and six seconds of watching:

- The launched process **printed `nazar-tray is already running (pid 88706); asked it to
  show its panel` and exited immediately.** There is never a second `nazar-tray` in the
  process table; the request is handed to the instance that holds the lock.
- **The engine survives.** `limits.lock` still carried pid 88706 afterwards and its
  `heartbeatAt` kept advancing across every attempt (10:03:02 → 10:03:17 → 10:06:32 UTC).
  Nothing about the gear costs the measurement, which was the thing worth being sure of.
- **The engine reacts.** Idle, the engine and its WebKit web process burned 0 and 1 clock
  ticks over six seconds; over the six seconds after the request, 3 and 6. A headless engine
  still builds its webview at startup — both WebKit helper processes date from the engine's
  own start — so waking both of them is what showing that window looks like from outside.
- **Whether a window appeared on screen is not something this was able to confirm.** Under
  Wayland the Shell refuses a screenshot to anything but a keypress, and both
  `org.gnome.Shell.Eval` and `org.gnome.Shell.Introspect.GetWindows` answer *not allowed* to
  an ordinary caller — the same restriction that keeps this repository's screenshots a note
  instead of a file. The CPU evidence says the panel was drawn; the last step of that is for
  a person with the session in front of them, and it is on the release checklist.

Two things about nazar-tray 0.2.0 came out of the same hour and belong in **its** tracker
rather than here: the single-instance path reports only "asked it to show its panel"
regardless of which `--view` page was requested, so there is no way to tell from the outside
whether `settings` was honoured; and `nazar-tray --help` does not print a usage message —
with an instance running it is treated as a request to show the panel, and with none running
it starts the application. Neither changes what the gear should do: the command is correct
against the tray's own CLI contract, and it stays.

### 2026-09-23 · what the nested session could check, and what it could not

The harness, because the command matters as much as the result: the zip from `make zip`
unpacked into a scratch `XDG_DATA_HOME`, a scratch `NAZAR_HOME` holding fabricated documents,
and

```sh
GSETTINGS_BACKEND=memory dbus-run-session -- \
  gnome-shell --headless --virtual-monitor 1280x720
```

with the extension enabled over that session's own bus
(`org.gnome.Shell.Extensions.EnableExtension`) so that the write lands in the memory backend
and not in the live session's dconf. That precaution is not theoretical: a nested Shell
started without it once turned off twelve of the maintainer's extensions. `gsettings get
org.gnome.shell enabled-extensions` was compared before and after and came back identical.

Driven through seven documents — a live engine, a dead tray with the reset still ahead, a
dead tray with the reset gone by, a `stale` binding window, a damaged file, no file at all,
and the engine back — the extension reported `state: 1` with an empty `error` at every step,
and again after ten disable/enable cycles. The Shell's own log carried no JS error, no
warning from this extension and nothing about a missing icon, which is the evidence that
`emblem-system-symbolic` resolves and that the new menu row builds.

What it could not do is look at the result. `org.gnome.Shell.Screenshot` answered
*Screenshot is not allowed* in the nested session too, and `org.gnome.Shell.Eval` is closed
outside unsafe mode, so the panel's actual text — the marker, the `?`, the gear's glyph — is
still something only a person in a real session can confirm. That is the same wall
[screenshots/README.md](screenshots/README.md) describes, met from the other side, and it is
why those three lines are on the release checklist.

### 2026-09-23 · a face that grew a verb, and what the nested session said about it

This repository was built on the claim that it is a **reader**: one file in, a panel out, and
nothing in it that acts on the session. G-WP6 is the first thing that acts, so it is worth
writing down why it is not a hole in that claim.

Nazar's desktop shell draws a canvas of running Claude Code sessions and wants a double-click
on a card to put that session's terminal in front of you. Under Wayland it cannot: a client
may not raise a window it does not own, which is the protocol working as designed and not an
omission. The only process in the session that *can* is the compositor. So either Nazar does
without on the desktop where most of its users are, or something inside gnome-shell lends it
the one verb — and the thing inside gnome-shell that both projects already share is this
extension. One method, two out arguments, no state: `Raise(au pids, s title_hint) → (b raised,
s detail)`.

The part that took the thinking is that the caller cannot name a window, or even the pid that
owns one. On this machine the session's own chain is `claude(79700) → bash(79153) →
ptyxis-agent(7774) → ptyxis(7766)`, and the window belongs to the last of those. Nazar knows
the first. So what crosses the bus is the **whole chain, nearest ancestor first**, and the side
that can see windows walks it until a pid turns out to own something. The alternative was for
Nazar to guess which ancestor is the emulator by name, which means a list of terminal names in
a program that has no business knowing any of them.

One pid with several windows is then the ordinary case rather than the exotic one — Ptyxis,
gnome-terminal and kgx are each a single process with a window per window — so the pick is
ranked: the window whose title contains the hint Nazar sends (the session's own title, which
the emulator usually puts in the title bar), and failing that the most recently used, with the
detail string saying which of the two happened. All of that is in `lib/raise.js`, which imports
nothing, for the same reason `lib/contract.js` imports nothing: the extension does the two
things only a Shell can do — list windows, activate one — and the decision is somewhere a test
can drive it through a window list that never existed.

**Measured in the nested session**, harness exactly as the entry above (scratch
`XDG_DATA_HOME`, `GSETTINGS_BACKEND=memory dbus-run-session -- gnome-shell --headless
--virtual-monitor 1280x720 --wayland-display nazar-nested`, extension enabled over that
session's own bus; `gsettings get org.gnome.shell enabled-extensions` identical before and
after). `gdbus introspect` on `/org/gnome/Shell/Extensions/Nazar` printed the interface with
`Raise(in au pids, in s title_hint, out b raised, out s detail)` and nothing else. Then, with
a two-window GJS/GTK4 process (pid 159010, titles *nazar alpha window* and *nazar beta
window*) and a `gnome-text-editor` with one window (pid 158357):

| Call | Answer |
|---|---|
| `Raise([158357], "")` — one normal window | `(true, 'raised org.gnome.TextEditor')` |
| `Raise([424242], "")` — a pid nobody owns | `(false, 'no window owns any of 1 pids')` |
| `Raise([424242, 424243, 158357], "")` — the owner is third in the chain | `(true, 'raised org.gnome.TextEditor')` |
| `Raise([], "")` | `(false, 'no usable pid was given')` |
| `Raise([159010], "")` — two windows, no hint | `(true, 'raised gjs; 2 windows share the pid, took the most recent')` |
| `Raise([159010], "alpha")` | `(true, 'raised gjs; 2 windows share the pid, took the title match')` |
| `Raise([159010], "NAZAR ALPHA")` — case | `(true, 'raised gjs; 2 windows share the pid, took the title match')` |
| `Raise([159010], "gamma")` — a hint nothing carries | `(true, 'raised gjs; 2 windows share the pid, took the most recent')` |
| after `DisableExtension` | `GDBus.Error:org.freedesktop.DBus.Error.UnknownMethod: object does not exist at path` |
| after ten disable/enable cycles | `(true, 'raised gjs; 2 windows share the pid, took the title match')`, `state: 1`, empty `error`, no JS error in the Shell's log |

Three things that reading the code would not have produced:

- **`zenity --info` is useless as a test window.** It is a dialog, so `Raise` correctly
  declines to touch it — and that is the filter earning its place rather than a bug: a
  terminal's own dialogs, menus and tooltips are separate Meta windows carrying the *same*
  pid, and a jump that activates a tooltip appears to do nothing at all.
- **`gnome-text-editor` is no use for the multi-window case either**, because it is tabbed:
  a second invocation adds a tab to the one window. The two-windows-one-pid case had to be
  built on purpose, with two `Gtk.Window`s in one GJS process.
- **The error name a missing extension produces is `UnknownMethod`, not `UnknownObject`.**
  GDBus answers a call on an unexported path with `UnknownMethod` and the text *object does
  not exist at path*, so a caller that only maps `UnknownObject` to "the extension is not
  installed" will show the user a raw D-Bus error instead of a sentence. Nazar maps all four
  of `ServiceUnknown`, `UnknownObject`, `UnknownMethod` and `UnknownInterface` to the same
  advice for exactly this reason.

What the nested session still cannot say is whether a window visibly came to the front:
`org.gnome.Shell.Eval` is closed outside unsafe mode and `Introspect.GetWindows` answers *not
allowed*, which is the same wall as the screenshots. `Main.activateWindow` is used rather than
`meta_window.activate` on its own so that the two cases nobody would remember to ask for are
covered — Mutter's activate unminimises the window and its transient parents and moves to the
workspace it is on, and the Shell's wrapper closes the overview and the calendar, without which
a jump made from the Activities view focuses a window nobody can see. That the focus lands
where it should is a line for a person with the session in front of them, and it is on the
release checklist with the other three.
