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
