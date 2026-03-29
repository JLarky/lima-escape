import { assertEquals } from "@std/assert";
import { fnmatch, isAllowed } from "./fnmatch.ts";

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

const ALLOWLIST = [
  "gh pr view *",
  "gh pr list *",
  "git status",
  "git log *",
];

Deno.test("allowlist: permits gh pr view with args", () => {
  assertEquals(isAllowed(["gh", "pr", "view", "123"], ALLOWLIST), true);
});

Deno.test("allowlist: permits git status exact", () => {
  assertEquals(isAllowed(["git", "status"], ALLOWLIST), true);
});

Deno.test("allowlist: blocks gh pr create", () => {
  assertEquals(isAllowed(["gh", "pr", "create"], ALLOWLIST), false);
});

Deno.test("allowlist: blocks git push", () => {
  assertEquals(isAllowed(["git", "push"], ALLOWLIST), false);
});

Deno.test("allowlist: blocks git status with extra args", () => {
  assertEquals(isAllowed(["git", "status", "--short"], ALLOWLIST), false);
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
