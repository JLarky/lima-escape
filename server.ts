#!/usr/bin/env -S deno run --no-prompt --allow-run --allow-read --allow-ffi --allow-net --allow-env=HOME
import { loadConfig } from "./config.ts";
import { isAllowed } from "./fnmatch.ts";
import { startServer } from "./shared.ts";

const config = loadConfig();
console.log("allowed patterns:", config.allow);
await startServer({ allow: config.allow, isAllowed });
