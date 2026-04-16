import { resolve } from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [
        tailwindcss(),
        sveltekit()
    ],
    clearScreen: false,
    build: {
        // WorkPlan runs inside modern Tauri WebView runtimes, so targeting
        // `esnext` avoids unnecessary transpilation pressure during builds.
        target: 'esnext',
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) {
                        return undefined;
                    }

                    if (
                        id.includes('@milkdown/') ||
                        id.includes('vditor') ||
                        id.includes('marked') ||
                        id.includes('mermaid') ||
                        id.includes('katex') ||
                        id.includes('highlight.js')
                    ) {
                        return 'editor-stack';
                    }

                    if (
                        id.includes('exceljs') ||
                        id.includes('jspdf') ||
                        id.includes('html2canvas')
                    ) {
                        return 'export-stack';
                    }

                    if (
                        id.includes('chart.js') ||
                        id.includes('recharts')
                    ) {
                        return 'chart-stack';
                    }

                    if (
                        id.includes('@supabase/') ||
                        id.includes('crypto-js')
                    ) {
                        return 'data-stack';
                    }

                    return undefined;
                }
            }
        }
    },
    server: {
        port: 1420,
        strictPort: true,
        host: true,
        fs: {
            // G4F is loaded from the repo root `g4f.dev/dist`, so dev server
            // must allow reads outside the default SvelteKit source directories.
            allow: [resolve('.')]
        }
    },
    envPrefix: ['VITE_', 'TAURI_']
});
