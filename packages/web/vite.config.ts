import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "PixExplore",
        short_name: "PixExplore",
        lang: "fr",
        start_url: "/",
        display: "standalone",
        background_color: "#faf5f9",
        theme_color: "#faf5f9",
        // Generated from public/icon.svg (#165); the maskable one is full-bleed for Android's masks.
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Don't cache API responses (fresh data + no stale PII in the SW cache).
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    // Dev proxy to the API so cookies stay same-origin.
    // Override the target with API_PROXY_TARGET when the API runs on a non-default port.
    proxy: { "/api": process.env.API_PROXY_TARGET || "http://localhost:3000" },
  },
});
