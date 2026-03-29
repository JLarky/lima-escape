#!/usr/bin/env -S mise x deno -- deno run --no-prompt --allow-run --allow-write=/tmp --allow-read=/tmp --ignore-env --watch
import { startServer } from "./shared.ts";

await startServer();
