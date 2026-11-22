import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const target = process.env.TASKFORGE_API ?? "http://127.0.0.1:4000";

export default defineConfig({
  plugins: [react()],
  // The API only accepts same-origin writes, so the proxy keeps the browser's Host header.
  server: {
    host: "127.0.0.1",
    port: 5188,
    proxy: { "/api": { target, changeOrigin: false } },
  },
  // The production CSP is `default-src 'self'`, which blocks fonts inlined as data URIs.
  build: { assetsInlineLimit: 0 },
});
