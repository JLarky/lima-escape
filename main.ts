#!/usr/bin/env -S deno run --no-prompt --allow-net --allow-env=LIMA_ESCAPE_HOST,LIMA_ESCAPE_PORT
import { DEFAULT_PORT, startClient } from "./shared.ts";

if (import.meta.main) {
  const hostname = Deno.env.get("LIMA_ESCAPE_HOST") ?? "host.lima.internal";
  const port = Number(Deno.env.get("LIMA_ESCAPE_PORT") ?? DEFAULT_PORT);

  const res = await startClient(hostname, port, Deno.args);

  if (res.stdout) Deno.stdout.writeSync(new TextEncoder().encode(res.stdout));
  if (res.stderr) Deno.stderr.writeSync(new TextEncoder().encode(res.stderr));

  Deno.exit(res.code);
}
