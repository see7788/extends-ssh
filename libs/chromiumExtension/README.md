# Chromium extension example

This is a minimal TypeScript Chromium extension. It injects one large red square into ordinary HTTP and HTTPS pages.

Use watch mode while developing:

```text
pnpm dev
```

Watch mode rebuilds `dist`, uploads it through `vitePlugin_chromiumExtension`, and synchronizes the Chromium instance on port 10003. Reload the extension or the page when needed.

Run a one-time build and type check with:

```text
pnpm run typecheck
pnpm run build
```

The generated `dist` directory is an unpacked extension. In Chromium, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `libs/chromiumExtension/dist`.