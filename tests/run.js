// The whole of this extension's arithmetic, checked under plain `gjs -m tests/run.js`.
//
// There is no GNOME Shell here and there does not need to be: everything that decides what
// a user reads lives in lib/contract.js, which imports nothing, so the panel's number, the
// rounding, the unknown state and the tray's pulse are all reachable from a script. What
// is left for the Shell — widgets, a file monitor, a menu — is checked by reading the
// source for the things it must never contain, and by hand in a nested session.
//
// **The variants are derived, not committed.** Every case starts from
// `tests/fixtures/limits.sample.json` — nazar-tray's own sample, copied as its contract
// asks consumers to copy it — and edits one thing. A committed copy of a document is a
// second document, and two documents are two things to keep in step.

import GLib from 'gi://GLib';
import System from 'system';

import {
    HEARTBEAT_GRACE_MS,
    SEVERITY_THRESHOLDS,
    bindingWindow,
    dataDir,
    floorPercent,
    formatClock,
    formatSpan,
    instant,
    panelReading,
    parseLimits,
    providerViews,
    severity,
    trayLine,
    trayStatus,
    windowLabel,
    windowPercent,
} from '../lib/contract.js';

const HERE = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const ROOT = GLib.path_get_dirname(HERE);
const SAMPLE = JSON.parse(read(`${HERE}/fixtures/limits.sample.json`));

/** A fixed instant to reckon from: a minute after the sample's own `updatedAt`. */
const NOW = Date.parse('2026-09-06T21:13:34Z');
const UTC = 'UTC';

/** The sample with one edit, as a fresh document. */
function variant(edit) {
    const copy = JSON.parse(JSON.stringify(SAMPLE));
    edit(copy);
    return copy;
}

/** A lock that says the tray is alive: a pid that exists, beating just now. */
function alive(now = NOW) {
    return JSON.stringify({
        schemaVersion: 1,
        pid: 4242,
        startedAt: new Date(now - 60_000).toISOString().replace(/\.\d+Z$/, 'Z'),
        heartbeatAt: new Date(now - 40_000).toISOString().replace(/\.\d+Z$/, 'Z'),
    });
}

let failures = 0;
let count = 0;

const running = () => true;
const gone = () => false;
const cannotTell = () => null;

// ---------------------------------------------------------------------------------------

test('the binding window is the number in the panel', () => {
    // Claude binds on its Fable weekly at 23 %, Codex on its weekly at 70 %. The number
    // that belongs in a panel is the one closest to full, because that is the one that
    // stops you — not the average of the two, which is a number nothing is at.
    const reading = panelReading(SAMPLE);
    equal(reading.percent, 70);
    equal(reading.provider, 'codex');
    equal(reading.key, 'secondary');
    equal(reading.severity, 'warn');
});

test('the panel takes the highest binding, never an average', () => {
    const doc = variant(d => {
        d.providers.claude.windows = {five_hour: {percent: 10, windowMinutes: 300, state: 'ok'}};
        d.providers.codex.windows = {primary: {percent: 90, windowMinutes: 300, state: 'ok'}};
    });
    equal(panelReading(doc).percent, 90);
});

test('a percentage is rounded down, never up', () => {
    // Contract rule 5. 99.6 % is not 100 %, and a panel that says a window is spent when it
    // is not is wrong at the exact moment it matters most.
    const doc = variant(d => {
        d.providers.codex.windows.secondary.percent = 99.6;
    });
    const reading = panelReading(doc);
    equal(reading.percent, 99);
    equal(reading.severity, 'critical');
    equal(floorPercent(99.999), 99);
    equal(floorPercent(null), null);
});

test('a window that could not be read is a question mark and never a zero', () => {
    // Rule 2. Codex goes unreadable — no percent, no binding, state error — and the panel
    // falls back to the provider that can still be read rather than to a reassuring 0 %.
    const doc = variant(d => {
        delete d.providers.codex.binding;
        for (const key of Object.keys(d.providers.codex.windows))
            d.providers.codex.windows[key] = {state: 'error', error: 'no quota line in the newest session log'};
    });
    equal(panelReading(doc).percent, 23);

    const codex = providerViews(doc, {now: NOW, timeZone: UTC}).find(v => v.name === 'codex');
    for (const row of codex.windows) {
        equal(row.percentText, '?');
        equal(row.percent, null);
        equal(row.severity, 'unknown');
        equal(row.binding, false);
        equal(row.detail, 'no quota line in the newest session log');
    }
});

test('when nothing can be read the panel says so, and says nothing else', () => {
    const doc = variant(d => {
        d.providers.claude = {configured: false};
        delete d.providers.codex.binding;
        for (const key of Object.keys(d.providers.codex.windows))
            d.providers.codex.windows[key] = {state: 'error'};
    });
    const reading = panelReading(doc);
    equal(reading.percent, null, 'no number at all, rather than a zero');
    equal(reading.severity, 'unknown');

    const claude = providerViews(doc, {now: NOW, timeZone: UTC}).find(v => v.name === 'claude');
    equal(claude.configured, false);
    equal(claude.note, 'not configured on this machine');
    equal(claude.windows.length, 0);
});

test('a damaged, empty or missing document is unknown rather than a crash', () => {
    // The writer renames a finished file over the target, so a reader never sees half a
    // document — but a reader still has to survive one, and the four shapes below are the
    // ones a panel meets: nothing written yet, a truncated file, an empty file, a stray.
    for (const text of [null, undefined, '', '   ', '{ "providers": ', 'not json at all', '[]', '"a string"']) {
        const parsed = parseLimits(text);
        equal(parsed.doc, null, JSON.stringify(text));
        ok(typeof parsed.error === 'string' && parsed.error.length > 0, 'a reason, in words');
        equal(panelReading(parsed.doc).percent, null);
        equal(providerViews(parsed.doc, {now: NOW}).length, 0);
    }
    equal(parseLimits('{}').error, 'limits.json carries no providers');
});

test('a schema version this build does not know is unknown, not guessed at', () => {
    const parsed = parseLimits(JSON.stringify(variant(d => {
        d.schemaVersion = 2;
    })));
    equal(parsed.doc, null);
    match(parsed.error, /schema version 2/);
    ok(parseLimits(JSON.stringify(SAMPLE)).doc !== null, 'version 1 still reads');
});

test('unknown fields, unknown states and unknown providers all survive', () => {
    // Rule 4. An older reader beside a newer writer loses nothing, which is only true if
    // it iterates what it is given instead of looking for names it knows.
    const doc = variant(d => {
        d.providers.claude.windows.five_hour.somethingNewer = {deep: true};
        d.providers.claude.windows.five_hour.state = 'throttled';
        d.providers.gemini = {
            configured: true,
            source: 'something-else',
            windows: {monthly: {percent: 42, windowMinutes: 43200, state: 'ok'}},
        };
    });
    const views = providerViews(doc, {now: NOW, timeZone: UTC});
    equal(views.length, 3);

    const gemini = views.find(v => v.name === 'gemini');
    equal(gemini.title, 'Gemini');
    match(gemini.detail, /something-else/, 'a source value we do not know is shown as written');
    equal(gemini.windows[0].percentText, '42 %');

    const five = views.find(v => v.name === 'claude').windows.find(w => w.key === 'five_hour');
    equal(five.state, 'throttled');
    equal(five.percentText, '12 %', 'a state we do not recognise does not throw the number away');
    equal(five.stale, false);
});

test('severity is the contract\'s, to the percentage point', () => {
    equal(SEVERITY_THRESHOLDS.warn, 60);
    equal(SEVERITY_THRESHOLDS.critical, 85);
    equal(SEVERITY_THRESHOLDS.exhausted, 100);
    equal(severity(null), 'unknown');
    equal(severity(0), 'ok');
    equal(severity(59.9), 'ok');
    equal(severity(60), 'warn');
    equal(severity(84.9), 'warn');
    equal(severity(85), 'critical');
    equal(severity(99.9), 'critical');
    equal(severity(100), 'exhausted');
});

test('ties go to the shorter window, and then to the smaller key', () => {
    const equalPercents = {
        windows: {
            weekly: {percent: 40, windowMinutes: 10080, state: 'ok'},
            hourly: {percent: 40, windowMinutes: 300, state: 'ok'},
        },
    };
    equal(bindingWindow(equalPercents).key, 'hourly');

    const sameLength = {
        windows: {
            zulu: {percent: 40, windowMinutes: 300, state: 'ok'},
            alpha: {percent: 40, windowMinutes: 300, state: 'ok'},
        },
    };
    equal(bindingWindow(sameLength).key, 'alpha');

    const noMinutes = {
        windows: {
            measured: {percent: 40, windowMinutes: 300, state: 'ok'},
            unlabelled: {percent: 40, state: 'ok'},
        },
    };
    equal(bindingWindow(noMinutes).key, 'measured', 'a window of unknown length is the longer one');
});

test('a window with no percentage never binds', () => {
    equal(bindingWindow({windows: {a: {state: 'error'}, b: {state: 'error'}}}), null);
    equal(bindingWindow({configured: false}), null);
    equal(bindingWindow(null), null);
    equal(windowPercent({percent: '70'}), null, 'a string is not a number');
    equal(windowPercent({percent: Number.NaN}), null);
});

test('the file\'s own binding is not trusted over our own arithmetic', () => {
    // The contract's instruction where the two disagree: "trust its own arithmetic: the
    // file may have been written by an older build or by hand".
    const doc = variant(d => {
        d.providers.codex.binding = 'primary';
        d.providers.codex.windows.primary = {state: 'error'};
    });
    equal(bindingWindow(doc.providers.codex).key, 'secondary');
    equal(panelReading(doc).percent, 70);
});

test('window names come from the length, not from a list of keys', () => {
    // "A consumer must not hard-code the set." Claude grew model-scoped weeklies after this
    // contract was written; a face that knows two names goes blind the day a third arrives.
    equal(windowLabel('five_hour', {windowMinutes: 300}), '5 hours');
    equal(windowLabel('seven_day', {windowMinutes: 10080}), 'week');
    equal(windowLabel('seven_day_fable', {windowMinutes: 10080, model: 'Fable'}), 'week · Fable');
    equal(windowLabel('monthly', {windowMinutes: 43200}), '30 d 0 h');
    equal(windowLabel('some_new_window', {}), 'some new window', 'an unmeasured window keeps its key');
});

test('rows are ordered shortest window first', () => {
    const claude = providerViews(SAMPLE, {now: NOW, timeZone: UTC}).find(v => v.name === 'claude');
    deepEqual(claude.windows.map(w => w.key), ['five_hour', 'seven_day', 'seven_day_fable']);
    equal(claude.windows[2].binding, true, 'the Fable weekly is what binds this provider');
    equal(claude.windows[0].binding, false);
});

test('a reset is shown in local time with a countdown, and a due one does not count', () => {
    const claude = providerViews(SAMPLE, {now: NOW, timeZone: UTC}).find(v => v.name === 'claude');
    equal(claude.windows[0].detail, 'resets 7 Sept 03:10 · in 5 h 56 m');
    match(claude.windows[1].detail, /^resets 12 Sept 02:00 · in 5 d 4 h$/);

    const today = variant(d => {
        d.providers.claude.windows.five_hour.resetsAt = '2026-09-06T23:40:00Z';
    });
    const soon = providerViews(today, {now: NOW, timeZone: UTC}).find(v => v.name === 'claude');
    equal(soon.windows[0].detail, 'resets 23:40 · in 2 h 26 m', 'a date only when it is not today');

    const past = variant(d => {
        d.providers.claude.windows.five_hour.resetsAt = '2026-09-06T19:00:00Z';
    });
    const view = providerViews(past, {now: NOW, timeZone: UTC}).find(v => v.name === 'claude');
    match(view.windows[0].detail, /^reset was due 19:00$/);
});

test('a stale window keeps its number and loses the claim that it is current', () => {
    const doc = variant(d => {
        d.providers.codex.windows.secondary.state = 'stale';
        d.providers.codex.windows.secondary.error = 'the window reset and Codex has written nothing since';
    });
    const row = providerViews(doc, {now: NOW, timeZone: UTC})
        .find(v => v.name === 'codex').windows.find(w => w.key === 'secondary');
    equal(row.stale, true);
    equal(row.percentText, '70 %', 'stale means read and not to be acted on, not unread');
});

test('the provider header says where the numbers came from and how old they are', () => {
    const views = providerViews(SAMPLE, {now: NOW, timeZone: UTC});
    equal(views.find(v => v.name === 'claude').detail, 'max_20x · usage endpoint · read 1 m ago');
    equal(views.find(v => v.name === 'codex').detail, 'plus · rollout log · read 1 m ago');
    equal(views.find(v => v.name === 'claude').note, null);
});

test('the tray\'s pulse, in all four of its shapes', () => {
    // The order the contract gives: a pid the kernel has never heard of is gone now, and
    // only a pid that cannot be asked about falls back to the heartbeat's five minutes.
    const live = trayStatus(alive(), {now: NOW, pidAlive: running});
    equal(live.running, true);
    equal(live.pid, 4242);
    match(trayLine(live), /^nazar-tray is running \(pid 4242, beating 40 s? ?m? ?ago\)|^nazar-tray is running \(pid 4242, beating < 1 m ago\)$/);

    const missing = trayStatus(null, {now: NOW, pidAlive: running});
    equal(missing.running, false);
    match(trayLine(missing), /not running — there is no lock file/);

    const dead = trayStatus(alive(), {now: NOW, pidAlive: gone});
    equal(dead.running, false);
    match(dead.reason, /\(4242\) is gone/);

    const old = trayStatus(alive(NOW - 30 * 60_000), {now: NOW, pidAlive: cannotTell});
    equal(old.running, false, 'cannot tell is not "nobody is there" — the heartbeat answers');
    match(old.reason, /heartbeat was 30 m ago/);

    const recent = trayStatus(alive(NOW - HEARTBEAT_GRACE_MS + 60_000), {now: NOW, pidAlive: cannotTell});
    equal(recent.running, true, 'inside the grace, a pid we cannot ask about is still alive');
});

test('a lock that cannot be read is the tray being gone, not an exception', () => {
    for (const text of ['', 'not json', '[]', '{"pid": "four"}']) {
        const status = trayStatus(text, {now: NOW, pidAlive: running});
        equal(status.running, false, JSON.stringify(text));
        ok(trayLine(status).startsWith('nazar-tray is not running — '));
    }
});

test('durations and instants are read the way the contract writes them', () => {
    equal(instant('2026-09-06T21:12:34Z'), Date.parse('2026-09-06T21:12:34Z'));
    equal(instant('not a time'), null);
    equal(instant(undefined), null);
    equal(formatSpan(0), '< 1 m');
    equal(formatSpan(59_000), '< 1 m');
    equal(formatSpan(60_000), '1 m');
    equal(formatSpan(45 * 60_000), '45 m');
    equal(formatSpan(2 * 3600_000 + 14 * 60_000), '2 h 14 m');
    equal(formatSpan(4 * 86400_000 + 3 * 3600_000), '4 d 3 h');
    equal(formatClock(Date.parse('2026-09-07T03:10:00Z'), NOW, UTC), '7 Sept 03:10');
    equal(formatClock(Date.parse('2026-09-06T23:10:00Z'), NOW, UTC), '23:10', 'today needs no date');
});

test('`~/.nazar` is resolved the way the writer resolves it', () => {
    equal(dataDir(name => (name === 'HOME' ? '/home/someone' : null)), '/home/someone/.nazar');
    equal(dataDir(name => (name === 'NAZAR_HOME' ? '/tmp/throwaway' : '/home/someone')), '/tmp/throwaway');
    equal(dataDir(name => (name === 'NAZAR_HOME' ? '' : '/home/someone')), '/home/someone/.nazar',
        'an empty variable is not a directory');
    equal(dataDir(() => null), null);
});

// --- What the Shell half must never contain ---------------------------------------------

test('the extension opens no socket, runs no program and writes no file', () => {
    // A grep rather than a trace, and it is the right shape of check: what it rules out is
    // a future line that reaches for one of these. This is also the half of the review
    // guidelines that rejects extensions — spawning, elevating, shipping a binary — and the
    // architecture's whole claim is that we never go near it.
    const source = [read(`${ROOT}/extension.js`), read(`${ROOT}/lib/contract.js`)].join('\n');
    const forbidden = [
        'Gio.Subprocess', 'GLib.spawn', 'spawn_async', 'spawn_command_line',
        'Soup', 'fetch(', 'XMLHttpRequest', 'Gio.SocketClient', 'DBusProxy',
        'replace_contents', 'append_to', 'delete_async', 'make_directory',
        'GLib.file_set_contents', 'Secret', 'St.Clipboard',

        // The menu used to offer Nazar's canvas on a loopback URL, and the offer is gone:
        // a quota face that hands a `http://127.0.0.1:…` address to the session's browser
        // is guessing which port somebody's Nazar is on and opening a page in their name
        // for it. Both names are listed so that putting the item back fails here first.
        'launch_default_for_uri', '127.0.0.1',
    ];
    for (const name of forbidden)
        ok(!source.includes(name), `${name} has no business in a face`);
});

test('everything enable() creates, disable() releases', () => {
    // The first thing a reviewer reads, and the thing every leak in a Shell extension comes
    // down to: a source added or an object built in enable() and left behind afterwards.
    const source = read(`${ROOT}/extension.js`);
    const enable = between(source, '    enable() {', '    disable() {');
    const disable = between(source, '    disable() {', '\n    /** A rename');
    const fields = new Set([...enable.matchAll(/this\.(_\w+)\s*=/g)].map(m => m[1]));
    ok(fields.size > 10, `enable() sets ${fields.size} fields`);
    for (const field of fields)
        ok(disable.includes(`this.${field}`), `disable() lets go of ${field}`);
    for (const teardown of ['GLib.source_remove', '.cancel()', '.disconnect(', '.destroy()'])
        ok(disable.includes(teardown), `disable() calls ${teardown}`);
});

test('the monitor listens to both ends of a rename', () => {
    // Measured in a nested session, not reasoned about: the tray writes a temporary file
    // beside the target and renames it over the top, and GIO delivers that as one event
    // carrying the temporary name in `file` and `limits.json` in `otherFile`. A handler
    // that reads only the first argument never fires, and the panel then updates on the
    // slow tick instead of within a second — which is how this was found.
    const source = read(`${ROOT}/extension.js`);
    const handler = between(source, "connect('changed'", '});');
    ok(handler.includes('otherFile'), 'the rename destination is the half that matters');
    ok(source.includes('WATCH_MOVES'), 'and the flag that makes GIO report it at all');
    ok(source.includes('monitor_directory'), 'the directory, not the file that gets replaced');
});

test('no box is ever told which way it runs', () => {
    // `St.BoxLayout`'s vertical/orientation property is the one piece of API under
    // extensions that has moved between GNOME 45 and 51. Every box here is horizontal and
    // none of them says so, which is why one zip can claim five Shell versions.
    const source = read(`${ROOT}/extension.js`);
    ok(!/\bvertical\s*:/.test(source), 'no vertical:');
    ok(!/\borientation\s*:/.test(source), 'no orientation:');
    ok(!source.includes('add_actor'), 'add_actor is gone in current GNOME; add_child is not');
});

test('metadata says what it is allowed to say', () => {
    const metadata = JSON.parse(read(`${ROOT}/metadata.json`));
    equal(metadata.uuid, 'nazar-gnome@xfurqan0.github.io');
    ok(metadata.uuid.endsWith('@xfurqan0.github.io'), 'the uuid namespace must be one we own');
    deepEqual(metadata['shell-version'], ['46', '47', '48', '49', '50']);
    equal(metadata.version, undefined, 'the version number belongs to extensions.gnome.org');
    equal(metadata['session-modes'], undefined, 'user-only is the default; saying so is noise');
    match(metadata.description, /no network, no subprocess/);
});

test('the sample is nazar-tray\'s own, unedited', () => {
    equal(SAMPLE.schemaVersion, 1);
    deepEqual(Object.keys(SAMPLE.providers).sort(), ['claude', 'codex']);
    equal(SAMPLE.providers.claude.binding, 'seven_day_fable');
});

// --- harness -----------------------------------------------------------------------------

function read(path) {
    const [ok_, bytes] = GLib.file_get_contents(path);
    if (!ok_)
        throw new Error(`could not read ${path}`);
    return new TextDecoder().decode(bytes);
}

function between(text, from, to) {
    const start = text.indexOf(from);
    const end = text.indexOf(to, start + from.length);
    if (start < 0 || end < 0)
        throw new Error(`could not find ${JSON.stringify(from)} … ${JSON.stringify(to)}`);
    return text.slice(start, end);
}

function test(name, body) {
    count += 1;
    try {
        body();
        print(`  ok   ${name}`);
    } catch (error) {
        failures += 1;
        print(`  FAIL ${name}`);
        print(`       ${error.message}`);
        if (error.stack)
            print(error.stack.split('\n').slice(0, 3).map(line => `       ${line}`).join('\n'));
    }
}

function ok(value, message = 'expected a truthy value') {
    if (!value)
        throw new Error(message);
}

function equal(actual, expected, message = '') {
    if (actual !== expected)
        throw new Error(`${message ? `${message}: ` : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function deepEqual(actual, expected, message = '') {
    const left = JSON.stringify(actual);
    const right = JSON.stringify(expected);
    if (left !== right)
        throw new Error(`${message ? `${message}: ` : ''}expected ${right}, got ${left}`);
}

function match(value, pattern, message = '') {
    if (typeof value !== 'string' || !pattern.test(value))
        throw new Error(`${message ? `${message}: ` : ''}${JSON.stringify(value)} does not match ${pattern}`);
}

print(`\n${count} tests, ${failures} failed\n`);
if (failures > 0)
    System.exit(1);
