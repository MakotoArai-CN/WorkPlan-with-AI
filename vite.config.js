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
