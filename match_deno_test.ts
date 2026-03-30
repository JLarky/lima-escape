import { assertEquals } from "@std/assert";
import {
  cwdMatches,
  cwdSpecificity,
  isAllowed,
  matchCommand,
  type Rules,
} from "./match.ts";

// --- String pattern matching ---

Deno.test("matchCommand: exact string match", () => {
  assertEquals(matchCommand("gh pr view", ["gh", "pr", "view"]), true);
});

Deno.test("matchCommand: exact string mismatch", () => {
  assertEquals(matchCommand("gh pr view", ["gh", "pr", "create"]), false);
});

Deno.test("matchCommand: trailing * matches zero extra args", () => {
  assertEquals(matchCommand("gh pr *", ["gh", "pr"]), true);
});

Deno.test("matchCommand: trailing * matches one extra arg", () => {
  assertEquals(matchCommand("gh pr *", ["gh", "pr", "view"]), true);
});

Deno.test("matchCommand: trailing * matches multiple extra args", () => {
  assertEquals(
    matchCommand("gh pr *", ["gh", "pr", "view", "123", "--web"]),
    true,
  );
});

Deno.test("matchCommand: no trailing * rejects extra args", () => {
  assertEquals(matchCommand("git status", ["git", "status", "--short"]), false);
});

Deno.test("matchCommand: trailing * does not match different prefix", () => {
  assertEquals(matchCommand("gh pr *", ["gh", "issue", "view"]), false);
});

Deno.test("matchCommand: empty argv returns false", () => {
  assertEquals(matchCommand("gh pr", []), false);
});

Deno.test("matchCommand: single command exact match", () => {
  assertEquals(matchCommand("true", ["true"]), true);
});

Deno.test("matchCommand: single command with trailing * matches bare command", () => {
  assertEquals(matchCommand("echo *", ["echo"]), true);
});

// --- Array pattern matching ---

Deno.test("matchCommand: array exact match", () => {
  assertEquals(matchCommand(["gh", "pr"], ["gh", "pr"]), true);
});

Deno.test("matchCommand: array with trailing *", () => {
  assertEquals(matchCommand(["gh", "pr", "*"], ["gh", "pr", "view"]), true);
});

Deno.test("matchCommand: array trailing * matches zero extra args", () => {
  assertEquals(matchCommand(["gh", "pr", "*"], ["gh", "pr"]), true);
});

Deno.test("matchCommand: array with alternatives", () => {
  assertEquals(
    matchCommand(["gh", ["pr", "issue"], "view"], ["gh", "pr", "view"]),
    true,
  );
  assertEquals(
    matchCommand(["gh", ["pr", "issue"], "view"], ["gh", "issue", "view"]),
    true,
  );
  assertEquals(
    matchCommand(["gh", ["pr", "issue"], "view"], ["gh", "run", "view"]),
    false,
  );
});

Deno.test("matchCommand: array alternatives with trailing *", () => {
  assertEquals(
    matchCommand(["gh", ["pr", "issue"], "*"], ["gh", "pr", "view", "123"]),
    true,
  );
  assertEquals(
    matchCommand(["gh", ["pr", "issue"], "*"], ["gh", "issue"]),
    true,
  );
});

Deno.test("matchCommand: array exact rejects extra args", () => {
  assertEquals(
    matchCommand(["gh", "pr"], ["gh", "pr", "view"]),
    false,
  );
});

// --- cwdMatches ---

Deno.test("cwdMatches: * matches any cwd", () => {
  assertEquals(cwdMatches("*", "/any/path"), true);
});

Deno.test("cwdMatches: exact match", () => {
  assertEquals(cwdMatches("/home/user/project", "/home/user/project"), true);
});

Deno.test("cwdMatches: prefix match (cwd inside pattern dir)", () => {
  assertEquals(
    cwdMatches("/home/user/project", "/home/user/project/sub/dir"),
    true,
  );
});

Deno.test("cwdMatches: no partial directory match", () => {
  assertEquals(cwdMatches("/home/user", "/home/user2"), false);
});

Deno.test("cwdMatches: different path", () => {
  assertEquals(cwdMatches("/home/user/project", "/home/other"), false);
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

Deno.test("allowlist: permits gh pr view without extra args (zero-or-more)", () => {
  assertEquals(
    isAllowed(["gh", "pr", "view"], "/any", RULES).allowed,
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

Deno.test("cwd: allows git push in subdirectory (prefix match)", () => {
  assertEquals(
    isAllowed(["git", "push", "origin"], "/home/user/project/sub", CWD_RULES)
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

Deno.test("deny: blocks git in denied subdir (prefix match)", () => {
  const result = isAllowed(
    ["git", "status"],
    "/sensitive/sub",
    DENY_RULES,
  );
  assertEquals(result.allowed, false);
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

Deno.test("specificity: specific allow overrides global deny", () => {
  const rules: Rules = {
    allow: {
      "*": ["git push *"],
      "/home/user/full-vibes": ["git push -f", "git push *"],
    },
    deny: {
      "*": ["git push -f"],
    },
  };
  assertEquals(
    isAllowed(["git", "push", "-f"], "/home/user/full-vibes", rules).allowed,
    true,
  );
  assertEquals(
    isAllowed(["git", "push", "-f"], "/other", rules).allowed,
    false,
  );
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
  assertEquals(
    isAllowed(["git", "status"], "/home/user/prod-infra", rules).allowed,
    false,
  );
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
  assertEquals(
    isAllowed(["git", "push", "origin"], "/home/user/project/sub", rules)
      .allowed,
    true,
  );
  assertEquals(
    isAllowed(["git", "push", "origin"], "/home/user/project", rules).allowed,
    false,
  );
});

// --- Array patterns in rules ---

Deno.test("allowlist: array pattern with alternatives", () => {
  const rules: Rules = {
    allow: {
      "*": [["gh", ["pr", "issue"], "view", "*"]],
    },
  };
  assertEquals(
    isAllowed(["gh", "pr", "view", "123"], "/any", rules).allowed,
    true,
  );
  assertEquals(
    isAllowed(["gh", "issue", "view", "456"], "/any", rules).allowed,
    true,
  );
  assertEquals(
    isAllowed(["gh", "run", "view", "789"], "/any", rules).allowed,
    false,
  );
});

Deno.test("allowlist: mixed string and array patterns", () => {
  const rules: Rules = {
    allow: {
      "*": ["git status", ["gh", ["pr", "issue"], "*"]],
    },
  };
  assertEquals(isAllowed(["git", "status"], "/any", rules).allowed, true);
  assertEquals(
    isAllowed(["gh", "pr", "view"], "/any", rules).allowed,
    true,
  );
  assertEquals(
    isAllowed(["gh", "issue"], "/any", rules).allowed,
    true,
  );
});

// --- Hint system ---

Deno.test("hint: suggests * when exact pattern matches prefix", () => {
  const rules: Rules = {
    allow: { "*": ["git status"] },
  };
  const result = isAllowed(["git", "status", "--short"], "/any", rules);
  assertEquals(result.allowed, false);
  if (!result.allowed) {
    assertEquals(typeof result.hint, "string");
    assertEquals(result.hint!.includes("git status"), true);
    assertEquals(result.hint!.includes("*"), true);
  }
});

Deno.test("hint: no hint when no prefix matches", () => {
  const rules: Rules = {
    allow: { "*": ["git status"] },
  };
  const result = isAllowed(["git", "push"], "/any", rules);
  assertEquals(result.allowed, false);
  if (!result.allowed) {
    assertEquals(result.hint, undefined);
  }
});

// --- Argv-join ambiguity (issue #3) ---

Deno.test("argv-ambiguity: space in argv element cannot spoof pattern match", () => {
  const rules: Rules = { allow: { "*": ["gh pr view *"] } };
  assertEquals(
    isAllowed(["gh", "pr view", "123"], "/any", rules).allowed,
    false,
  );
});

Deno.test("argv-ambiguity: space in command name cannot spoof pattern", () => {
  const rules: Rules = { allow: { "*": ["gh pr view *"] } };
  assertEquals(
    isAllowed(["gh pr", "view", "123"], "/any", rules).allowed,
    false,
  );
});

Deno.test("argv-ambiguity: single-element argv cannot match multi-word pattern", () => {
  const rules: Rules = { allow: { "*": ["git status"] } };
  assertEquals(isAllowed(["git status"], "/any", rules).allowed, false);
});

Deno.test("argv-ambiguity: quoted arg with space still works with wildcard", () => {
  const rules: Rules = { allow: { "*": ["echo *"] } };
  assertEquals(
    isAllowed(["echo", "hello world"], "/any", rules).allowed,
    true,
  );
});

Deno.test("argv-ambiguity: normal argv unaffected", () => {
  const rules: Rules = { allow: { "*": ["gh pr view *"] } };
  assertEquals(
    isAllowed(["gh", "pr", "view", "123"], "/any", rules).allowed,
    true,
  );
});

Deno.test("argv-ambiguity: multiple trailing args still match trailing wildcard", () => {
  const rules: Rules = { allow: { "*": ["gh pr view *"] } };
  assertEquals(
    isAllowed(["gh", "pr", "view", "123", "--web"], "/any", rules).allowed,
    true,
  );
});

Deno.test("argv-ambiguity: exact match requires exact element count", () => {
  const rules: Rules = { allow: { "*": ["git status"] } };
  assertEquals(isAllowed(["git", "status"], "/any", rules).allowed, true);
  assertEquals(
    isAllowed(["git", "status", "--short"], "/any", rules).allowed,
    false,
  );
});
