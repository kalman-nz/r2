import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    proxy: {
      // PocketBase now owns both /api/* (pb_hooks) and its own /api/collections/*
      // — point the dev proxy at a locally-running `pocketbase serve` instance.
      "/api": "http://localhost:3001",
    },
  },
});
