import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { spineMagicApi } from "./api-plugin";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), spineMagicApi()],
  resolve: { alias: { "@core": fileURLToPath(new URL("../src/core", import.meta.url)) } },
  server: { port: 5174, fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] } },
  build: { outDir: "../dist-web", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
