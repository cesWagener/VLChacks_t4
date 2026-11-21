import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Single-page app: the dev server and `vite preview` fall back to index.html
// for /clients and /clients/:id, so deep links and reloads work.
export default defineConfig({
  plugins: [react()],
  // /api goes to the backend (apps/api), which holds the keys and calls the AI proxy.
  server: { port: 5173, open: "/clients", proxy: { "/api": "http://127.0.0.1:8787" } },
  preview: { port: 4173 },
});
