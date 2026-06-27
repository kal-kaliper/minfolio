import { defineConfig } from 'vite'

// Capacitor loads the built web assets from disk inside the APK, so relative
// asset paths (base: './') are required.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
  },
  server: {
    host: true,
    port: 5173,
  },
})
