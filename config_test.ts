import { assertEquals, assertThrows } from "@std/assert";
import { loadConfig } from "./config.ts";

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
