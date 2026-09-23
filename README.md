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
  ⚙ Settings…
```

The number in the panel is the **binding** window — the one closest to full, because that
is the one that stops you. Amber at 60 %, red at 85 %, dimmed and marked `··` when
nazar-tray is not running, and `?` when a window could not be read or the reading has
outlived the window it measured — which is never a reassuring `0 %`.

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
- **Nothing started on its own.** No program runs on a tick, on a timer, when the panel is
  drawn or when the extension is enabled. The one command it can ever launch is
  `nazar-tray --view settings`, when a person clicks the gear at the foot of the menu — the
  tray's own settings page, because the thresholds this panel draws belong to the tray and
  a second place to set them would be one place too many. If `nazar-tray` is not on the
  path the row is still there, dimmed, saying so.
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

### And the engine, which is not optional

The extension reads a file; **nazar-tray writes it**. With no engine running there is
nothing to read, and after a while there is worse than nothing: a file whose windows have
since reset. So install [nazar-tray](https://github.com/xfurqan0/nazar-tray) and keep it
running headless.

```sh
nazar-tray --headless
```

That is one session. To have it back tomorrow, give the session an autostart entry —
`~/.config/autostart/nazar-tray.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=nazar-tray engine
Exec=nazar-tray --headless
NoDisplay=true
X-GNOME-Autostart-enabled=true
```

`NoDisplay=true` keeps it out of the applications grid — it draws nothing on GNOME by
design — and `X-GNOME-Autostart-enabled=true` is what GNOME's own session honours. Check it
after the next login:

```sh
pgrep -a nazar-tray                # nazar-tray --headless
cat ~/.nazar/limits.lock           # a pid, and a heartbeat less than a minute old
```

**This extension does not write that file for you**, and will not grow a button that does.
The review guidelines it is built against draw the line at an extension that starts
programs, and the rule this repository keeps is stricter than the line: nothing runs on a
tick, on a timer or while the panel is drawn. The single command it can launch is the tray's
own settings page, and only because somebody clicked the gear. An engine that has to be
running is a sentence in a README; an extension that quietly starts daemons is a different
kind of software.

This section exists because of where the four days of stale numbers started: no autostart
entry, an engine that did not come back after a restart, and a panel that was not emphatic
enough about it.

Requires GNOME Shell 46 to 50. Only **50** has been run against; 46 to 49 use the same
ESM API and nothing outside it, but they are claimed rather than tested, and the honest
statement of that is here rather than nowhere.

## What the panel says

| | |
|---|---|
| `70%` | The binding window, rounded **down**. 99.6 % is `99%`, because a panel that says a window is spent when it is not is wrong at the moment it matters most. |
| `?` | Nothing could be read, **or the reading has outlived its window** — see below. Not "nothing has been used": the two are opposite messages to somebody about to start a long task. |
| amber, red | 60 % and 85 %, the thresholds nazar-tray itself warns at. |
| `5% ··` | nazar-tray is not running. The number stays while it can still be true — quota does not burn while nothing is using it — and the whole indicator dims to 0.4 **and** grows the two dots. Opacity alone is a difference you have to have seen the other state to notice, and this one went unnoticed for four days. |

A reading expires with the window it measured. If the binding window's reset has passed and
nazar-tray is **not** running, there is nothing left to correct the number and the panel
shows `?` rather than a percentage of a week that is over; the menu row says
`reset was due 02:00 Sat · tray not running`. The same applies the moment the tray marks a
window `stale`, which is that program saying it itself. While the tray *is* running a reset
that has just gone by is left alone, because the tray re-reads within the minute and Claude
Code's five-hour window renews from the first request of a new session rather than on the
clock.

This is not a small distinction. A panel showing a real number from a dead engine is wrong
in the reassuring direction, which is the expensive one: 67 % of a weekly window that had
reset four days earlier reads as "a third left", and the machine was at 5 %.

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

35 tests under plain `gjs -m tests/run.js`: the panel number, the rounding, the unknown
state, the expiry rule and each of its five cases, the tie-breaks, the tray's four pulses, a
damaged document, a schema version from the future, and source-level checks that this
extension contains no way to open a socket or write a file, that the one program it can
launch is launched from a click and nowhere else, and that the dead-tray marker is a glyph
both panel fonts carry. The fixture is nazar-tray's own `fixtures/limits.sample.json`,
copied as its contract asks consumers to copy it, and every case derives its document from
that sample rather than committing a second one.

The Shell half was driven through its states in a nested GNOME 50 session: the panel
followed a renamed `limits.json` in **under a second** each time, ten disable/enable cycles
left exactly one panel button and no JS errors, and `disable()` left nothing behind. The
nested session runs with `GSETTINGS_BACKEND=memory` inside `dbus-run-session`, which matters
more than it sounds: a nested Shell started without that writes its settings to the **live**
session's dconf, and the first run of this repository's harness switched off twelve of the
maintainer's extensions by doing exactly that.

## What it is not

It is not a settings page, a notifier, or a second copy of the tray's panel. There are no
preferences in v1 and no translations — the gear opens the tray's settings, it does not
reimplement them; there are no notifications, because nazar-tray
already sends those and a second source would double every warning. `usage/YYYY-MM.json` —
the usage history — is deliberately not read: a month of hourly token counts is a usage
profile, and the contract that describes it says no other program reads it.

## Licence

MIT. The bead is nazar-tray's, copied cell for cell, same author, same licence.
