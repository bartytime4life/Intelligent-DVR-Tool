import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { facilityLocalServices } from './scripts/facility-local-services.mjs';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

// Keep the frontend preview on the same explicit PC origin as the native launcher.
const pcPort = 4298;

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  preview: { host: '127.0.0.1', port: pcPort, strictPort: true },
  server: {
    port: pcPort,
    strictPort: true,
    host: '127.0.0.1',
    allowedHosts: ["terminal.local"],
    // Runtime files may share the checkout with frontend source. Only the
    // frontend and its dependencies may be served, even with --host overrides.
    fs: { strict: true, allow: ['./src', './public', './index.html', './node_modules'].map(path => {
      const absolute = fileURLToPath(new URL(path, import.meta.url));
      return path === './node_modules' ? realpathSync(absolute) : absolute;
    }) },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react(), facilityLocalServices()],
});
