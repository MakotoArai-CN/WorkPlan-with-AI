import adapter from '@sveltejs/adapter-static';

const isWebTarget = process.env.VITE_BUILD_TARGET === 'web';
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
        }
    },
    onwarn: (warning, handler) => {
        if (warning.code.startsWith('a11y_')) return;
        handler(warning);
    }
};