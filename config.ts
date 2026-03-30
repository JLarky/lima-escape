import { join } from "jsr:@std/path";

export interface Config {
  allow: Record<string, string[]>;
  deny?: Record<string, string[]>;
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

  return { allow: raw.allow, ...(raw.deny ? { deny: raw.deny } : {}) };
}
