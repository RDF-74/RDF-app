import { build } from "esbuild";

await build({
  entryPoints: ["scripts/supabase-browser-entry.mjs"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  outfile: "manager/supabase-vendor.js",
});
