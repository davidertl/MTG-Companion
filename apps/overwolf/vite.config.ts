import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "main.html"),
        setup: path.resolve(__dirname, "setup.html"),
        imports: path.resolve(__dirname, "imports.html"),
        collection: path.resolve(__dirname, "collection.html"),
        inventory: path.resolve(__dirname, "inventory.html"),
        draft: path.resolve(__dirname, "draft.html"),
        decks: path.resolve(__dirname, "decks.html"),
        diagnostics: path.resolve(__dirname, "diagnostics.html"),
        privacy: path.resolve(__dirname, "privacy.html"),
        settings: path.resolve(__dirname, "settings.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@arenac": path.resolve(__dirname, "../desktop/src"),
      // shared-schema lives outside this package; pin zod to this app's node_modules
      zod: path.resolve(__dirname, "node_modules/zod"),
    },
  },
});
