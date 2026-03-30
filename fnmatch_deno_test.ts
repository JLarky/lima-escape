import { assertEquals } from "@std/assert";
import { cwdSpecificity, fnmatch, isAllowed, type Rules } from "./fnmatch.ts";

// POSIX fnmatch flags — values are from glibc fnmatch.h
const FNM_PATHNAME = 0x01;

// --- Basic fnmatch behavior ---

Deno.test("fnmatch: exact match", () => {
  assertEquals(fnmatch("gh pr view", "gh pr view"), true);
});

Deno.test("fnmatch: exact mismatch", () => {
  assertEquals(fnmatch("gh pr view", "gh pr create"), false);
});

Deno.test("fnmatch: wildcard matches trailing args", () => {
  assertEquals(fnmatch("gh pr view *", "gh pr view 123"), true);
});

Deno.test("fnmatch: wildcard matches multiple trailing args", () => {
  assertEquals(fnmatch("gh pr view *", "gh pr view 123 --web"), true);
});

Deno.test("fnmatch: wildcard does NOT match no args (space required)", () => {
  assertEquals(fnmatch("gh pr view *", "gh pr view"), false);
});

Deno.test("fnmatch: pattern without wildcard rejects extra args", () => {
  assertEquals(fnmatch("gh pr view", "gh pr view 123"), false);
});

Deno.test("fnmatch: wildcard does not match different subcommand", () => {
  assertEquals(fnmatch("gh pr view *", "gh pr create 123"), false);
});

// --- Allowlist integration ---

const RULES: Rules = {
  allow: {
    "*": [
      "gh pr view *",
      "gh pr list *",
      "git status",
      "git log *",
    ],
  },
};

Deno.test("allowlist: permits gh pr view with args", () => {
  assertEquals(
    isAllowed(["gh", "pr", "view", "123"], "/any", RULES).allowed,
    true,
  );
});

Deno.test("allowlist: permits git status exact", () => {
  assertEquals(isAllowed(["git", "status"], "/any", RULES).allowed, true);
});

Deno.test("allowlist: blocks gh pr create", () => {
  assertEquals(isAllowed(["gh", "pr", "create"], "/any", RULES).allowed, false);
});

Deno.test("allowlist: blocks git push", () => {
  assertEquals(isAllowed(["git", "push"], "/any", RULES).allowed, false);
});

Deno.test("allowlist: blocks git status with extra args", () => {
  assertEquals(
    isAllowed(["git", "status", "--short"], "/any", RULES).allowed,
    false,
  );
});

// --- CWD-scoped rules ---

const CWD_RULES: Rules = {
  allow: {
    "*": ["git status"],
    "/home/user/project": ["git push *"],
  },
};

Deno.test("cwd: allows git push in matching dir", () => {
  assertEquals(
    isAllowed(["git", "push", "origin"], "/home/user/project", CWD_RULES)
      .allowed,
    true,
  );
});

Deno.test("cwd: blocks git push in other dir", () => {
  assertEquals(
    isAllowed(["git", "push", "origin"], "/home/other", CWD_RULES).allowed,
    false,
  );
});

Deno.test("cwd: wildcard allows git status anywhere", () => {
  assertEquals(
    isAllowed(["git", "status"], "/any/path", CWD_RULES).allowed,
    true,
  );
});

// --- Deny rules ---

const DENY_RULES: Rules = {
  allow: {
    "*": ["git *"],
  },
  deny: {
    "/sensitive": ["git *"],
  },
};

Deno.test("deny: blocks git in denied dir", () => {
  const result = isAllowed(["git", "status"], "/sensitive", DENY_RULES);
  assertEquals(result.allowed, false);
  assertEquals(
    result.allowed === false && result.reason.includes("deny rule"),
    true,
  );
});

Deno.test("deny: allows git in other dir", () => {
  assertEquals(isAllowed(["git", "status"], "/safe", DENY_RULES).allowed, true);
});

// --- Specificity ---

Deno.test("specificity: * is 0", () => {
  assertEquals(cwdSpecificity("*"), 0);
});

Deno.test("specificity: /home is 1", () => {
  assertEquals(cwdSpecificity("/home"), 1);
});

Deno.test("specificity: /home/user/project is 3", () => {
  assertEquals(cwdSpecificity("/home/user/project"), 3);
});

// --- Specificity: more specific allow overrides less specific deny ---

Deno.test("specificity: specific allow overrides global deny", () => {
  // README example: git push -f denied globally, but allowed in full-vibes
  const rules: Rules = {
    allow: {
      "*": ["git push *"],
      "/home/user/full-vibes": ["git push -f", "git push *"],
    },
    deny: {
      "*": ["git push -f"],
    },
  };
  // In full-vibes: specific allow (specificity 3) beats global deny (specificity 0)
  assertEquals(
    isAllowed(["git", "push", "-f"], "/home/user/full-vibes", rules).allowed,
    true,
  );
  // Elsewhere: global deny matches at same specificity as global allow, deny wins
  assertEquals(
    isAllowed(["git", "push", "-f"], "/other", rules).allowed,
    false,
  );
  // Regular push still works everywhere
  assertEquals(
    isAllowed(["git", "push", "origin"], "/other", rules).allowed,
    true,
  );
});

Deno.test("specificity: specific deny overrides global allow", () => {
  const rules: Rules = {
    allow: { "*": ["git *"] },
    deny: { "/home/user/prod-infra": ["git *"] },
  };
  // In prod-infra: specific deny (specificity 3) beats global allow (specificity 0)
  assertEquals(
    isAllowed(["git", "status"], "/home/user/prod-infra", rules).allowed,
    false,
  );
  // Elsewhere: global allow works
  assertEquals(isAllowed(["git", "status"], "/other", rules).allowed, true);
});

Deno.test("specificity: equal specificity, deny wins", () => {
  const rules: Rules = {
    allow: { "/project": ["git push *"] },
    deny: { "/project": ["git push *"] },
  };
  assertEquals(
    isAllowed(["git", "push", "origin"], "/project", rules).allowed,
    false,
  );
});

Deno.test("specificity: deeper path is more specific", () => {
  const rules: Rules = {
    allow: { "/home/user/project/sub": ["git push *"] },
    deny: { "/home/user/project": ["git push *"] },
  };
  // sub is more specific (4 segments) than project (3 segments), allow wins
  assertEquals(
    isAllowed(["git", "push", "origin"], "/home/user/project/sub", rules)
      .allowed,
    true,
  );
  // In /home/user/project itself, deny applies
  assertEquals(
    isAllowed(["git", "push", "origin"], "/home/user/project", rules).allowed,
    false,
  );
});

// --- Security edge cases ---

Deno.test("security: * matches semicolons (fnmatch does NOT block injection)", () => {
  assertEquals(fnmatch("gh pr view *", "gh pr view 123; rm -rf /"), true);
});

Deno.test("security: * matches pipes", () => {
  assertEquals(fnmatch("gh pr view *", "gh pr view 123 | rm -rf /"), true);
});

Deno.test("security: * matches newlines", () => {
  assertEquals(fnmatch("gh pr view *", "gh pr view 123\nrm -rf /"), true);
});

Deno.test("security: null byte in pattern truncates at C boundary", () => {
  assertEquals(fnmatch("gh\0 pr view *", "gh"), true);
});

// --- FNM_PATHNAME: * stops matching at / ---

Deno.test("security: FNM_PATHNAME prevents * from matching /", () => {
  assertEquals(
    fnmatch("gh pr view *", "gh pr view /etc/passwd", FNM_PATHNAME),
    false,
  );
});

Deno.test("security: FNM_PATHNAME still allows args without /", () => {
  assertEquals(fnmatch("gh pr view *", "gh pr view 123", FNM_PATHNAME), true);
});

// --- Argv-join ambiguity (issue #3) ---
// argv.join(" ") erases argument boundaries. An attacker controlling the argv
// array can embed spaces in individual elements to craft a joined string that
// matches allowlist patterns while executing a different command.

Deno.test("argv-ambiguity: space in argv element cannot spoof pattern match", () => {
  // ["gh", "pr view", "123"] joins to "gh pr view 123" which matches "gh pr view *"
  // but actually executes: gh "pr view" "123" — different from gh pr view 123
  const rules: Rules = { allow: { "*": ["gh pr view *"] } };
  assertEquals(
    isAllowed(["gh", "pr view", "123"], "/any", rules).allowed,
    false,
  );
});

Deno.test("argv-ambiguity: space in command name cannot spoof pattern", () => {
  // ["gh pr", "view", "123"] tries to execute a binary named "gh pr"
  const rules: Rules = { allow: { "*": ["gh pr view *"] } };
  assertEquals(
    isAllowed(["gh pr", "view", "123"], "/any", rules).allowed,
    false,
  );
});

Deno.test("argv-ambiguity: single-element argv cannot match multi-word pattern", () => {
  // ["git status"] as one element tries to run binary "git status", not git + status
  const rules: Rules = { allow: { "*": ["git status"] } };
  assertEquals(isAllowed(["git status"], "/any", rules).allowed, false);
});

Deno.test("argv-ambiguity: quoted arg with space still works with wildcard", () => {
  // ["echo", "hello world"] is legitimate — shell passes "hello world" as one arg
  const rules: Rules = { allow: { "*": ["echo *"] } };
  assertEquals(
    isAllowed(["echo", "hello world"], "/any", rules).allowed,
    true,
  );
});

Deno.test("argv-ambiguity: normal argv unaffected", () => {
  // ["gh", "pr", "view", "123"] should still match "gh pr view *"
  const rules: Rules = { allow: { "*": ["gh pr view *"] } };
  assertEquals(
    isAllowed(["gh", "pr", "view", "123"], "/any", rules).allowed,
    true,
  );
});

Deno.test("argv-ambiguity: multiple trailing args still match trailing wildcard", () => {
  // ["gh", "pr", "view", "123", "--web"] should match "gh pr view *"
  const rules: Rules = { allow: { "*": ["gh pr view *"] } };
  assertEquals(
    isAllowed(["gh", "pr", "view", "123", "--web"], "/any", rules).allowed,
    true,
  );
});

Deno.test("argv-ambiguity: exact match requires exact element count", () => {
  // "git status" should match ["git", "status"] but not ["git", "status", "--short"]
  const rules: Rules = { allow: { "*": ["git status"] } };
  assertEquals(isAllowed(["git", "status"], "/any", rules).allowed, true);
  assertEquals(
    isAllowed(["git", "status", "--short"], "/any", rules).allowed,
    false,
  );
});

Deno.test("argv-ambiguity: wildcard in middle position matches single element", () => {
  // "gh * --json" should match ["gh", "pr", "--json"] but not ["gh", "pr", "view", "--json"]
  const rules: Rules = { allow: { "*": ["gh * --json"] } };
  assertEquals(
    isAllowed(["gh", "pr", "--json"], "/any", rules).allowed,
    true,
  );
  assertEquals(
    isAllowed(["gh", "pr", "view", "--json"], "/any", rules).allowed,
    false,
  );
});
