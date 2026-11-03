import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { facilityLocalServices } from './scripts/facility-local-services.mjs';

// Keep the frontend preview on the same explicit PC origin as the native launcher.
const pcPort = 4298;

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  preview: { port: pcPort, strictPort: true },
  server: {
    port: pcPort,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react(), facilityLocalServices()],
});
