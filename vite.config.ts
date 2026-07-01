import { defineConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";

// Standard TanStack Start + Vite setup (no Lovable wrapper).
// - @/* path alias comes from tsconfig via vite-tsconfig-paths
// - VITE_* env vars are injected natively by Vite into import.meta.env
// - src/server.ts is our SSR entry (error wrapper + .env loader)
export default defineConfig({
  server: {
    port: 3000,
    host: true,
  },
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-store"],
  },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      server: { entry: "server" },
      // Our server-only code lives in *.server.ts files that are imported by routes
      // purely for their createServerFn RPC stubs — the handler bodies (and their
      // firebase-admin / node imports) are stripped from the client bundle by the
      // serverFn transform. Scope import-protection to the literal `server-only`
      // package so it doesn't false-positive on those modules.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    // On Vercel, build the Vercel (serverless) target; locally/elsewhere build a
    // standalone Node server. Avoids the Cloudflare auto-detection (firebase-admin
    // doesn't run on Workers).
    nitro({
      preset: process.env.VERCEL ? "vercel" : "node-server",
      // AI image generation can take ~15–30s; raise the Vercel function limit above the 10s default.
      vercel: { functions: { maxDuration: 60 } },
    }),
    viteReact(),
  ],
});
