// Everything this extension knows about `limits.json`, and nothing about GNOME Shell.
//
// The document is nazar-tray's contract (`docs/limits-contract.md` in that repository) and
// this file is the whole of our side of it: parsing, the derived values the contract says a
// consumer computes for itself, and the strings a panel puts on screen. It imports nothing
// — not `gi://`, not the Shell — so `tests/run.js` can run every rule in it under plain
// `gjs -m`, with no session, no panel and no clock but the one it passes in.
//
// The three rules worth stating up front, because they are the ones that are easy to get
// wrong and expensive when you do:
//
//   1. A window with no `percent` is **unknown**, and unknown is never `0 %`. "I do not
//      know" and "you have used nothing" are opposite messages to somebody about to start
//      a long task.
//   2. Rounding happens here, at display time, and **downwards**. 99.6 % is 99 %.
//   3. Nothing derived is read out of the file. Which window binds, when it resets, how
//      old the reading is and whether the tray is alive all change with the clock rather
//      than with the data, so all four take `now` as an argument.

/** Environment variable that moves `~/.nazar` somewhere else, for the whole installation. */
export const DATA_DIR_VAR = 'NAZAR_HOME';

/** The names under `~/.nazar` this extension ever opens. It opens no others, and writes none. */
export const LIMITS_FILE = 'limits.json';
export const LOCK_FILE = 'limits.lock';

/**
 * Severity thresholds, from the contract's derived-fields table: `ok` below 60, `warn` at
 * 60, `critical` at 85, `exhausted` at 100. They are nazar-tray's shipped defaults, and
 * the point of copying them rather than inventing prettier ones is that every face answers
 * the same question the same way.
 */
export const SEVERITY_THRESHOLDS = {warn: 60, critical: 85, exhausted: 100};

/** A heartbeat older than this means nobody is maintaining `limits.json`. */
export const HEARTBEAT_GRACE_MS = 5 * 60 * 1000;

/** Locale and clock the panel formats with. v1 is English only; see docs/PROJECT.md. */
const LOCALE = 'en-GB';

/**
 * `~/.nazar`, resolved the way nazar-core resolves it.
 *
 * `getenv` is passed in rather than read, so that this stays testable and the Shell side
 * keeps the only `GLib` import in the extension. An empty variable is not a directory and
 * is ignored, which is the rule `NAZAR_HOME` follows in the writer.
 */
export function dataDir(getenv) {
    const override = getenv(DATA_DIR_VAR);
    if (override)
        return override;
    const home = getenv('HOME');
    return home ? `${home}/.nazar` : null;
}

/** `{doc}` when the text is a document this build understands, `{error}` when it is not. */
export function parseLimits(text) {
    if (typeof text !== 'string' || text.trim() === '')
        return {doc: null, error: 'nazar-tray has not written limits.json'};

    let doc;
    try {
        doc = JSON.parse(text);
    } catch {
        // Not a torn read: the writer renames a finished file over the target, so a reader
        // sees one document or the other. A damaged file is a damaged file, and saying so
        // is better than drawing half of it.
        return {doc: null, error: 'limits.json is not valid JSON'};
    }

    if (!isObject(doc))
        return {doc: null, error: 'limits.json is not an object'};

    // Rule 4 keeps unknown *fields* readable; a bumped `schemaVersion` is the one change
    // the contract calls breaking, so a version this build does not know is unknown rather
    // than guessed at.
    if (doc.schemaVersion !== undefined && doc.schemaVersion !== 1) {
        return {
            doc: null,
            error: `limits.json is schema version ${doc.schemaVersion}; this reads version 1`,
        };
    }

    if (!isObject(doc.providers))
        return {doc: null, error: 'limits.json carries no providers'};

    return {doc, error: null};
}

/** A window's percentage as a number, or `null` when the window does not carry one. */
export function windowPercent(window) {
    if (!isObject(window))
        return null;
    const percent = window.percent;
    return typeof percent === 'number' && Number.isFinite(percent) ? percent : null;
}

/** Rule 5: down, never to the nearest. A window is not spent until it is spent. */
export function floorPercent(percent) {
    return percent === null ? null : Math.floor(percent);
}

/** `ok` · `warn` · `critical` · `exhausted` · `unknown`, from the contract's table. */
export function severity(percent) {
    if (percent === null)
        return 'unknown';
    if (percent >= SEVERITY_THRESHOLDS.exhausted)
        return 'exhausted';
    if (percent >= SEVERITY_THRESHOLDS.critical)
        return 'critical';
    if (percent >= SEVERITY_THRESHOLDS.warn)
        return 'warn';
    return 'ok';
}

/**
 * The window that binds this provider: the highest percentage, ties to the shorter window
 * and then to the smaller key.
 *
 * `binding` is in the file too, written by nazar-tray from this same rule. We recompute it
 * anyway, because the contract says what to do when the two disagree — *"A consumer that
 * disagrees with the file should trust its own arithmetic: the file may have been written
 * by an older build or by hand"* — and a consumer that trusts its own arithmetic only
 * sometimes has two rules instead of one.
 */
export function bindingWindow(provider) {
    if (!isObject(provider) || !isObject(provider.windows))
        return null;

    let best = null;
    // Sorted, so that the last tie-break — the smaller key — costs nothing: the first
    // window to reach a given percentage at a given length is already the smallest key.
    for (const key of Object.keys(provider.windows).sort()) {
        const window = provider.windows[key];
        const percent = windowPercent(window);
        if (percent === null)
            continue;
        if (best === null || percent > best.percent) {
            best = {key, percent, window};
            continue;
        }
        if (percent === best.percent) {
            const mine = windowMinutes(window);
            const theirs = windowMinutes(best.window);
            if (mine !== null && (theirs === null || mine < theirs))
                best = {key, percent, window};
        }
    }
    return best;
}

/**
 * The one number the panel shows: the highest binding percentage of any provider, floored.
 *
 * The highest rather than an average, because the window that stops you is the one closest
 * to full — an average of 10 % and 90 % is 50 %, and 50 % is a number nothing in the
 * machine is actually at.
 */
export function panelReading(doc) {
    const empty = {percent: null, severity: 'unknown', provider: null, key: null};
    if (!isObject(doc) || !isObject(doc.providers))
        return empty;

    let best = empty;
    for (const name of Object.keys(doc.providers).sort()) {
        const binding = bindingWindow(doc.providers[name]);
        if (binding === null)
            continue;
        const percent = floorPercent(binding.percent);
        if (best.percent === null || percent > best.percent)
            best = {percent, severity: severity(percent), provider: name, key: binding.key};
    }
    return best;
}

/**
 * Is nazar-tray running, in the order the contract gives.
 *
 * A pid the kernel has never heard of means the writer is gone *now*; only a pid that
 * cannot be asked about falls back to the heartbeat's five minutes, because "cannot tell"
 * is never "nobody is there". `pidAlive` returns `true`, `false`, or `null` for cannot
 * tell — on Linux that is a `/proc/<pid>` test, which is why the Shell side owns it.
 *
 * None of this is guessed from `limits.json`'s own age: the tray rewrites that file only
 * when the numbers move, so a week-old document beside a fresh heartbeat is a quiet week
 * and not a broken tray.
 */
export function trayStatus(lockText, {now, pidAlive}) {
    const gone = (reason, pid = null) => ({running: false, reason, pid, heartbeatAgeMs: null});

    if (typeof lockText !== 'string' || lockText.trim() === '')
        return gone('there is no lock file');

    let lock;
    try {
        lock = JSON.parse(lockText);
    } catch {
        return gone('the lock file could not be read');
    }
    if (!isObject(lock))
        return gone('the lock file could not be read');

    const pid = Number.isInteger(lock.pid) && lock.pid > 0 ? lock.pid : null;
    if (pid !== null && pidAlive(pid) === false)
        return gone(`the process that held the lock (${pid}) is gone`, pid);

    const beat = instant(lock.heartbeatAt);
    if (beat === null)
        return gone('the lock carries no heartbeat', pid);

    const age = now - beat;
    if (age > HEARTBEAT_GRACE_MS)
        return {running: false, reason: `the last heartbeat was ${formatSpan(age)} ago`, pid, heartbeatAgeMs: age};

    return {running: true, reason: null, pid, heartbeatAgeMs: age};
}

/** The line under the separator: what the lock just said, in words. */
export function trayLine(status) {
    if (!status.running)
        return `nazar-tray is not running — ${status.reason}`;
    const beat = status.heartbeatAgeMs === null ? '' : `, beating ${formatSpan(status.heartbeatAgeMs)} ago`;
    const pid = status.pid === null ? '' : ` (pid ${status.pid}${beat})`;
    return `nazar-tray is running${pid}`;
}

/**
 * The whole menu, as data: one entry per provider, each with its window rows already
 * worded. The Shell side turns this into widgets and does no arithmetic of its own.
 */
export function providerViews(doc, {now, timeZone}) {
    if (!isObject(doc) || !isObject(doc.providers))
        return [];

    const binding = panelReading(doc);
    return Object.keys(doc.providers).sort().map(name => {
        const provider = doc.providers[name];
        const own = bindingWindow(provider);
        return {
            name,
            title: titleCase(name),
            configured: isObject(provider) && provider.configured === true,
            detail: providerDetail(provider, now),
            note: providerNote(provider),
            windows: windowRows(provider, {now, timeZone, binding: own?.key ?? null, panel: binding}),
        };
    });
}

/** The second half of a provider's header: plan, where the numbers came from, how old. */
function providerDetail(provider, now) {
    if (!isObject(provider))
        return '';
    const parts = [];
    if (typeof provider.plan === 'string' && provider.plan)
        parts.push(provider.plan);
    const source = sourceLabel(provider.source);
    if (source)
        parts.push(source);
    const read = instant(provider.sourceAt);
    if (read !== null)
        parts.push(`read ${formatSpan(now - read)} ago`);
    return parts.join(' · ');
}

/** What to say when a provider has no rows to show. */
function providerNote(provider) {
    if (!isObject(provider))
        return 'could not be read';
    if (provider.configured !== true)
        return 'not configured on this machine';
    if (!isObject(provider.windows) || Object.keys(provider.windows).length === 0)
        return 'nothing could be read';
    return null;
}

/**
 * One row per window, shortest window first.
 *
 * The set of keys is never hard-coded — the contract says to iterate the object and to use
 * `windowMinutes` when the length matters, because a provider may grow a window (Claude's
 * model-scoped weeklies did exactly that) and a face that knows only two names goes blind
 * the day a third arrives.
 */
function windowRows(provider, {now, timeZone, binding, panel}) {
    if (!isObject(provider) || !isObject(provider.windows))
        return [];

    const keys = Object.keys(provider.windows).sort((a, b) => {
        const left = windowMinutes(provider.windows[a]) ?? Number.MAX_SAFE_INTEGER;
        const right = windowMinutes(provider.windows[b]) ?? Number.MAX_SAFE_INTEGER;
        return left === right ? a.localeCompare(b) : left - right;
    });

    return keys.map(key => {
        const window = provider.windows[key];
        const percent = floorPercent(windowPercent(window));
        const state = isObject(window) && typeof window.state === 'string' ? window.state : 'unknown';
        return {
            key,
            label: windowLabel(key, window),
            percent,
            // Rule 2, in the one place a user reads it: a question mark, never a zero.
            percentText: percent === null ? '?' : `${percent} %`,
            severity: severity(percent),
            state,
            stale: state === 'stale',
            binding: key === binding && percent !== null,
            panelBinding: panel.provider !== null && key === panel.key && percent === panel.percent,
            detail: windowDetail(window, now, timeZone),
        };
    });
}

/** "5 hours", "week", "week · Fable", and whatever an unseen key turns out to be. */
export function windowLabel(key, window) {
    const minutes = windowMinutes(window);
    let base;
    if (minutes === 300)
        base = '5 hours';
    else if (minutes === 10080)
        base = 'week';
    else if (minutes !== null)
        base = formatSpan(minutes * 60 * 1000);
    else
        base = String(key).replace(/_/g, ' ');

    const model = isObject(window) && typeof window.model === 'string' && window.model ? ` · ${window.model}` : '';
    return base + model;
}

/** The right-hand half of a window row: when it resets, or why there is no number. */
function windowDetail(window, now, timeZone) {
    if (!isObject(window))
        return '';

    const resets = instant(window.resetsAt);
    if (resets !== null) {
        // Negative is not an error: it is what a reading taken before a long sleep looks
        // like, and it is the one case where a countdown must not count.
        const left = resets - now;
        const when = formatClock(resets, now, timeZone);
        return left <= 0 ? `reset was due ${when}` : `resets ${when} · in ${formatSpan(left)}`;
    }

    // `error` is short by contract — never file contents, never a response body — so it is
    // safe to put on screen as it was written.
    if (typeof window.error === 'string' && window.error)
        return window.error;
    return '';
}

/** RFC 3339 with a `Z`, as milliseconds. `null` for anything that is not one. */
export function instant(value) {
    if (typeof value !== 'string' || value === '')
        return null;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
}

/** A duration in words: `< 1 m`, `45 m`, `2 h 14 m`, `4 d 3 h`. */
export function formatSpan(ms) {
    const total = Math.max(0, Math.round(Math.abs(ms) / 1000));
    if (total < 60)
        return '< 1 m';
    if (total < 3600)
        return `${Math.floor(total / 60)} m`;
    if (total < 86400)
        return `${Math.floor(total / 3600)} h ${Math.floor((total % 3600) / 60)} m`;
    return `${Math.floor(total / 86400)} d ${Math.floor((total % 86400) / 3600)} h`;
}

/**
 * An instant in the user's own time, because the file is in UTC and nobody reads a
 * timestamp off a clock in Greenwich. The date is added only when it is not today's:
 * "06:10" needs no explanation, "7 Sept 05:00" does.
 *
 * `timeZone` is the session's own unless a caller names one, and the only caller that ever
 * does is the test suite — a clock test that passes in one zone and fails in another is
 * testing the machine it ran on.
 */
export function formatClock(ms, now, timeZone = undefined) {
    const zone = timeZone ? {timeZone} : {};
    const at = new Date(ms);
    const time = at.toLocaleTimeString(LOCALE, {...zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
    const day = when => new Date(when).toLocaleDateString(LOCALE, {...zone, year: 'numeric', month: 'short', day: 'numeric'});
    if (day(ms) === day(now))
        return time;
    return `${at.toLocaleDateString(LOCALE, {...zone, day: 'numeric', month: 'short'})} ${time}`;
}

/** `statusline` is a field name; "status line" is what a person reads. */
function sourceLabel(source) {
    if (typeof source !== 'string' || !source)
        return '';
    if (source === 'statusline')
        return 'status line';
    if (source === 'endpoint')
        return 'usage endpoint';
    if (source === 'rollout')
        return 'rollout log';
    // Rule 4: a value a newer writer introduced is shown as written, not dropped.
    return source;
}

function windowMinutes(window) {
    if (!isObject(window))
        return null;
    const minutes = window.windowMinutes;
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

function titleCase(name) {
    return String(name).charAt(0).toUpperCase() + String(name).slice(1);
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
