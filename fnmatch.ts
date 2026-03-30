function libcPath(): string {
  if (Deno.build.os === "darwin") return "/usr/lib/libSystem.B.dylib";
  if (Deno.build.os === "linux") return "/lib/aarch64-linux-gnu/libc.so.6";
  throw new Error(`Unsupported OS: ${Deno.build.os}`);
}

const libc = Deno.dlopen(libcPath(), {
  fnmatch: {
    parameters: ["buffer", "buffer", "i32"],
    result: "i32",
  },
});

const encoder = new TextEncoder();

export function fnmatch(pattern: string, string: string, flags = 0): boolean {
  return libc.symbols.fnmatch(
    encoder.encode(pattern + "\0"),
    encoder.encode(string + "\0"),
    flags,
  ) === 0;
}

export type AllowResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export interface Rules {
  allow: Record<string, string[]>;
  deny?: Record<string, string[]>;
}

/** Specificity of a cwd pattern: more path segments = more specific. "*" = 0. */
export function cwdSpecificity(pattern: string): number {
  if (pattern === "*") return 0;
  return pattern.split("/").filter(Boolean).length;
}

/**
 * Match a command pattern against an argv array element-by-element.
 *
 * The pattern is split by spaces into tokens. Each token is matched against the
 * corresponding argv element using fnmatch. A trailing "*" token matches one or
 * more remaining argv elements (preserving the existing behavior where
 * "gh pr view *" requires at least one arg after "view"). Non-trailing tokens
 * must match exactly one argv element each.
 *
 * This prevents argv-join ambiguity (issue #3) where an attacker could embed
 * spaces in argv elements to craft a joined string matching the pattern while
 * executing a different command.
 */
export function matchCommand(pattern: string, argv: string[]): boolean {
  const tokens = pattern.split(" ");
  const lastIdx = tokens.length - 1;

  if (tokens[lastIdx] === "*") {
    // Trailing wildcard: match fixed prefix, then accept 1+ remaining args
    if (argv.length < tokens.length) return false;
    for (let i = 0; i < lastIdx; i++) {
      if (!fnmatch(tokens[i], argv[i])) return false;
    }
    return true;
  }

  // No trailing wildcard: exact element count required
  if (argv.length !== tokens.length) return false;
  for (let i = 0; i < tokens.length; i++) {
    if (!fnmatch(tokens[i], argv[i])) return false;
  }
  return true;
}

export function isAllowed(
  argv: string[],
  cwd: string,
  rules: Rules,
): AllowResult {
  const command = argv.join(" ");

  // Collect all matching rules with their specificity and type
  type Match = {
    type: "allow" | "deny";
    cwdPattern: string;
    commandPattern: string;
    specificity: number;
  };
  const matches: Match[] = [];

  for (const [cwdPattern, patterns] of Object.entries(rules.allow)) {
    if (fnmatch(cwdPattern, cwd)) {
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
      if (fnmatch(cwdPattern, cwd)) {
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
    return {
      allowed: false,
      reason: `"${command}" does not match any allowed pattern`,
    };
  }

  // Most specific cwd wins; deny breaks ties
  const maxSpecificity = Math.max(...matches.map((m) => m.specificity));
  const best = matches.filter((m) => m.specificity === maxSpecificity);

  const deny = best.find((m) => m.type === "deny");
  if (deny) {
    return {
      allowed: false,
      reason:
        `blocked by deny rule: deny["${deny.cwdPattern}"] pattern "${deny.commandPattern}"`,
    };
  }

  return { allowed: true };
}
