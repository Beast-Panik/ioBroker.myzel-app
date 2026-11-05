// ioBroker eslint template configuration file for js and ts files
// Please note that esm or react based modules need additional modules loaded.
import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        // specify files to exclude from linting here
        ignores: [
            '.dev-server/',
            '.vscode/',
            '*.test.js',
            'test/**/*.js',
            '*.config.mjs',
            'build',
            'dist',
            'admin/words.js',
            'admin/admin.d.ts',
            'admin/blockly.js',
            '**/adapter-config.d.ts',
            'widgets/**/*.js'
        ],
    },
    {
        // Karten- und Profilseite laufen im Browser des Admins; io kommt aus dessen lib/js/socket.io.js.
        files: ['admin/**/*.js'],
        languageOptions: {
            sourceType: 'module',
            globals: {
                window: 'readonly',
                document: 'readonly',
                location: 'readonly',
                navigator: 'readonly',
                matchMedia: 'readonly',
                getComputedStyle: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                URLSearchParams: 'readonly',
                io: 'readonly',
            },
        },
    },
    {
        // Projektregel: Kommentare nur, wo sie ein nicht offensichtliches Warum erklären. Pflicht-JSDoc widerspricht dem.
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-returns': 'off',
            'jsdoc/require-returns-description': 'off',
        },
    },
];