# Release

**Every command on this page is for the maintainer to run.** Nothing here runs in CI and
nothing here is run by an assistant: a tag, a GitHub release and a submission to
extensions.gnome.org are one-way doors — the first two can be deleted but not un-seen, and
the third puts a name, a description and an email correspondence in front of strangers.
CI's job stops at the zip, which it builds and uploads as an artifact on every push.

There are two routes and they are **not exclusive**. A release zip is immediate and ours; a
store listing is discoverable and self-updating, and costs a volunteer's review time with no
promised turnaround. Doing the first does not spend the second.

---

## 0. Before either route

```sh
git switch main
git pull --ff-only
git status --porcelain          # must print nothing

gh run list --branch main --limit 3      # CI green on the commit you are about to tag
make check                               # 27 tests, locally, under your own gjs
make zip
```

Then the part no test reaches, on a real session rather than a nested one:

```sh
gnome-extensions install --force nazar-gnome@xfurqan0.github.io.shell-extension.zip
# log out and back in — a Wayland session cannot load a new extension without it
gnome-extensions enable nazar-gnome@xfurqan0.github.io
gnome-extensions info nazar-gnome@xfurqan0.github.io     # State: ACTIVE
```

Look at it with nazar-tray running as the engine (`nazar-tray --headless`) and again with it
stopped, and confirm four things by eye, because all four are things a user sees first:

- the bead and a percentage in the panel, and the panel button opens a menu;
- the number dims when the tray is not running, and does not disappear;
- `?` and not `0%` when `~/.nazar` has nothing to read;
- `journalctl --user -f | grep -i nazar` stays quiet while the panel is simply working.

And check the two documents a stranger reads before the code: the README's screenshot exists
and shows the current panel (see [screenshots/README.md](screenshots/README.md)), and
`metadata.json`'s description still describes what the extension does.

---

## 1. The two version numbers, which are not the same number

| | What it is | Who sets it |
|---|---|---|
| `v0.1.0` | A git tag and the name of a GitHub release. Ours, semantic, and the only version this repository knows about. | The maintainer, in step 2. |
| `version` in the store's copy of `metadata.json` | A **whole number** — 1, 2, 3 — counting uploads of this extension. | extensions.gnome.org, automatically, on every upload. |

`metadata.json` here carries **no `version` key** and must not grow one: the documented rule
is that an author should not set it, and a semantic string in that field is not even the
right type. The optional `version-name` field is the one that shows a human-readable version
on the site (1–16 characters, letters, numbers, spaces and periods); v1 does not set it, and
if it is ever added it should carry the tag and nothing else, kept in step with it by hand.

So the sentence to keep straight when reading a bug report: *"0.1.0"* is what the release
zip is called and *"version 3"* is what the store is serving.

---

## 2. Route 1 — a tag and a GitHub release

```sh
make clean
make zip
sha256sum nazar-gnome@xfurqan0.github.io.shell-extension.zip

git tag -a v0.1.0 -m "nazar-gnome 0.1.0"
git push origin v0.1.0

gh release create v0.1.0 \
  --title "nazar-gnome 0.1.0" \
  --notes-file docs/release-notes-0.1.0.md \
  nazar-gnome@xfurqan0.github.io.shell-extension.zip
```

Notes worth writing, in that file or in the release body: which GNOME Shell versions were
actually run against (50 today, not 46 to 50 — the metadata claims a range the README is
honest about), that this needs nazar-tray as the engine, and that it should **not** be
installed on a desktop that already draws the tray icon.

The archive is not byte-reproducible — a zip records modification times — so the checksum is
of the file you upload, not a claim that anybody can rebuild the same bytes. That is also why
the release asset should be a zip **you** built and installed from in step 0, rather than the
CI artifact: the one you verified is the one to publish.

Deleting a release is possible (`gh release delete v0.1.0`, `git push --delete origin v0.1.0`)
but a tag somebody has already fetched does not come back, so read the asset list twice.

---

## 3. Route 2 — extensions.gnome.org

**This is a gate.** The account, the listing text and every reply to a reviewer are
outward-facing, so the submission and its correspondence go past the maintainer before they
are sent, and no assistant uploads anything.

### 3.1 Once, before the first submission

- An account on <https://extensions.gnome.org> — it is its own registration, not a GitHub
  login. Use the address that is already public on the repository.
- Read <https://gjs.guide/extensions/review-guidelines/review-guidelines.html> end to end.
  The summary in §3.3 is a reading of it, not a replacement for it.

### 3.2 The upload

<https://extensions.gnome.org/upload/> takes the `*.shell-extension.zip` that `make zip`
produced — the same file, unopened and not repacked.

**There is no form for the listing text.** The site reads `uuid`, `name`, `description`,
`url` and `shell-version` out of `metadata.json` inside the zip, which is why those five
fields are checked in CI. Changing the listing therefore means a commit here and a new
upload, not an edit on the website. If the extension's page offers a screenshot or an icon,
the screenshot is the one in the README.

The text the store will show, which is `metadata.json` verbatim:

```
Name:        Nazar
Description: Claude Code and Codex quota in the GNOME panel. Reads the limits.json that
             nazar-tray writes: no network, no subprocess, no file of its own.
URL:         https://github.com/xfurqan0/nazar-gnome
UUID:        nazar-gnome@xfurqan0.github.io
Shell:       46, 47, 48, 49, 50
```

140 characters of description, against a listing that truncates a long one rather than
wrapping it. Both sentences survive the truncation point; the second is the one that answers
the question a reviewer of a quota extension asks first.

### 3.3 What the review is looking for, and where this extension stands

Each line is a rule from the review guidelines and then what a reader of this repository
would find. They are here so that a reply to a reviewer can be a file reference rather than a
paragraph of reassurance.

| The rule | Here |
|---|---|
| No binaries, no compiled blobs, readable unminified source | Four hand-written files: `extension.js`, `lib/contract.js`, `stylesheet.css`, `assets/bead.svg`. The CI package check fails on anything else. |
| No subprocesses, no privilege elevation | Nothing is elevated and nothing is started on a tick, on a timer or while the panel draws. `tests/run.js` greps the sources for `Gio.Subprocess`, `GLib.spawn`, `spawn_command_line` and thirteen more names, and fails if any appears. |
| No network | No `Soup`, no `fetch`, no socket; same grep. Everything on screen came out of a file another program wrote. |
| `disable()` must undo everything `enable()` did | Sources removed, monitor cancelled and disconnected, cancellable cancelled, button destroyed, fields dropped. A test reads both method bodies and fails if `enable()` sets a field `disable()` does not release; a nested session ran ten disable/enable cycles and ended with one panel button and no JS errors. |
| No blocking I/O on the main loop | `load_contents_async` with a `Gio.Cancellable`, never the synchronous call. |
| No excessive logging | Nothing is logged in the ordinary path. A genuine failure logs one line, and `_warnOnce` will not log the same line twice. |
| No GTK in `extension.js` | There is no `prefs.js` and no GTK import anywhere; v1 has no preferences. |
| `metadata.json` says only what it should | No `version` (the site assigns it), no `session-modes` (`user` is the default), and no `settings-schema` or `gettext-domain`, which would each promise a directory this extension does not ship. CI asserts the last two are absent. |
| Small diffs are reviewed sooner | 532 lines of code without comments, one purpose, no dependencies. |

### 3.4 After the upload

An unreviewed upload is not listed publicly; it waits for a volunteer. The answer arrives by
email, and there are three of them: approved, rejected with a reason, or a request for a
change. A requested change is a commit here, `make zip` again, and a **new upload** — the
queue position is not kept, and neither is a half-fixed zip.

If it is approved, the store serves version 1 and the Extensions app offers updates to
everyone who installed it. The GitHub release zip does not update itself and never will;
somebody who installed that way updates by installing the next one.

---

## 4. What a user does with a release zip

The README says this too, and it is repeated here so that a release note can point at one
page:

```sh
gnome-extensions install --force nazar-gnome@xfurqan0.github.io.shell-extension.zip
# log out and back in
gnome-extensions enable nazar-gnome@xfurqan0.github.io
```

Uninstalling is the reverse and leaves nothing behind, because the extension writes nothing:

```sh
gnome-extensions disable nazar-gnome@xfurqan0.github.io
rm -rf ~/.local/share/gnome-shell/extensions/nazar-gnome@xfurqan0.github.io
```

---

## 5. What is deliberately not automated

- **No release workflow.** A tag does not build or publish anything here. The zip is 14 KB
  and `make zip` takes a second, so a pipeline would add a place for a release to go wrong
  without saving a minute.
- **No store submission from CI.** extensions.gnome.org has an upload form and a human on
  the other side of it; automating the gesture would not make the review any faster and would
  put a credential in a repository that has none.
- **No version bumping.** Two numbers, one of them not ours (§1).
