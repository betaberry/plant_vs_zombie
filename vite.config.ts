import { defineConfig } from 'vite';

// Rapier compat build embeds its WASM as base64, so no extra wasm plugin is needed.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    // The Rapier chunk embeds its WASM (~4.3 MB); first load stays well under the 15 MB budget (NFR2).
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
