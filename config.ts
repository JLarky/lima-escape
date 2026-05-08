import { join } from "node:path";
import { parse as parseJsonc } from "@std/jsonc";
import * as v from "valibot";

const PatternSchema = v.union([
  v.string(),
  v.array(v.union([v.string(), v.array(v.string())])),
]);

const RuleSetSchema = v.record(v.string(), v.array(PatternSchema));

const AbsoluteKeySchema = v.pipe(
  v.string(),
  v.startsWith("/", "must be an absolute path"),
);
const AbsoluteValueSchema = v.pipe(
  v.string(),
  v.startsWith("/", "must map to an absolute host path string"),
);

const ConfigSchema = v.object({
  allow: RuleSetSchema,
  deny: v.optional(RuleSetSchema),
  tokens: v.optional(v.array(v.string())),
  pathMap: v.optional(v.record(AbsoluteKeySchema, AbsoluteValueSchema)),
});

export type Config = v.InferOutput<typeof ConfigSchema>;

function configPath(): string {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME environment variable not set");
  return join(home, ".config", "lima-escape", "config.jsonc");
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

  return v.parse(ConfigSchema, parseJsonc(text));
}

/** Re-read just the tokens array from config (for hot-reload on each request). */
export function loadTokens(path?: string): string[] {
  const p = path ?? configPath();
  try {
    const result = v.safeParse(
      ConfigSchema,
      parseJsonc(Deno.readTextFileSync(p)),
    );
    if (result.success) return result.output.tokens ?? [];
    return [];
  } catch {
    return [];
  }
}
