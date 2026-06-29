// Loads `.env` into `process.env` for the server runtime.
//
// Vite only injects VITE_* vars into `import.meta.env` — it does NOT populate
// `process.env`. So server-only keys (GROQ_API_KEY, GEMINI_API_KEY,
// FIREBASE_SERVICE_ACCOUNT, RESEND_API_KEY, DASHSCOPE_API_KEY, …) would be undefined
// during local `vite dev` / node runs. This side-effect module fills that gap.
//
// It is a no-op on edge runtimes (Cloudflare Workers, etc.) where there's no fs —
// there, env comes from platform bindings, so the try/catch simply does nothing.

function loadDotEnv() {
  try {
    if (typeof process === "undefined" || typeof process.env !== "object") return;
    // Dynamically resolved so bundlers for edge targets can tree-shake / stub it.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const file = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(file)) return;
    const text = fs.readFileSync(file, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (process.env[key] !== undefined) continue; // real env wins
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    /* no fs / not Node — rely on platform-provided env */
  }
}

loadDotEnv();
