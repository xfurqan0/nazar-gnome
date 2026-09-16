# Nazar for GNOME

Your Claude Code and Codex quota, in the GNOME panel.

```
 70%          <- the bead, and the window that binds you

Claude                     max_20x · status line · read 1 m ago
  5 hours      ▓▓░░░░░░░░    12 %   resets 06:10 · in 2 h 14 m
  week         ▓▓░░░░░░░░    18 %   resets 12 Sept 05:00 · in 5 d 4 h
  week · Fable ▓▓▓░░░░░░░    23 %   resets 12 Sept 05:00 · in 5 d 4 h
Codex                      plus · rollout log · read 1 m ago
  5 hours      ▓▓▓▓▓░░░░░    54 %   resets 04:41 · in 1 h 12 m
  week ◂       ▓▓▓▓▓▓▓░░░    70 %   resets 11 Sept 12:00 · in 4 d 3 h
  ─────────────────────────────────────────────────────────────
  nazar-tray is running (pid 162640, beating < 1 m ago)
  Open Nazar canvas
```

The number in the panel is the **binding** window — the one closest to full, because that
is the one that stops you. Amber at 60 %, red at 85 %, dimmed when nazar-tray is not
running, and `?` when a window could not be read, which is never a reassuring `0 %`.

## Screenshot

Not in the tree yet, and the sketch above is a drawing rather than a capture. A GNOME panel
can only be photographed from inside a logged-in session — under Wayland the Shell refuses a
screenshot to anything that is not a person pressing a key, which is a restriction worth
having and the reason this section is a note instead of an image.
[docs/screenshots/README.md](docs/screenshots/README.md) says which two shots to take and
what to check before committing one.

## What it is

Four files of hand-written GJS that read one file: `~/.nazar/limits.json`, which
[nazar-tray](https://github.com/xfurqan0/nazar-tray) already writes. That file is a
[published contract](https://github.com/xfurqan0/nazar-tray/blob/main/docs/limits-contract.md)
— one writer, many readers — so this extension has nothing to work out. It does not decide
what a window is, what "unknown" means or which window binds; the contract decided, and the
tray, the Waybar module, Nazar's own quota strip and this panel all agree because they read
the same document.

What it therefore never does:

- **No network.** Not a request, not a socket, not a library that could make one.
- **No subprocess.** It does not run `nazar-tray`, or any other program.
- **No credentials.** `limits.json` carries none by contract, and nothing else is opened.
- **No writing.** Not a cache, not a "last good value", not a lock. `~/.nazar` has one
  writer and this is not it.

## Why GNOME needs this, and where it does not

Stock GNOME has no system tray, so nazar-tray's own icon is invisible there unless you
install somebody else's AppIndicator bridge. Instead, run nazar-tray as the **engine** —

```sh
nazar-tray --headless
```

— which keeps measuring and keeps writing `limits.json` without trying to draw an icon
nobody can see, and let this extension be the face.

**On KDE, XFCE, Cinnamon, Budgie or a GNOME with AppIndicator already installed, do not
install this.** The tray icon works there and two indicators of the same number are noise,
not redundancy.

## Install

```sh
make zip
gnome-extensions install --force nazar-gnome@xfurqan0.github.io.shell-extension.zip
```

Then log out and back in — a Wayland session cannot load a new extension without it — and

```sh
gnome-extensions enable nazar-gnome@xfurqan0.github.io
```

Requires GNOME Shell 46 to 50. Only **50** has been run against; 46 to 49 use the same
ESM API and nothing outside it, but they are claimed rather than tested, and the honest
statement of that is here rather than nowhere.

## What the panel says

| | |
|---|---|
| `70%` | The binding window, rounded **down**. 99.6 % is `99%`, because a panel that says a window is spent when it is not is wrong at the moment it matters most. |
| `?` | Nothing could be read. Not "nothing has been used" — the two are opposite messages to somebody about to start a long task. |
| amber, red | 60 % and 85 %, the thresholds nazar-tray itself warns at. |
| dimmed | nazar-tray is not running. The number stays, because it was true when it was written and quota does not burn while nothing is using it. |

The menu lists every window both providers report, shortest first, with `◂` on the one that
binds. Window names come from `windowMinutes` rather than from a list of keys, so a window
a future nazar-tray adds — Claude's model-scoped weeklies were exactly that — appears
without a new release of this extension.

"nazar-tray is running" is answered by `~/.nazar/limits.lock`, in the order the contract
gives: a `pid` the kernel has never heard of means the writer is gone **now**, and only a
pid that cannot be asked about falls back to the heartbeat's five minutes. It is never
guessed from the age of `limits.json`, which the tray rewrites only when the numbers move —
a week-old document beside a fresh heartbeat is a quiet week, not a broken tray.

## Tested

```sh
make check
```

27 tests under plain `gjs -m tests/run.js`: the panel number, the rounding, the unknown
state, the tie-breaks, the tray's four pulses, a damaged document, a schema version from
the future, and a source-level check that this extension contains no way to open a socket,
run a program or write a file. The fixture is nazar-tray's own
`fixtures/limits.sample.json`, copied as its contract asks consumers to copy it, and every
case derives its document from that sample rather than committing a second one.

The Shell half was driven through all six states in a nested GNOME 50 session: the panel
followed a renamed `limits.json` in **under a second** each time, ten disable/enable cycles
left exactly one panel button and no JS errors, and `disable()` left nothing behind.

## What it is not

It is not a settings page, a notifier, or a second copy of the tray's panel. There are no
preferences in v1 and no translations; there are no notifications, because nazar-tray
already sends those and a second source would double every warning. `usage/YYYY-MM.json` —
the usage history — is deliberately not read: a month of hourly token counts is a usage
profile, and the contract that describes it says no other program reads it.

## Licence

MIT. The bead is nazar-tray's, copied cell for cell, same author, same licence.
