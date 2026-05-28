import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { config } from "./config.ts";
import { pool } from "./db.ts";
import { boltApp, expressReceiver } from "./slack.ts";
import "./router.ts";
import "./handlers/index.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "..", "public");

expressReceiver.app.use(express.static(publicDir, { fallthrough: true }));

expressReceiver.app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

expressReceiver.app.get("/", (_req, res, next) => {
  res.sendFile(path.join(publicDir, "index.html"), (err) => {
    if (err) next();
  });
});

async function main(): Promise<void> {
  await pool.query("SELECT 1");
  await boltApp.start(config.PORT);
  console.log(`meeny listening on :${config.PORT} (${config.NODE_ENV})`);
}

main().catch((err) => {
  console.error("Failed to start meeny", err);
  process.exit(1);
});
