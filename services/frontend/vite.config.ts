import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Hidden source maps: generated for Error Tracking upload (EP2), never served to browsers.
export default defineConfig({
  plugins: [react()],
  build: { sourcemap: "hidden", outDir: "dist" },
});
