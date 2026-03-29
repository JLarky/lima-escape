import { join } from "jsr:@std/path";

export interface Config {
  allow: string[];
}

function configPath(): string {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME environment variable not set");
  return join(home, ".config", "lima-escape", "config.json");
}

export function loadConfig(path?: string): Config {
  const p = path ?? configPath();
  let text: string;
  try {
    text = Deno.readTextFileSync(p);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error(
        `Config not found at ${p}\nCreate it with an "allow" array, e.g.:\n  { "allow": ["gh pr view *", "git status"] }`,
      );
    }
    throw e;
  }

  const raw = JSON.parse(text);

  if (!Array.isArray(raw.allow)) {
    throw new Error(`Invalid config: "allow" must be an array of strings`);
  }
  if (!raw.allow.every((x: unknown) => typeof x === "string")) {
    throw new Error(`Invalid config: every entry in "allow" must be a string`);
  }

  return { allow: raw.allow };
}
