// main.ts — entry point. Loads the repo-root .env if there is one (on a server, plain environment
// variables are used instead), then starts the server. Loading first matters: other modules read
// process.env when they are imported.
try { process.loadEnvFile(new URL("../../../.env", import.meta.url)); } catch { /* no .env: use the environment */ }

await import("./server.ts");
