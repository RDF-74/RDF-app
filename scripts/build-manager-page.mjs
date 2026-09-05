import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const shortGitSha = () => {
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};
const buildSha = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || shortGitSha()).slice(0, 7);
let page = await read("../manager/index.template.html");
const replacements = {
  "/* __MANAGER_CSS__ */": await read("../manager/manager.css"),
  "/* __BUILD_INFO__ */": `window.RECORDARE_MANAGER_BUILD = { sha: ${JSON.stringify(buildSha)} };`,
  "/* __SUPABASE_CONFIG__ */": await read("../manager/supabase-config.js"),
  "/* __SUPABASE_VENDOR__ */": await read("../manager/supabase-vendor.js"),
  "/* __SUPABASE_CLIENT__ */": await read("../manager/supabase-client.js"),
  "/* __MANAGER_APP__ */": await read("../manager/app.js"),
};
for (const [placeholder, contents] of Object.entries(replacements))
  page = page.replace(placeholder, contents);
await writeFile(new URL("../manager/index.html", import.meta.url), page);
