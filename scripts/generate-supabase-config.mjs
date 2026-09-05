import { writeFile } from "node:fs/promises";

const url = process.env.RECORDARE_SUPABASE_URL || "";
const anonKey = process.env.RECORDARE_SUPABASE_ANON_KEY || "";
const contents = `// Generated at Vercel build time. Do not add service_role or other secrets here.\nwindow.RECORDARE_SUPABASE_CONFIG = ${JSON.stringify({ url, anonKey }, null, 2)};\n`;

await writeFile(new URL("../manager/supabase-config.js", import.meta.url), contents);
