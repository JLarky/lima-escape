import { assertEquals, assertThrows } from "@std/assert";
import { loadConfig } from "./config.ts";
import { formatStatusConfigSection } from "./main.ts";
import type { Pattern } from "./match.ts";
import {
  type StatusConfig,
  statusConfigFromOptions,
  type StatusInfo,
} from "./shared.ts";

function writeTempConfig(config: unknown): string {
  const path = Deno.makeTempFileSync({ suffix: ".json" });
  Deno.writeTextFileSync(path, JSON.stringify(config));
  return path;
}

function withTempConfig(config: unknown, fn: (path: string) => void): void {
  const path = writeTempConfig(config);
  try {
    fn(path);
  } finally {
    Deno.removeSync(path);
  }
}

// --- valid configs ---

Deno.test("loadConfig: accepts minimal valid config", () => {
  withTempConfig({ allow: { "*": ["git status"] } }, (path) => {
    const config = loadConfig(path);
    assertEquals(config.allow, { "*": ["git status"] });
  });
});

Deno.test("loadConfig: accepts valid pathMap", () => {
  withTempConfig(
    {
      pathMap: { "/home/jlarky.guest/work": "/Users/jlarky/work" },
      allow: { "*": ["git status"] },
    },
    (path) => {
      const config = loadConfig(path);
      assertEquals(config.pathMap, {
        "/home/jlarky.guest/work": "/Users/jlarky/work",
      });
    },
  );
});

Deno.test("loadConfig: accepts array-form patterns", () => {
  withTempConfig(
    { allow: { "*": [["git", ["status", "log"]]] } },
    (path) => {
      const config = loadConfig(path);
      assertEquals(config.allow["*"], [["git", ["status", "log"]]]);
    },
  );
});

Deno.test("loadConfig: accepts regexp token patterns", () => {
  withTempConfig(
    {
      allow: {
        "*": [["gh", "api", {
          regexp:
            "^repos/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/pulls/[0-9]+/(comments|reviews|review_comments)$",
        }]],
      },
    },
    (path) => {
      const config = loadConfig(path);
      assertEquals(config.allow["*"], [[
        "gh",
        "api",
        {
          regexp:
            "^repos/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/pulls/[0-9]+/(comments|reviews|review_comments)$",
        },
      ]]);
    },
  );
});

// --- missing / wrong-type top-level fields ---

Deno.test("loadConfig: error names the field when allow is missing", () => {
  withTempConfig({}, (path) => {
    assertThrows(() => loadConfig(path), Error, 'at "allow"');
  });
});

Deno.test("loadConfig: error names the field when allow is not an object", () => {
  withTempConfig({ allow: "git status" }, (path) => {
    assertThrows(() => loadConfig(path), Error, 'at "allow"');
  });
});

Deno.test("loadConfig: error names the field when allow value is not an array", () => {
  withTempConfig({ allow: { "*": "git status" } }, (path) => {
    assertThrows(() => loadConfig(path), Error, 'at "allow.*"');
  });
});

Deno.test("loadConfig: error names the field when deny is not an object", () => {
  withTempConfig({ allow: { "*": ["git status"] }, deny: 42 }, (path) => {
    assertThrows(() => loadConfig(path), Error, 'at "deny"');
  });
});

Deno.test("loadConfig: error names regexp token field when regexp is invalid", () => {
  withTempConfig(
    { allow: { "*": [["gh", "api", { regexp: "^(" }]] } },
    (path) => {
      assertThrows(() => loadConfig(path), Error, 'at "allow.*.0.2"');
    },
  );
});

Deno.test("loadConfig: error names the field when tokens is not an array", () => {
  withTempConfig(
    { allow: { "*": ["git status"] }, tokens: "abc" },
    (path) => {
      assertThrows(() => loadConfig(path), Error, 'at "tokens"');
    },
  );
});

Deno.test("loadConfig: error names the index when tokens contains a non-string", () => {
  withTempConfig(
    { allow: { "*": ["git status"] }, tokens: [123] },
    (path) => {
      assertThrows(() => loadConfig(path), Error, 'at "tokens.0"');
    },
  );
});

// --- pathMap validation ---

Deno.test("loadConfig: rejects relative pathMap keys", () => {
  withTempConfig(
    {
      pathMap: { "home/jlarky.guest/work": "/Users/jlarky/work" },
      allow: { "*": ["git status"] },
    },
    (path) => {
      assertThrows(() => loadConfig(path), Error, "must be an absolute path");
    },
  );
});

Deno.test("loadConfig: rejects relative pathMap values", () => {
  withTempConfig(
    {
      pathMap: { "/home/jlarky.guest/work": "Users/jlarky/work" },
      allow: { "*": ["git status"] },
    },
    (path) => {
      assertThrows(
        () => loadConfig(path),
        Error,
        "must map to an absolute host path string",
      );
    },
  );
});

Deno.test("loadConfig: error includes pathMap key name for relative key", () => {
  withTempConfig(
    {
      pathMap: { "home/jlarky.guest/work": "/Users/jlarky/work" },
      allow: { "*": ["git status"] },
    },
    (path) => {
      assertThrows(
        () => loadConfig(path),
        Error,
        'at "pathMap.home/jlarky.guest/work"',
      );
    },
  );
});

// --- status config snapshot (public, no secrets) ---

const REGEXP_PATTERN: Pattern = [
  "gh",
  "api",
  {
    regexp:
      "^repos/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/pulls/[0-9]+/(comments|reviews|review_comments)$",
  },
];

Deno.test("statusConfigFromOptions: returns sanitized config without inventing fields", () => {
  const config = statusConfigFromOptions({
    allow: { "*": ["git status"] },
    deny: { "/sensitive": ["git *"] },
    pathMap: { "/vm": "/host" },
  });
  assertEquals(config, {
    allow: { "*": ["git status"] },
    deny: { "/sensitive": ["git *"] },
    pathMap: { "/vm": "/host" },
  });
  assertEquals("tokens" in config, false);
});

Deno.test("statusConfigFromOptions: prefers explicit config and never leaks tokens", () => {
  const secret = "super-secret-token-value";
  // Runtime object may carry tokens despite StatusConfig (TS-only) typing.
  const tainted = {
    tokens: [secret],
    allow: { "*": [REGEXP_PATTERN] },
    deny: { "*": ["git push -f"] },
    pathMap: { "/vm": "/host" },
  } as unknown as StatusConfig;
  const config = statusConfigFromOptions({
    allow: { "*": ["git status"] },
    config: tainted,
  });
  assertEquals(config, {
    allow: { "*": [REGEXP_PATTERN] },
    deny: { "*": ["git push -f"] },
    pathMap: { "/vm": "/host" },
  });
  assertEquals("tokens" in config, false);
  const json = JSON.stringify(config);
  assertEquals(json.includes("tokens"), false);
  assertEquals(json.includes(secret), false);
});

Deno.test("statusConfigFromOptions: preserves regexp tokens verbatim", () => {
  const config = statusConfigFromOptions({
    allow: { "*": [REGEXP_PATTERN] },
  });
  assertEquals(config.allow["*"][0], REGEXP_PATTERN);
  assertEquals(
    JSON.stringify(config.allow["*"][0]),
    JSON.stringify(REGEXP_PATTERN),
  );
});

Deno.test("formatStatusConfigSection: prints config JSON verbatim when present", () => {
  const status: StatusInfo = {
    allow: { "*": [REGEXP_PATTERN] },
    config: { allow: { "*": [REGEXP_PATTERN] } },
    allowRun: { gh: "granted" },
  };
  const out = formatStatusConfigSection(status);
  assertEquals(out.startsWith("Config:\n"), true);
  assertEquals(
    out.includes(
      '"regexp": "^repos/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/pulls/[0-9]+/(comments|reviews|review_comments)$"',
    ),
    true,
  );
  assertEquals(out.includes("[object Object]"), false);
  assertEquals(out.includes("Allowed patterns:"), false);
});

Deno.test("formatStatusConfigSection: falls back to pretty-print when config missing", () => {
  const status: StatusInfo = {
    allow: { "*": ["git status", REGEXP_PATTERN] },
    deny: { "/sensitive": ["git *"] },
    pathMap: { "/vm": "/host" },
    allowRun: { git: "granted" },
  };
  const out = formatStatusConfigSection(status);
  assertEquals(out.includes("Allowed patterns:"), true);
  assertEquals(out.includes("Denied patterns:"), true);
  assertEquals(out.includes("Path mappings:"), true);
  assertEquals(out.includes("git status"), true);
  assertEquals(out.includes("/vm -> /host"), true);
  // Fallback still JSON-stringifies structured patterns (no [object Object]).
  assertEquals(out.includes(JSON.stringify(REGEXP_PATTERN)), true);
  assertEquals(out.includes("Config:"), false);
});
