// The GNOME Shell half: a panel button, a file monitor, and a menu built out of what
// lib/contract.js worked out. There is no arithmetic in this file on purpose — every
// number and every string it draws comes from there, where a test can reach it.
//
// What this extension does not do is most of what it is: it opens no socket, ships no
// binary and writes no file, anywhere. It reads two small files in `~/.nazar` that
// nazar-tray already writes, and draws them.
//
// It starts nothing by itself — not on a tick, not on a timer, not while the panel is being
// drawn. The single exception is the gear at the foot of the menu, which launches
// nazar-tray's own settings page when a person clicks it, and that is the whole of it: one
// command, one call site, reached only from an `activate` handler, checked by a test.
//
// Since 23 September there is a second thing in here that is not the panel: one D-Bus method,
// `Raise`, exported on the Shell's own connection. It exists because of a restriction rather
// than an ambition — under Wayland a program cannot raise a window it does not own, by
// design, and the only process in the session that can raise anybody's window is the
// compositor. Nazar's desktop shell wants to put a terminal in front of you when you pick a
// session on its canvas; it cannot, and gnome-shell can, so the extension that is already
// inside gnome-shell lends it the one verb. Everything that decides *which* window lives in
// lib/raise.js for the same reason the arithmetic lives in lib/contract.js.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Contract from './lib/contract.js';
import {RAISE_INTERFACE, RAISE_OBJECT_PATH, chooseWindow} from './lib/raise.js';

/**
 * The tray's own settings page, and the only command this extension ever launches.
 *
 * `--view settings` is nazar-tray's documented way in (`crates/nazar-tray/src/cli.rs`): it
 * opens the tray's panel on its settings page, which is where every threshold this face
 * draws is actually configured. The extension has no preferences of its own on purpose —
 * two places to set one threshold is one place too many — so the gear is a door to the
 * program that owns them rather than a second copy of them.
 */
const TRAY_PROGRAM = 'nazar-tray';
const TRAY_SETTINGS_COMMAND = `${TRAY_PROGRAM} --view settings`;

/**
 * What is appended to the panel's number while nazar-tray is not running.
 *
 * Opacity alone was not enough. A dimmed panel is only dim next to the same panel undimmed,
 * and nobody sees both: a number that had been faded for four days was read as current, so
 * the state now changes the text as well as the paint.
 *
 * Two middle dots, and the alternatives were measured rather than guessed. `⏸` U+23F8 is the
 * obvious choice and the wrong one — neither Cantarell nor Adwaita Sans carries it, so
 * fontconfig falls through to Noto Color Emoji and the panel gets a colour pictograph of a
 * different size and weight from the number beside it. `‖` U+2016 is in Adwaita Sans, the
 * GNOME 47+ default, but not in Cantarell, which is what GNOME 46 draws a panel with, and a
 * marker that silently changes font on two of the five Shell versions this zip claims is a
 * marker that has to be checked twice. `·` U+00B7 is in both, at the same weight as the
 * digits, and doubled it reads as a pause without being a picture of one. No `?`: the
 * question mark means "could not be read", which is a different state and must stay its own.
 */
const NOT_RUNNING_MARKER = ' ··';

/** Countdowns and ages move with the clock, so the panel is redrawn on a slow tick. */
const TICK_SECONDS = 30;

/** An atomic rename arrives as a handful of events. One read, a quarter second later. */
const DEBOUNCE_MS = 250;

/** The width of a full bar in the menu, in pixels before scaling. */
const BAR_WIDTH = 96;

export default class NazarExtension extends Extension {
    enable() {
        // Nothing is created before enable() and everything created here is torn down in
        // disable(); the fields exist in one place so that the two halves can be read
        // against each other.
        this._doc = null;
        this._error = null;
        this._lockText = null;
        this._cancellable = null;
        this._tickId = 0;
        this._debounceId = 0;
        this._monitor = null;
        this._monitorId = 0;
        this._openId = 0;
        this._lastWarning = null;
        this._raiseService = null;

        const dir = Contract.dataDir(name => GLib.getenv(name));
        this._dirPath = dir;
        this._limitsPath = dir ? `${dir}/${Contract.LIMITS_FILE}` : null;
        this._lockPath = dir ? `${dir}/${Contract.LOCK_FILE}` : null;

        this._button = new PanelMenu.Button(0.5, 'Nazar', false);
        this._box = new St.BoxLayout({
            style_class: 'nazar-panel',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._icon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${this.path}/assets/bead.svg`),
            style_class: 'nazar-icon',
            icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({
            text: '?',
            style_class: 'nazar-value',
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Every box in this extension is horizontal, which is not a coincidence: the
        // vertical/orientation property of St.BoxLayout is the one thing that has moved
        // under extensions between GNOME 45 and 51, and a face that never sets it never
        // has to care which spelling this Shell wants.
        this._box.add_child(this._icon);
        this._box.add_child(this._label);
        this._button.add_child(this._box);
        Main.panel.addToStatusArea(this.uuid, this._button);

        // The menu is rebuilt with the data; this is only so that the countdowns in it are
        // no more than a moment old when somebody actually looks at them.
        this._openId = this._button.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this._buildMenu();
        });

        // The directory rather than the file: the writer builds a temporary file beside the
        // target and renames it over the top (contract rule 3), and a monitor attached to
        // the file that was replaced watches an inode nobody will write to again.
        if (this._dirPath) {
            try {
                this._monitor = Gio.File.new_for_path(this._dirPath)
                    .monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
                // Both halves of the event: a rename inside the directory arrives as
                // MOVED/RENAMED with the *temporary* file as `file` and the name we care
                // about as `otherFile`, so a monitor that only looks at the first argument
                // sees `.limits.json.tmp` and sleeps through every write the tray makes.
                this._monitorId = this._monitor.connect('changed', (_monitor, file, otherFile) => {
                    if (ours(file) || ours(otherFile))
                        this._scheduleRead();
                });
            } catch (error) {
                // A directory that is not there yet cannot be watched. The tick below
                // notices when it appears, so this is a slower path and not a dead one.
                this._warnOnce(`could not watch ${this._dirPath}: ${error.message}`);
            }
        }

        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, TICK_SECONDS, () => {
            this._read();
            return GLib.SOURCE_CONTINUE;
        });

        // The `Raise` method, on the Shell's own session-bus connection.
        //
        // `Gio.DBus.session` rather than a connection of our own, because an extension has no
        // bus name it could claim: this lands under `org.gnome.Shell`, which is the name
        // gnome-shell already owns, and that is the point — a caller that finds nothing there
        // has learned something true about the session rather than about our plumbing.
        //
        // In a try/catch because an export can genuinely fail: a path is claimed once per
        // connection, so a previous disable() that did not run its unexport (a Shell that was
        // killed rather than restarted, a reload in the middle of an error) leaves the address
        // occupied. The panel is the extension's job and the method is a favour it does for
        // another program, so a failure here is one warning line and a panel that still works,
        // not an enable() that throws and takes the face down with it.
        try {
            this._raiseService = Gio.DBusExportedObject.wrapJSObject(RAISE_INTERFACE, this);
            this._raiseService.export(Gio.DBus.session, RAISE_OBJECT_PATH);
        } catch (error) {
            this._raiseService = null;
            this._warnOnce(`could not export ${RAISE_OBJECT_PATH}: ${error.message}`);
        }

        this._read();
    }

    disable() {
        // First, because it is the one thing in here another process is holding a reference
        // to. A method that is still answering after disable() is a lock screen away from
        // being a method that raises windows on behalf of a disabled extension, and unexport
        // is also what frees the path for the next enable().
        if (this._raiseService) {
            this._raiseService.unexport();
            this._raiseService = null;
        }
        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
            this._debounceId = 0;
        }
        if (this._monitor) {
            if (this._monitorId)
                this._monitor.disconnect(this._monitorId);
            this._monitor.cancel();
            this._monitorId = 0;
            this._monitor = null;
        }
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._button) {
            if (this._openId)
                this._button.menu.disconnect(this._openId);
            this._openId = 0;
            this._button.destroy();
            this._button = null;
        }
        this._box = null;
        this._icon = null;
        this._label = null;
        this._doc = null;
        this._error = null;
        this._lockText = null;
        this._dirPath = null;
        this._limitsPath = null;
        this._lockPath = null;
        this._lastWarning = null;
    }

    /** A rename is several events; coalesce them into one read. */
    _scheduleRead() {
        if (this._debounceId)
            GLib.source_remove(this._debounceId);
        this._debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            this._debounceId = 0;
            this._read();
            return GLib.SOURCE_REMOVE;
        });
    }

    _read() {
        if (!this._button || !this._limitsPath)
            return;

        if (this._cancellable)
            this._cancellable.cancel();
        this._cancellable = new Gio.Cancellable();
        const cancellable = this._cancellable;

        this._loadText(this._limitsPath, cancellable, limits => {
            const parsed = Contract.parseLimits(limits);
            this._doc = parsed.doc;
            this._error = parsed.error;
            this._loadText(this._lockPath, cancellable, lock => {
                this._lockText = lock;
                this._render();
            });
        });
    }

    /** Read a small file off the main loop. `null` means it is not there, which is normal. */
    _loadText(path, cancellable, done) {
        Gio.File.new_for_path(path).load_contents_async(cancellable, (file, result) => {
            if (cancellable.is_cancelled() || this._cancellable !== cancellable || !this._button)
                return;
            let text = null;
            try {
                const [ok, bytes] = file.load_contents_finish(result);
                if (ok)
                    text = new TextDecoder().decode(bytes);
            } catch (error) {
                if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    return;
                // Not found is the ordinary state of a machine where nazar-tray has never
                // run, and saying so every thirty seconds is the kind of logging an
                // extension gets rejected for. Anything else is worth one line.
                if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                    this._warnOnce(`could not read ${path}: ${error.message}`);
            }
            done(text);
        });
    }

    _render() {
        if (!this._button)
            return;

        const now = Date.now();
        const tray = Contract.trayStatus(this._lockText, {now, pidAlive: pid => pidAlive(pid)});
        const reading = Contract.panelReading(this._doc, {now, running: tray.running});

        // Rule 2 in the one place everybody looks: a question mark, never a reassuring 0 %.
        const value = reading.percent === null ? '?' : `${reading.percent}%`;
        this._label.text = tray.running ? value : value + NOT_RUNNING_MARKER;

        this._label.style_class = `nazar-value${textClass(reading.severity)}`;

        // The number stays when the tray stops, and only for as long as it can still be
        // true. Quota does not burn while nothing is using it, so a reading taken before the
        // engine died is a reading that is still good — right up to the window's own reset,
        // after which it is a number about a window that no longer exists. Past that point
        // `panelReading` hands back nothing and the panel shows `?`, because the old number
        // is not merely stale: it is the wrong answer in the reassuring direction, which is
        // the worst kind. A panel that sat on 67 % for four days after its weekly reset —
        // while the true figure was 5 % — is the whole reason that rule is in the contract.
        //
        // The dimming below is what says "nobody is maintaining this" without opening the
        // menu, and it is deliberately not the only signal: see the marker on the value.
        const classes = ['nazar-panel'];
        if (reading.severity === 'unknown')
            classes.push('nazar-state-unknown');
        if (!tray.running)
            classes.push('nazar-stale');
        this._box.style_class = classes.join(' ');

        // Always, rather than only while the menu is open: `PopupMenu.open()` returns
        // without doing anything when the menu is empty, so an extension that waits to be
        // opened before it fills the menu is an extension whose menu never opens. Found in
        // a nested session, where the button was there and clicking it did nothing.
        this._buildMenu();
    }

    _buildMenu() {
        if (!this._button)
            return;

        const menu = this._button.menu;
        menu.removeAll();

        const now = Date.now();
        // Read before the rows rather than after them: whether the tray is running decides
        // whether a window whose reset has passed still counts, so the rows cannot be worded
        // without it.
        const tray = Contract.trayStatus(this._lockText, {now, pidAlive: pid => pidAlive(pid)});
        const views = Contract.providerViews(this._doc, {now, running: tray.running});

        if (this._error)
            menu.addMenuItem(infoItem(this._error, 'nazar-note'));

        for (const view of views) {
            menu.addMenuItem(this._providerItem(view));
            if (view.note) {
                menu.addMenuItem(infoItem(view.note, 'nazar-note'));
                continue;
            }
            for (const row of view.windows)
                menu.addMenuItem(this._windowItem(row));
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        menu.addMenuItem(infoItem(Contract.trayLine(tray), tray.running ? 'nazar-note' : 'nazar-alert'));
        if (!tray.running)
            menu.addMenuItem(infoItem('start nazar-tray --headless', 'nazar-note'));

        // `emblem-system-symbolic` rather than `preferences-system-symbolic`: in
        // adwaita-icon-theme 50 the first is still the cog — the shape a person reads as
        // "settings" at 16 px in a Shell menu — while the second was redrawn as a
        // screwdriver over a diagonal, which at that size is a smudge and at any size is
        // not what the rest of GNOME puts on a settings row. It lives under
        // `symbolic/legacy/` in the theme and is shipped there in every version this
        // extension claims, so the name is safe to hard-code.
        const settings = new PopupMenu.PopupImageMenuItem('Settings…', 'emblem-system-symbolic');
        // Looked up when the menu is built rather than once in enable(): a tray installed
        // while the session is up should light the row up without a logout, and this is a
        // path lookup, not a launch.
        const installed = GLib.find_program_in_path(TRAY_PROGRAM) !== null;
        if (installed)
            settings.connect('activate', () => this._openTraySettings());
        else
            settings.setSensitive(false);
        menu.addMenuItem(settings);
        if (!installed)
            menu.addMenuItem(infoItem(`${TRAY_PROGRAM} is not installed`, 'nazar-note'));
    }

    _providerItem(view) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.add_child(new St.Label({text: view.title, style_class: 'nazar-provider'}));
        item.add_child(new St.Label({
            text: view.detail,
            style_class: 'nazar-detail',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        }));
        return item;
    }

    _windowItem(row) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.add_child(new St.Label({
            text: row.binding ? `${row.label} ◂` : row.label,
            style_class: 'nazar-window',
        }));

        const track = new St.BoxLayout({
            style_class: 'nazar-bar',
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (row.percent !== null) {
            const width = Math.round(BAR_WIDTH * Math.min(100, Math.max(0, row.percent)) / 100);
            track.add_child(new St.Widget({
                style_class: `nazar-bar-fill nazar-fill-${row.severity}`,
                style: `width: ${width}px;`,
            }));
        }
        item.add_child(track);

        item.add_child(new St.Label({
            text: row.percentText,
            style_class: `nazar-percent${textClass(row.severity)}`,
        }));
        item.add_child(new St.Label({
            text: row.stale ? `${row.detail} · stale` : row.detail,
            style_class: row.stale ? 'nazar-detail nazar-stale' : 'nazar-detail',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        }));
        return item;
    }

    /**
     * Open nazar-tray's settings page. The one thing in this extension that starts a
     * program, and it starts it only because somebody clicked the gear.
     *
     * An app-info launch rather than a child process of our own, which is the whole
     * difference: the command is handed to GIO, which starts it under the session's launch
     * context — the same machinery a `.desktop` file goes through — so the Shell is not its
     * parent, its output is not ours to read, and it does not die when the extension is
     * disabled. A face that held a child would have to reap it, and reaping a child in
     * `disable()` is how an extension leaks a process across a lock screen.
     */
    _openTraySettings() {
        try {
            Gio.AppInfo.create_from_commandline(TRAY_SETTINGS_COMMAND, null, Gio.AppInfoCreateFlags.NONE)
                .launch([], global.create_app_launch_context(0, -1));
        } catch (error) {
            this._warnOnce(`could not start ${TRAY_SETTINGS_COMMAND}: ${error.message}`);
        }
    }

    /**
     * `Raise(au pids, s title_hint) → (b raised, s detail)` — the D-Bus method.
     *
     * The caller hands over an ancestor chain, nearest first, and gets back whether a window
     * was brought forward and a sentence about it. lib/raise.js decides which window; this
     * method's whole job is the two things that need a Shell: reading the window list, and
     * activating the one that was chosen.
     *
     * **What it can and cannot be made to do, since anything on the session bus can call it.**
     * It raises a window whose pid the caller already named, and there is nothing else in it:
     * no process is started, no file is read or written, nothing is closed, moved, resized or
     * killed, and a pid that is not in the list is never touched — the match is an equality
     * test against the list, not a search outwards from it. The worst a hostile caller
     * achieves is a window of its own coming to the front, which it could do by asking the
     * toolkit. What it does *not* get is a window list: a caller that guesses pids learns only
     * `true` or `false` about a pid it already guessed, and the class name of a window it
     * just raised into its own view. That is a smaller leak than the one every session bus
     * already has through `org.gnome.Shell.Introspect`, and it is the reason this is one
     * method with two out arguments rather than a query interface.
     *
     * Normal windows only, and that is a correctness rule rather than a tidiness one: a
     * terminal's own dialogs, menus and tooltips are separate Meta windows carrying the same
     * pid, and activating a tooltip is a jump that appears to do nothing at all.
     *
     * Nothing throws out of here. A JS exception in a D-Bus handler reaches the caller as an
     * error name it then has to tell apart from a transport failure, and "the Shell had a bug"
     * and "there is no such window" are not the same news. So the answer is always an answer.
     */
    Raise(pids, titleHint) {
        try {
            const windows = [];
            for (const actor of global.get_window_actors()) {
                const meta = actor.meta_window;
                if (!meta || meta.get_window_type() !== Meta.WindowType.NORMAL)
                    continue;
                windows.push({
                    pid: meta.get_pid(),
                    title: meta.get_title(),
                    wmClass: meta.get_wm_class(),
                    userTime: meta.get_user_time(),
                    meta,
                });
            }

            const choice = chooseWindow(pids, titleHint, windows);
            if (!choice.window)
                return [false, choice.detail];

            // `Main.activateWindow` rather than `meta_window.activate` on its own, and the
            // difference is everything the caller would otherwise have to ask for separately.
            // Mutter's activate already unminimises the window and its transient parents and
            // moves to the workspace the window is on — a jump that focuses a window on
            // workspace 3 while leaving you looking at workspace 1 is not a jump — and the
            // Shell's wrapper adds the half Mutter cannot know about: it closes the overview
            // and the calendar. Without that, a jump triggered while the Activities view is
            // open focuses a window nobody can see behind it.
            Main.activateWindow(choice.window.meta, global.get_current_time());
            return [true, choice.detail];
        } catch (error) {
            return [false, `the Shell could not raise a window: ${error.message}`];
        }
    }

    /** One line per distinct problem. A log line every tick is a rejected extension. */
    _warnOnce(message) {
        if (this._lastWarning === message)
            return;
        this._lastWarning = message;
        console.warn(`nazar-gnome: ${message}`);
    }
}

/** One of the two files this extension reads, whichever end of a rename it arrived on. */
function ours(file) {
    const name = file?.get_basename();
    return name === Contract.LIMITS_FILE || name === Contract.LOCK_FILE;
}

/** The faster half of "is the tray running": a pid the kernel has never heard of. */
function pidAlive(pid) {
    // `null` where the answer cannot be had, which the contract treats as "cannot tell"
    // and hands to the heartbeat rather than reading as "gone".
    if (!GLib.file_test('/proc', GLib.FileTest.IS_DIR))
        return null;
    return GLib.file_test(`/proc/${pid}`, GLib.FileTest.EXISTS);
}

/** Colour belongs on a number only where it means something; `ok` keeps the theme's own. */
function textClass(severity) {
    return severity === 'warn' || severity === 'critical' || severity === 'exhausted'
        ? ` nazar-text-${severity}`
        : '';
}

function infoItem(text, styleClass) {
    const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    item.add_child(new St.Label({text, style_class: styleClass, x_expand: true}));
    return item;
}
