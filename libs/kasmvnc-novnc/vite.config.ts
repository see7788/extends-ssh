import { defineConfig } from "vite";
import envCompatible from "vite-plugin-env-compatible";
import { viteCommonjs } from "@originjs/vite-plugin-commonjs";
import { ViteMinifyPlugin } from "vite-plugin-minify";
import ViteRestart from "vite-plugin-restart";
import KasmVnc from "../../ubuntu-lib/kasmVnc/index.ts";

export default defineConfig({
  base: "",
  server: { host: "0.0.0.0" },
  plugins: [
    viteCommonjs(),
    envCompatible(),
    ViteMinifyPlugin(),
    ViteRestart({ restart: ["core/**", "app/**"] }),
    new KasmVnc().vitePlugin_kasmUi(),
  ],
  build: {
    sourcemap: false,
    minify: true,
    rollupOptions: {
      input: {
        main: "./index.html",
        screen: "./screen.html",
      },
      output: {
        entryFileNames: "[name].bundle.js",
      },
    },
  },
});
