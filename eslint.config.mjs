// Lint for a repository with no `node_modules`, and none coming.
//
// This is an extension, not a Node package: there is no `package.json`, no lock file and
// nothing to install, so the rules below are ESLint's own — a flat config that imports
// nothing can be run straight out of `npx eslint` in CI without a dependency ever landing
// in the tree. What it is actually for is the class of mistake a test cannot reach: a
// variable that is never defined (GJS answers with a crash inside the Shell, at the moment
// the panel is drawn), one that is assigned and never read, a duplicated key in an object
// literal, a `case` that falls through.
//
// The globals are GJS's rather than a browser's or Node's. `imports` and `pkg` belong to
// the legacy loader this extension does not use, but naming them costs nothing and keeps a
// future file from tripping on them; `print` is what `tests/run.js` writes with, and
// `console` is what `extension.js` warns with — GJS has both.

const gjsGlobals = {
    ARGV: 'readonly',
    Debugger: 'readonly',
    GIRepositoryGType: 'readonly',
    imports: 'readonly',
    log: 'readonly',
    logError: 'readonly',
    pkg: 'readonly',
    print: 'readonly',
    printerr: 'readonly',
    window: 'readonly',

    // GNOME Shell's own: the compositor object the Shell puts in scope for extensions.
    // It is declared here for `extension.js`, which is the only file that may touch it;
    // `lib/contract.js` runs under plain gjs, where `global` does not exist, so the thing
    // that would catch it there is the test suite rather than this list.
    global: 'readonly',

    console: 'readonly',
    setInterval: 'readonly',
    setTimeout: 'readonly',
    clearInterval: 'readonly',
    clearTimeout: 'readonly',
    TextDecoder: 'readonly',
    TextEncoder: 'readonly',
    globalThis: 'readonly',
};

export default [
    {
        ignores: ['**/*.zip'],
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: gjsGlobals,
        },
        linterOptions: {
            reportUnusedDisableDirectives: 'error',
        },
        rules: {
            'constructor-super': 'error',
            'for-direction': 'error',
            'getter-return': 'error',
            'no-async-promise-executor': 'error',
            'no-case-declarations': 'error',
            'no-class-assign': 'error',
            'no-compare-neg-zero': 'error',
            'no-cond-assign': 'error',
            'no-const-assign': 'error',
            'no-constant-condition': 'error',
            'no-control-regex': 'error',
            'no-debugger': 'error',
            'no-dupe-args': 'error',
            'no-dupe-class-members': 'error',
            'no-dupe-else-if': 'error',
            'no-dupe-keys': 'error',
            'no-duplicate-case': 'error',
            'no-empty': ['error', {allowEmptyCatch: true}],
            'no-empty-character-class': 'error',
            'no-empty-pattern': 'error',
            'no-ex-assign': 'error',
            'no-extra-boolean-cast': 'error',
            'no-fallthrough': 'error',
            'no-func-assign': 'error',
            'no-import-assign': 'error',
            'no-invalid-regexp': 'error',
            'no-irregular-whitespace': 'error',
            'no-loss-of-precision': 'error',
            'no-misleading-character-class': 'error',
            'no-new-native-nonconstructor': 'error',
            'no-obj-calls': 'error',
            'no-octal': 'error',
            'no-prototype-builtins': 'error',
            'no-redeclare': 'error',
            'no-regex-spaces': 'error',
            'no-self-assign': 'error',
            'no-self-compare': 'error',
            'no-setter-return': 'error',
            'no-shadow-restricted-names': 'error',
            'no-sparse-arrays': 'error',
            'no-this-before-super': 'error',
            'no-unassigned-vars': 'error',
            'no-undef': 'error',
            'no-unexpected-multiline': 'error',
            'no-unreachable': 'error',
            'no-unsafe-finally': 'error',
            'no-unsafe-negation': 'error',
            'no-unsafe-optional-chaining': 'error',
            'no-unused-labels': 'error',
            'no-unused-private-class-members': 'error',
            'no-unused-vars': ['error', {args: 'none', caughtErrors: 'none'}],
            'no-useless-backreference': 'error',
            'no-useless-catch': 'error',
            'no-useless-escape': 'error',
            'no-with': 'error',
            'require-yield': 'error',
            'use-isnan': 'error',
            'valid-typeof': 'error',

            // Not in ESLint's recommended set, and each one is a shape this codebase has a
            // reason to refuse: a bare `==` against a GJS value that may be `null` or
            // `undefined` reads differently from `===`, and a `var` in a file full of
            // `const` is a scoping surprise waiting for the next edit.
            eqeqeq: ['error', 'always', {null: 'ignore'}],
            'no-var': 'error',
            'prefer-const': 'error',
        },
    },
];
