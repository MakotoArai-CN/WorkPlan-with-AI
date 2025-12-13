import adapter from '@sveltejs/adapter-static';

export default {
    kit: {
        adapter: adapter({
            pages: 'build',
            assets: 'build',
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