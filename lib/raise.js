// Which window to bring forward, when somebody names a process tree and not a window.
//
// This module is the second thing in the repository built the way lib/contract.js is built:
// it imports nothing — not `gi://`, not the Shell — so every rule below is reachable from
// `gjs -m tests/run.js`. extension.js does the two things only a Shell can do, which are
// enumerating windows and activating one; the decision of *which* one lives here, where a
// test can drive it through a process table that never existed.
//
// The problem it solves is not obvious from the outside, so it is worth stating. Nazar knows
// the pid of a `claude` process, because that process wrote the session file Nazar is
// drawing. Nobody's terminal emulator is that process: on this machine the chain runs
// `claude → bash → ptyxis-agent → ptyxis`, and the window belongs to the last of those. So
// the caller cannot hand over a window, or even the pid that owns one — it hands over the
// whole ancestor chain, nearest ancestor first, and the side that can see windows walks it
// until a pid turns out to own something. The alternative would be for the caller to guess
// which ancestor is the emulator by name, which means a list of terminal names in a file
// that has no business knowing any of them.
//
// One pid, several windows is the ordinary case rather than the exotic one, and that is the
// other half of what is here. A GNOME-era terminal is a single process with a window per
// window: Ptyxis, gnome-terminal and kgx all put every window a person opened under one pid,
// so "the window that owns this pid" is usually a set, and picking out of that set is
// guesswork that has to be *ranked* guesswork rather than "the first one GNOME happened to
// hand us". The ranking is the title hint, then recency, and both are explained below.

/**
 * The one method this extension exports on the session bus, as introspection XML.
 *
 * `org.gnome.Shell.Extensions.Nazar` under `/org/gnome/Shell/Extensions/Nazar`, which is
 * not a namespace we invented: an extension has no bus name of its own, because it runs
 * inside gnome-shell and exports on the Shell's connection, so whatever it exports appears
 * under `org.gnome.Shell`. Living below `/org/gnome/Shell/Extensions` is therefore the
 * honest address for it — the Shell's own extension machinery is already at
 * `/org/gnome/Shell/Extensions` — and it makes the caller's failure legible: a call that
 * comes back `UnknownObject` means this extension is not loaded, which is a different
 * problem from a Shell that is not there at all (`ServiceUnknown`).
 *
 * Two out arguments rather than an exception on failure. "No window owns any of these pids"
 * is not an error — it is the answer, and a common one: the session may be running in a
 * terminal that has since been closed, or on another seat, or under a compositor this call
 * never reaches. A caller that has to tell a D-Bus transport failure apart from a truthful
 * "not found" by reading an error name is a caller that will get it wrong.
 *
 * **The detail string has a grammar**, because it crosses a repository boundary. On success
 * it begins `raised ` followed by the window's `wm_class` and nothing else up to the first
 * `; `, so that Nazar can name the program it brought forward in its own sentence without
 * this interface growing a third out argument for it. Anything after `; ` is a note for a
 * person: which tie-break was used, and how many windows it was choosing between. The class
 * has any `;` of its own replaced before it goes out, so the first segment is unambiguous.
 */
export const RAISE_INTERFACE = `
<node>
  <interface name="org.gnome.Shell.Extensions.Nazar">
    <method name="Raise">
      <arg type="au" direction="in" name="pids"/>
      <arg type="s" direction="in" name="title_hint"/>
      <arg type="b" direction="out" name="raised"/>
      <arg type="s" direction="out" name="detail"/>
    </method>
  </interface>
</node>`;

/** Where the interface above is exported, on the Shell's own connection. */
export const RAISE_OBJECT_PATH = '/org/gnome/Shell/Extensions/Nazar';

/**
 * How many pids of a chain are looked at.
 *
 * Nazar walks at most eight ancestors before it gives up, so anything past that is either a
 * caller that has changed its mind about the depth or a caller that is not Nazar. Sixteen
 * leaves room for the first without turning the second into an unbounded loop over a list
 * somebody else controls: this method is reachable by anything on the session bus, and a
 * bound on the work it can ask for is cheaper to have than to need.
 */
export const MAX_PIDS = 16;

/**
 * Pick the window to raise out of everything the Shell can see.
 *
 * `pids` is the caller's chain, **nearest ancestor first**, and that order is the whole of
 * the search: the first pid in it that owns a window wins, and the rest are not consulted.
 * Nearest-first matters because the chain does not stop at the emulator — it runs on up
 * through `systemd --user`, and on a session where that had a window (it does not, but the
 * rule should not depend on that) a farthest-first search would raise the wrong thing.
 *
 * `windows` is a plain array of `{pid, title, wmClass, userTime}`, in whatever order the
 * Shell handed them over; nothing here touches a Meta object, which is what lets a test
 * drive it. The chosen element is returned as-is, so the caller can activate it.
 *
 * @param {number[]} pids the caller's ancestor chain, nearest first
 * @param {string} titleHint the session's own title, or an empty string
 * @param {object[]} windows every normal window on the session
 * @returns {{window: object|null, detail: string}}
 */
export function chooseWindow(pids, titleHint, windows) {
    const wanted = pidList(pids);
    if (wanted.length === 0)
        return {window: null, detail: 'no usable pid was given'};

    const seen = Array.isArray(windows) ? windows.filter(hasPid) : [];

    for (const pid of wanted) {
        const mine = seen.filter(window => window.pid === pid);
        if (mine.length === 0)
            continue;

        // The ordinary case, and the only one with no guesswork in it at all.
        if (mine.length === 1)
            return {window: mine[0], detail: `raised ${className(mine[0])}`};

        // A terminal with several windows open. The title is tried first because it is the
        // only signal that is actually *about* the session being jumped to: Ptyxis and
        // gnome-terminal both put the foreground command and the working directory in the
        // title, so a session Nazar knows as `nazar: linux jump` is frequently findable by
        // name. A substring match rather than an equality test, because the emulator prefixes
        // and suffixes the title with things of its own and nobody should have to predict
        // which.
        const named = byTitle(mine, titleHint);
        if (named)
            return {
                window: named,
                detail: `raised ${className(named)}; ${mine.length} windows share the pid, took the title match`,
            };

        // And when the title says nothing, the most recently used window. This is a guess
        // and it is labelled as one in the detail, but it is the right guess to make: the
        // window a person last typed in is where they were, and a jump that lands one window
        // away from the session is still a jump that put the terminal in front of them.
        // `get_user_time()` is Mutter's own record of that and it is why the caller is not
        // asked to sort anything.
        const recent = byUserTime(mine);
        return {
            window: recent,
            detail: `raised ${className(recent)}; ${mine.length} windows share the pid, took the most recent`,
        };
    }

    // Counted rather than listed. The pids are the caller's own and it knows them; what it
    // cannot know is whether this Shell looked at all of them, and the count says so.
    return {window: null, detail: `no window owns any of ${wanted.length} pids`};
}

/**
 * The caller's list, made safe to loop over: integers only, positive only, each one once,
 * order preserved, and no more than `MAX_PIDS` of them.
 *
 * Order is preserved because order is meaning here — it is the distance from the session —
 * so the usual trick of sorting to dedupe would quietly break the search. pid 0 and negative
 * values are dropped rather than rejected: `au` cannot carry a negative, but a window whose
 * pid Mutter does not know reports `-1`, and a caller that passed 0 would otherwise match
 * every one of them.
 */
function pidList(pids) {
    if (!Array.isArray(pids))
        return [];
    const out = [];
    for (const pid of pids) {
        if (!Number.isInteger(pid) || pid <= 0 || out.includes(pid))
            continue;
        out.push(pid);
        if (out.length === MAX_PIDS)
            break;
    }
    return out;
}

/** A window Mutter could attribute to a process. `-1` is "it would not say". */
function hasPid(window) {
    return !!window && Number.isInteger(window.pid) && window.pid > 0;
}

/**
 * The window whose title contains the hint, and the most recent of them if several do.
 *
 * Case-insensitive, because a terminal title is partly the emulator's prose and partly the
 * user's, and neither half has a case convention. An empty or absent hint matches nothing
 * rather than everything — a caller with no title to offer should fall through to recency,
 * not be handed the first window in the list.
 */
function byTitle(windows, titleHint) {
    const hint = typeof titleHint === 'string' ? titleHint.trim().toLowerCase() : '';
    if (hint.length === 0)
        return null;
    const matches = windows.filter(window =>
        typeof window.title === 'string' && window.title.toLowerCase().includes(hint));
    if (matches.length === 0)
        return null;
    return byUserTime(matches);
}

/**
 * The most recently used of several windows.
 *
 * Strictly greater, so a tie keeps the earlier element and the answer does not depend on
 * whether the Shell's window order is stable between two calls. A window with no usable
 * `userTime` sorts as never-used rather than as most-recent, which is the direction that
 * cannot surprise anybody.
 */
function byUserTime(windows) {
    let best = windows[0];
    let bestTime = userTime(best);
    for (const window of windows.slice(1)) {
        const time = userTime(window);
        if (time > bestTime) {
            best = window;
            bestTime = time;
        }
    }
    return best;
}

function userTime(window) {
    const time = window?.userTime;
    return Number.isFinite(time) ? time : -1;
}

/**
 * The window's class, as the first segment of the detail string.
 *
 * A `wm_class` is a program's own name for itself and in practice it is one word — `ptyxis`,
 * `gnome-terminal-server`, `org.gnome.Console`. It is still a string a foreign toolkit sets,
 * so the one character that would break the detail's grammar is taken out of it here rather
 * than trusted not to appear. A window that has no class at all becomes the word `unknown`
 * rather than an empty gap: the caller drops this straight into "raised the … window", and a
 * sentence with a hole in it reads as a bug in Nazar rather than as a window without a class.
 */
function className(window) {
    const raw = window?.wmClass;
    if (typeof raw !== 'string' || raw.trim().length === 0)
        return 'unknown';
    return raw.trim().replace(/;/g, ',');
}
