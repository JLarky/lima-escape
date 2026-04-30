import { assertEquals, assertThrows } from "@std/assert";
import { loadConfig } from "./config.ts";

function writeTempConfig(config: unknown): string {
  const path = Deno.makeTempFileSync({ suffix: ".json" });
  Deno.writeTextFileSync(path, JSON.stringify(config));
  return path;
}

Deno.test("loadConfig: accepts valid pathMap", () => {
  const path = writeTempConfig({
    pathMap: {
      "/home/jlarky.guest/work": "/Users/jlarky/work",
    },
    allow: { "*": ["git status"] },
  });

  try {
    const config = loadConfig(path);
    assertEquals(config.pathMap, {
      "/home/jlarky.guest/work": "/Users/jlarky/work",
    });
  } finally {
    Deno.removeSync(path);
  }
});

Deno.test("loadConfig: rejects relative pathMap keys", () => {
  const path = writeTempConfig({
    pathMap: {
      "home/jlarky.guest/work": "/Users/jlarky/work",
    },
    allow: { "*": ["git status"] },
  });

  try {
    assertThrows(
      () => loadConfig(path),
      Error,
      '"pathMap" key "home/jlarky.guest/work" must be an absolute path',
    );
  } finally {
    Deno.removeSync(path);
  }
});

Deno.test("loadConfig: rejects relative pathMap values", () => {
  const path = writeTempConfig({
    pathMap: {
      "/home/jlarky.guest/work": "Users/jlarky/work",
    },
    allow: { "*": ["git status"] },
  });

  try {
    assertThrows(
      () => loadConfig(path),
      Error,
      "must map to an absolute host path string",
    );
  } finally {
    Deno.removeSync(path);
  }
});
