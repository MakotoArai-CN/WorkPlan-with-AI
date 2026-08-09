import adapter from '@sveltejs/adapter-static';

function getCliMode() {
    const modeArg = process.argv.find(arg => arg.startsWith('--mode='));
    if (modeArg) return modeArg.slice('--mode='.length);

    const modeIndex = process.argv.indexOf('--mode');
    return modeIndex >= 0 ? process.argv[modeIndex + 1] : '';
}

const isWebTarget = process.env.VITE_BUILD_TARGET === 'web' || getCliMode() === 'web';
const outDir = isWebTarget ? 'build-web' : 'build';

export default {
    kit: {
        adapter: adapter({
            pages: outDir,
            assets: outDir,
            fallback: 'index.html',
            precompress: false,
            strict: true
        }),
        alias: {
            '$lib': 'src/lib'
        },
        // Emit sha256 hashes for SvelteKit's inline bootstrap scripts so the app's CSP
        // can drop script-src 'unsafe-inline' — without this, any XSS in rendered AI
        // output or notes would execute freely.
        csp: {
            mode: 'hash',
            directives: {
                'script-src': ['self']
            }
        }
    },
    onwarn: (warning, handler) => {
        if (warning.code.startsWith('a11y_')) return;
        handler(warning);
    }
};
