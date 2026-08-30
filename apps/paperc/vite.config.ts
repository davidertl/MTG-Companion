import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// MancuTG-PaperC PWA build (plan 2026-07-06-001 W2.2). Mirrors the desktop
// app's Vite/React 19 setup; the client is fully static and offline-capable —
// the card-name index is bundled at build time (see scripts/build_card_name_index.ts).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5273,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
