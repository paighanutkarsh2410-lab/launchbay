import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router"],
          motion: ["motion"],
          data: ["@tanstack/react-query", "cmdk"],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // The smoke tests point the portal at their own API (playwright.config.ts).
      "/api": { target: process.env.LAUNCHBAY_API ?? "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
});
