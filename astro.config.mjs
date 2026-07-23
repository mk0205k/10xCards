// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";
import { paraglideVitePlugin } from "@inlang/paraglide-js";

// https://astro.build/config
export default defineConfig({
  output: "server",
  site: "https://10x-astro-starter.mk-betasi.workers.dev",
  integrations: [react(), sitemap()],
  i18n: {
    defaultLocale: "pl",
    locales: ["pl", "en"],
  },
  vite: {
    plugins: [
      tailwindcss(),
      paraglideVitePlugin({
        project: "./project.inlang",
        outdir: "./src/paraglide",
        emitTsDeclarations: true,
        strategy: ["cookie", "globalVariable", "baseLocale"],
      }),
    ],
    server: {
      watch: {
        ignored: ["**/.vs/**", "**/node_modules/**", "**/dist/**", "**/dist-dry/**"],
      },
    },
  },
  adapter: cloudflare(),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret" }),
      OPENROUTER_MODEL: envField.string({
        context: "server",
        access: "public",
        default: "google/gemini-2.5-flash",
      }),
      PUBLIC_SITE_URL: envField.string({ context: "server", access: "public", optional: false }),
    },
  },
});
