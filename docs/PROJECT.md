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

`lib/contract.js` is the whole of that, and it imports nothing — not `gi://`, not the Shell
— so `tests/run.js` can check every rule under plain `gjs -m`.

## Out of scope for v1

| Not here | Why |
|---|---|
| Preferences (`prefs.js`, a gschema) | Nothing to configure yet. The thresholds are nazar-tray's, so that every face answers the same question the same way. |
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
  panel is drawn.
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
