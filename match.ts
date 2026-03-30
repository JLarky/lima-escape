/**
 * Token-based command matching — replaces fnmatch C FFI.
 *
 * Supports two pattern formats:
 * - String patterns: "gh pr *" (sugar, desugared to array form)
 * - Array patterns: ["gh", ["pr", "issue"], "*"] (Codex-style alternatives)
 */

/** A single command pattern: string sugar or array form. */
export type Pattern = string | (string | string[])[];

export type AllowResult =
  | { allowed: true }
  | { allowed: false; reason: string; hint?: string };

export interface Rules {
  allow: Record<string, Pattern[]>;
  deny?: Record<string, Pattern[]>;
}

/** Specificity of a cwd pattern: more path segments = more specific. "*" = 0. */
export function cwdSpecificity(pattern: string): number {
  if (pattern === "*") return 0;
  return pattern.split("/").filter(Boolean).length;
}

/**
 * Check if a cwd matches a cwd pattern.
 * - "*" matches any cwd
 * - Otherwise: exact match or cwd is inside the pattern directory
 */
export function cwdMatches(pattern: string, cwd: string): boolean {
  if (pattern === "*") return true;
  return cwd === pattern || cwd.startsWith(pattern + "/");
}

/** Desugar a string pattern into array form by splitting on spaces. */
function toArrayPattern(pattern: Pattern): (string | string[])[] {
  if (typeof pattern === "string") {
    return pattern.split(" ");
  }
  return pattern;
}

/**
 * Match a command pattern against an argv array element-by-element.
 *
 * - string token (not "*"): exact match (===)
 * - string[] token: alternatives (Array.includes())
 * - "*" (only valid as last element): zero or more trailing args
 * - No trailing "*": exact match (no extra args allowed)
 */
export function matchCommand(pattern: Pattern, argv: string[]): boolean {
  if (argv.length === 0) return false;
  const tokens = toArrayPattern(pattern);
  if (tokens.length === 0) return false;

  const lastIdx = tokens.length - 1;
  const lastToken = tokens[lastIdx];

  if (lastToken === "*") {
    // Trailing wildcard: match fixed prefix, then accept 0+ remaining args
    if (argv.length < lastIdx) return false;
    for (let i = 0; i < lastIdx; i++) {
      if (!matchToken(tokens[i], argv[i])) return false;
    }
    return true;
  }

  // No trailing wildcard: exact element count required
  if (argv.length !== tokens.length) return false;
  for (let i = 0; i < tokens.length; i++) {
    if (!matchToken(tokens[i], argv[i])) return false;
  }
  return true;
}

/** Match a single token against an argv element. */
function matchToken(token: string | string[], value: string): boolean {
  if (Array.isArray(token)) {
    return token.includes(value);
  }
  return token === value;
}

/**
 * Pretty-print a pattern for display.
 * - Strings print as-is: "gh pr *"
 * - Arrays that are all plain strings (1:1 with string form) print as string: "gh pr *"
 * - Arrays containing sub-arrays print as JSON array: ["gh",["pr","issue"],"*"]
 */
export function prettyPrintPattern(pattern: Pattern): string {
  if (typeof pattern === "string") return pattern;
  const hasAlternatives = pattern.some((el) => Array.isArray(el));
  if (!hasAlternatives) return (pattern as string[]).join(" ");
  return JSON.stringify(pattern);
}

/** Format a pattern for display in error messages (with quotes). */
function formatPattern(pattern: Pattern): string {
  const pp = prettyPrintPattern(pattern);
  if (typeof pattern === "string" || !pattern.some((el) => Array.isArray(el))) {
    return `"${pp}"`;
  }
  return pp;
}

export function isAllowed(
  argv: string[],
  cwd: string,
  rules: Rules,
): AllowResult {
  // Collect all matching rules with their specificity and type
  type Match = {
    type: "allow" | "deny";
    cwdPattern: string;
    commandPattern: Pattern;
    specificity: number;
  };
  const matches: Match[] = [];

  for (const [cwdPattern, patterns] of Object.entries(rules.allow)) {
    if (cwdMatches(cwdPattern, cwd)) {
      const specificity = cwdSpecificity(cwdPattern);
      for (const pattern of patterns) {
        if (matchCommand(pattern, argv)) {
          matches.push({
            type: "allow",
            cwdPattern,
            commandPattern: pattern,
            specificity,
          });
        }
      }
    }
  }

  if (rules.deny) {
    for (const [cwdPattern, patterns] of Object.entries(rules.deny)) {
      if (cwdMatches(cwdPattern, cwd)) {
        const specificity = cwdSpecificity(cwdPattern);
        for (const pattern of patterns) {
          if (matchCommand(pattern, argv)) {
            matches.push({
              type: "deny",
              cwdPattern,
              commandPattern: pattern,
              specificity,
            });
          }
        }
      }
    }
  }

  if (matches.length === 0) {
    // Check for hint: does a prefix of argv match an exact pattern (no trailing *)?
    const hint = findHint(argv, rules);
    return {
      allowed: false,
      reason: `"${argv.join(" ")}" does not match any allowed pattern`,
      ...(hint ? { hint } : {}),
    };
  }

  // Most specific cwd wins; deny breaks ties
  const maxSpecificity = Math.max(...matches.map((m) => m.specificity));
  const best = matches.filter((m) => m.specificity === maxSpecificity);

  const deny = best.find((m) => m.type === "deny");
  if (deny) {
    return {
      allowed: false,
      reason: `blocked by deny rule: deny["${deny.cwdPattern}"] pattern ${
        formatPattern(deny.commandPattern)
      }`,
    };
  }

  return { allowed: true };
}

/**
 * When a command is denied, check if a prefix of the argv matches an existing
 * exact pattern (no trailing *). If so, suggest the * variant.
 */
function findHint(argv: string[], rules: Rules): string | undefined {
  const allPatterns: Pattern[] = Object.values(rules.allow).flat();

  for (const pattern of allPatterns) {
    const tokens = toArrayPattern(pattern);
    // Only consider exact patterns (no trailing *)
    if (tokens.length > 0 && tokens[tokens.length - 1] === "*") continue;

    // Check if this exact pattern matches a prefix of argv
    if (tokens.length < argv.length && tokens.length > 0) {
      let prefixMatches = true;
      for (let i = 0; i < tokens.length; i++) {
        if (!matchToken(tokens[i], argv[i])) {
          prefixMatches = false;
          break;
        }
      }
      if (prefixMatches) {
        const patStr = typeof pattern === "string"
          ? pattern
          : tokens.map((t) => Array.isArray(t) ? `[${t.join(",")}]` : t).join(
            " ",
          );
        return `"${patStr}" is allowed but does not permit extra arguments. To allow "${patStr}" with any arguments, use "${patStr} *" instead.`;
      }
    }
  }

  return undefined;
}
