import { build } from "esbuild";

await build({
  entryPoints: ["scripts/supabase-browser-entry.mjs"],
  bundle: true,
  format: "iife",
  globalName: "RECORDARE_SUPABASE_VENDOR",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  legalComments: "none",
  outfile: "manager/supabase-vendor.js",
});
