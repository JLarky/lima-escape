import { assertEquals } from "@std/assert";
import { loadConfig } from "./config.ts";

Deno.test("loadConfig parses JSONC with comments", () => {
  const tempDir = Deno.makeTempDirSync();
  const configPath = tempDir + "/config.jsonc";
  const configContent = `{
    // This is a comment
    "allow": {
      "*": ["git status"]
    },
    /* This is a
       multi-line comment */
    "tokens": ["test-token"]
  }`;
  Deno.writeTextFileSync(configPath, configContent);

  const config = loadConfig(configPath);
  assertEquals(config.allow["*"], ["git status"]);
  assertEquals(config.tokens, ["test-token"]);

  Deno.removeSync(tempDir, { recursive: true });
});

Deno.test("loadConfig falls back to .json if .jsonc is missing", () => {
  const home = Deno.makeTempDirSync();
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", home);

  try {
    const configDir = home + "/.config/lima-escape";
    Deno.mkdirSync(configDir, { recursive: true });

    const configPath = configDir + "/config.json";
    const configContent = `{"allow": {"*": ["git status"]}}`;
    Deno.writeTextFileSync(configPath, configContent);

    const config = loadConfig();
    assertEquals(config.allow["*"], ["git status"]);
  } finally {
    if (originalHome) Deno.env.set("HOME", originalHome);
    else Deno.env.delete("HOME");
    Deno.removeSync(home, { recursive: true });
  }
});

Deno.test("loadConfig prefers .jsonc if both exist", () => {
  const home = Deno.makeTempDirSync();
  const originalHome = Deno.env.get("HOME");
  Deno.env.set("HOME", home);

  try {
    const configDir = home + "/.config/lima-escape";
    Deno.mkdirSync(configDir, { recursive: true });

    const jsonPath = configDir + "/config.json";
    Deno.writeTextFileSync(jsonPath, `{"allow": {"*": ["json"]}}`);

    const jsoncPath = configDir + "/config.jsonc";
    Deno.writeTextFileSync(jsoncPath, `{"allow": {"*": ["jsonc"]}}`);

    const config = loadConfig();
    assertEquals(config.allow["*"], ["jsonc"]);
  } finally {
    if (originalHome) Deno.env.set("HOME", originalHome);
    else Deno.env.delete("HOME");
    Deno.removeSync(home, { recursive: true });
  }
});
