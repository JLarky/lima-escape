import { join } from "node:path";
import { parse } from "@std/jsonc";
import type { Pattern } from "./match.ts";

export interface Config {
  allow: Record<string, Pattern[]>;
  deny?: Record<string, Pattern[]>;
  tokens?: string[];
}

function configPath(): string {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME environment variable not set");
  const base = join(home, ".config", "lima-escape");
  try {
    const p = join(base, "config.jsonc");
    Deno.statSync(p);
    return p;
  } catch {
    return join(base, "config.json");
  }
}

/** Validate a single pattern: string or array of (string | string[]). */
function isValidPattern(x: unknown): x is Pattern {
  if (typeof x === "string") return true;
  if (!Array.isArray(x)) return false;
  return (x as unknown[]).every((el) => {
    if (typeof el === "string") return true;
    if (
      Array.isArray(el) &&
      (el as unknown[]).every((s) => typeof s === "string")
    ) return true;
    return false;
  });
}

function validateRuleSet(
  value: unknown,
  name: string,
): asserts value is Record<string, Pattern[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `Invalid config: "${name}" must be an object mapping cwd patterns to pattern arrays`,
    );
  }
  for (const [key, arr] of Object.entries(value)) {
    if (!Array.isArray(arr) || !arr.every(isValidPattern)) {
      throw new Error(
        `Invalid config: "${name}" key "${key}" must map to an array of patterns (strings or arrays)`,
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

  const raw = parse(text) as any;

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
    const raw = parse(Deno.readTextFileSync(p)) as any;
    if (Array.isArray(raw.tokens)) return raw.tokens;
    return [];
  } catch {
    return [];
  }
}
