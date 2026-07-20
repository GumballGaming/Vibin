import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const abs = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: "frontend",
  server: {
    port: 1420,
    strictPort: true
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: abs("frontend/app.html"),
        chat: abs("frontend/chat.html"),
        files: abs("frontend/files.html"),
        settings: abs("frontend/settings.html")
      }
    }
  }
});
