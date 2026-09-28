// Two entry points: the game (index.html) and the map builder (editor.html).
// WARNING: declaring build.rollupOptions.input REPLACES vite's implicit index.html entry. Listing
// only editor.html here produces a dist with a builder and NO GAME, silently and with exit 0 --
// index.html must stay in this object forever.
// Everything else is the original three-line config verbatim: hmr:false + watch:null (the dev
// server never reloads, so deterministic captures are not raced by a rebuild) and
// assetsInlineLimit:0 (nothing becomes a data URI, which is what tools/shot.mjs's static MIME
// table depends on).
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mapsPlugin from './tools/vite-maps-plugin.js';

const dir = fileURLToPath(new URL('.', import.meta.url));

export default {
  // Relative base: the built site works from any sub-path (GitHub Pages serves it at /<repo>/). Runtime asset
  // URLs in src/ are relative ('./sprites/...') for the same reason; every page is served from the site root dir.
  base: './',
  // Dev-only (`apply: 'serve'`): POST /__map/write for the editor's "save to src/world/maps".
  // A production build carries no write endpoint, so io.js degrades to download/clipboard there.
  plugins: [mapsPlugin()],
  server: { hmr: false, watch: null, host: '127.0.0.1' },
  build: {
    target: 'esnext', assetsInlineLimit: 0, chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: { main: resolve(dir, 'index.html'), editor: resolve(dir, 'editor.html') },
    },
  },
};
