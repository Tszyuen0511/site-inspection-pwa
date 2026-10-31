import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
// Pages uses /<repository>/; local development keeps the root URL.
const base = process.env.VITE_BASE_PATH || "/";
export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      base,
      scope: base,
      registerType: "prompt",
      includeAssets: ["favicon.svg", "icons/*.png"],
      manifest: {
        name: "Site Inspection",
        short_name: "Inspection",
        description: "Private, local-first field inspections",
        theme_color: "#17212B",
        background_color: "#F4F5F6",
        display: "standalone",
        id: base,
        start_url: base,
        scope: base,
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: base + "index.html",
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          export: ["jspdf", "jszip"],
          forms: ["react-hook-form", "@hookform/resolvers/zod", "zod"],
          storage: ["dexie", "dexie-react-hooks"],
          ui: ["@radix-ui/react-dialog"],
          "pdf-preview": ["pdfjs-dist"],
        },
      },
    },
  },
});
