# Screenshots

This directory is empty on purpose, and the README links to it rather than to an image,
because **nothing in this repository can take the picture.**

Under Wayland the Shell answers `org.gnome.Shell.Screenshot` with *Screenshot is not
allowed* unless the request came from the user pressing a key — that is the whole point of
the restriction, and a screen capture is exactly the kind of thing an extension should not
be able to do quietly. Everything else about this extension has been checked from inside a
running Shell; its pixels have to be photographed by a person.

## Taking it

In a normal, logged-in session with the extension enabled and nazar-tray running as the
engine (`nazar-tray --headless`), so the panel has real numbers to draw:

1. Press **PrtSc**. GNOME's screenshot UI opens with an area selection.
2. Drag a rectangle around the panel — and, for the second shot, around the open menu.
3. The image lands in `~/Pictures/Screenshots/`.

Two shots are worth having, and the second is the one that sells it:

| File | What is in it |
|---|---|
| `panel.png` | The top bar with the bead and the percentage, cropped to the bar and a little of the workspace under it. What somebody gets for installing this. |
| `panel-menu.png` | The same button with the menu open: both providers, every window, the bar, `◂` on the window that binds and the tray's line at the foot. |

## Before committing one

- **Crop to the panel.** A full-screen shot publishes whatever else was open — window
  titles, a browser tab, a file manager, the clock of a machine.
- **Read the frame back.** The menu itself carries a plan name, a percentage and a pid,
  which are all fine; the top bar beside it carries the application menu, the network and
  everything else the desktop felt like showing, which may not be.
- **Dark and light both render**, but one shot is enough for a README, and the panel is
  worth showing in whichever theme the screenshot's background is honest about.
- PNG, 100 % scale, and a file size in the hundreds of kilobytes rather than megabytes — a
  README is read on a phone too.

## Putting one in the README

Under the `## Screenshot` heading, replacing the note that points here. The alt text is
what somebody reading without the image gets, so it describes the panel rather than naming
the file:

```markdown
![The GNOME top bar with the bead and 70% beside the clock, and the menu open underneath:
Claude's and Codex's windows, each with a percentage, a bar and the time it resets, and a
mark on the weekly window that binds](docs/screenshots/panel-menu.png)
```

The same shot is what extensions.gnome.org shows if its listing page offers a screenshot
field — see [RELEASE.md](../RELEASE.md) §3.2 — so it is worth taking once and taking well.
