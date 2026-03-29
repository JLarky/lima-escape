#!/usr/bin/env -S mise x deno -- deno run --no-prompt --allow-write=/tmp --allow-read=/tmp --ignore-env
import { globSync } from "node:fs";
import { startClient } from "./shared.ts";

if (import.meta.main) {
  Deno.chdir("/tmp");
  const socketPaths = globSync("lima-code-*/socket");

  if (socketPaths.length === 0) {
    console.error('%cNo lima-code server found. Make sure to open Cursor/VS Code remote connection and start lima-code server in built-in terminal first.', 'color: red; font-weight: bold');

    const cmd = `mise x deno -- deno run --no-prompt --allow-run --allow-write=/tmp --allow-read=/tmp --ignore-env https://raw.githubusercontent.com/JLarky/lima-code/refs/heads/main/server.ts`;

    console.log('Start it with this command:\n  ', cmd);

    Deno.exit(1);
  }

  const socketPath = socketPaths[0];
  await startClient(socketPath, JSON.stringify({ args: Deno.args }));
}
