import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Single-page app: the dev server and `vite preview` fall back to index.html
// for /clients and /clients/:id, so deep links and reloads work.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: "/clients" },
  preview: { port: 4173 },
});
