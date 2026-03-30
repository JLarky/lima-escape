import { join } from "jsr:@std/path";

export interface Config {
  allow: Record<string, string[]>;
  deny?: Record<string, string[]>;
  tokens?: string[];
}

function configPath(): string {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME environment variable not set");
  return join(home, ".config", "lima-escape", "config.json");
}

function validateRuleSet(
  value: unknown,
  name: string,
): asserts value is Record<string, string[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `Invalid config: "${name}" must be an object mapping cwd patterns to string arrays`,
    );
  }
  for (const [key, arr] of Object.entries(value)) {
    if (
      !Array.isArray(arr) ||
      !arr.every((x: unknown) => typeof x === "string")
    ) {
      throw new Error(
        `Invalid config: "${name}" key "${key}" must map to an array of strings`,
      );
    }
  }
}

export function loadConfig(path?: string): Config {
  const p = path ?? configPath();
  let text: string;
  try {
    text = Deno.readTextFileSync(p);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error(
        `Config not found at ${p}\nCreate it with an "allow" object, e.g.:\n  { "allow": { "*": ["gh pr view *", "git status"] } }`,
      );
    }
    throw e;
  }

  const raw = JSON.parse(text);

  validateRuleSet(raw.allow, "allow");
  if (raw.deny !== undefined) {
    validateRuleSet(raw.deny, "deny");
  }
  if (raw.tokens !== undefined) {
    if (
      !Array.isArray(raw.tokens) ||
      !raw.tokens.every((x: unknown) => typeof x === "string")
    ) {
      throw new Error('Invalid config: "tokens" must be an array of strings');
    }
  }

  return {
    allow: raw.allow,
    ...(raw.deny ? { deny: raw.deny } : {}),
    ...(raw.tokens ? { tokens: raw.tokens } : {}),
  };
}

/** Re-read just the tokens array from config (for hot-reload on each request). */
export function loadTokens(path?: string): string[] {
  const p = path ?? configPath();
  try {
    const raw = JSON.parse(Deno.readTextFileSync(p));
    if (Array.isArray(raw.tokens)) return raw.tokens;
    return [];
  } catch {
    return [];
  }
}
