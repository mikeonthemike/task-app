import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

export default defineConfig({
  // The main process imports ../src/core directly, so the vault is read and written by the
  // same code the CLI uses. Root deps it pulls in (gray-matter, nanoid, chrono-node) get bundled.
  main: {},
  preload: {
    // CommonJS preload so the renderer can stay sandboxed.
    build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
  },
  renderer: {
    plugins: [react()],
  },
});
