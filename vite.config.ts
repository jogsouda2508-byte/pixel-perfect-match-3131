
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
    spa: {
      enabled: true,
    },
  },
  vite: {
    server: {
      allowedHosts: ["pixel-perfect-match-3131.onrender.com"],
    },
  },
});
