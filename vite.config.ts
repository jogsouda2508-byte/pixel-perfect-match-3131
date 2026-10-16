import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Keep your existing server entry
    server: { entry: "server" },
  },
  vite: {
    server: {
      allowedHosts: ["pixel-perfect-match-3131.onrender.com"],
    },
  },
});