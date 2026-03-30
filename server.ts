#!/usr/bin/env -S deno run --no-prompt --allow-run --allow-read --allow-ffi --allow-net --allow-env=HOME
import { loadConfig } from "./config.ts";
import { isAllowed } from "./fnmatch.ts";
import { startServer } from "./shared.ts";

const config = loadConfig();
console.log("allowed patterns:", JSON.stringify(config.allow, null, 2));
if (config.deny) {
  console.log("denied patterns:", JSON.stringify(config.deny, null, 2));
}
await startServer({ allow: config.allow, deny: config.deny, isAllowed });
