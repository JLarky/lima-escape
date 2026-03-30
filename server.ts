#!/usr/bin/env -S deno run --no-prompt --allow-run --allow-read --allow-net --allow-env=HOME,LIMA_ESCAPE_TOKENS
import { loadConfig, loadTokens } from "./config.ts";
import { isAllowed } from "./match.ts";
import { startServer } from "./shared.ts";

const config = loadConfig();
console.log("allowed patterns:", JSON.stringify(config.allow, null, 2));
if (config.deny) {
  console.log("denied patterns:", JSON.stringify(config.deny, null, 2));
}

const envTokens = Deno.env.get("LIMA_ESCAPE_TOKENS")?.split(",").filter(
  Boolean,
) ?? [];
if (envTokens.length > 0) {
  console.log(`loaded ${envTokens.length} token(s) from LIMA_ESCAPE_TOKENS`);
}
const configTokenCount = config.tokens?.length ?? 0;
if (configTokenCount > 0) {
  console.log(`loaded ${configTokenCount} token(s) from config`);
}

function checkToken(token: string): boolean {
  if (envTokens.includes(token)) return true;
  return loadTokens().includes(token);
}

await startServer({
  allow: config.allow,
  deny: config.deny,
  isAllowed,
  checkToken,
});
