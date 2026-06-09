// vite.config.ts
// Vite build config and dev-server proxy for local API routes.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/auth/schwab": "http://localhost:3001",
    },
  },
});
