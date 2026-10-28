import { defineConfig } from "vite";
import KasmVnc from "ubuntu-lib/kasmVnc";

export default defineConfig({
  plugins: [new KasmVnc().vitePlugin_chromiumExtension()],
  build: {
    rollupOptions: {
      input: "src/content.ts",
      output: {
        entryFileNames: "content.js",
      },
    },
  },
});