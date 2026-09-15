import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  publicDir: false,
  build: { outDir: mode === "hosted" ? "public" : "dist" },
  plugins: [react()],
  server: { host: "127.0.0.1" },
}));
