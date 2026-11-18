import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// GitHub only offers the demo video as a download; ship it with the portal so it plays in the browser.
const demoVideo = (): Plugin => ({
  name: "demo-video",
  apply: "build",
  writeBundle({ dir }) {
    const source = fileURLToPath(new URL("../../docs/media/demo/launchbay-demo.mp4", import.meta.url));
    mkdirSync(`${dir}/media`, { recursive: true });
    copyFileSync(source, `${dir}/media/launchbay-demo.mp4`);
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), demoVideo()],
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
