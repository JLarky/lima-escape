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
        if (fnmatch(pattern, command)) {
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
          if (fnmatch(pattern, command)) {
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
