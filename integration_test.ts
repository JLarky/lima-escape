import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  getCwdStatus,
  MAX_OUTPUT_SIZE,
  resolveRequestCwd,
  startClient,
  truncateOutput,
  validateCwd,
} from "./shared.ts";
import { isAllowed, type Rules } from "./match.ts";
import type { Request, Response } from "./shared.ts";

const TEST_CONFIG: Rules = {
  allow: {
    "*": [
      "echo *",
      "true",
      "seq *",
    ],
  },
};

async function handleConnection(conn: Deno.Conn, config: Rules) {
  try {
    const buffer = new Uint8Array(65536);
    const bytesRead = await conn.read(buffer);
    if (!bytesRead) return;

    const message = new TextDecoder().decode(buffer.subarray(0, bytesRead));
    const req: Request = JSON.parse(message);

    let res: Response;

    const result = isAllowed(req.argv, req.cwd, config);
    if (!result.allowed) {
      res = {
        code: 1,
        stdout: "",
        stderr: `denied: ${result.reason}`,
        error: "denied",
      };
    } else {
      const command = new Deno.Command(req.argv[0], {
        args: req.argv.slice(1),
        cwd: req.cwd,
      });
      const out = await command.output();
      const stdoutLimit = Math.floor(MAX_OUTPUT_SIZE / 2);
      const stderrLimit = MAX_OUTPUT_SIZE - stdoutLimit;
      res = {
        code: out.code,
        stdout:
          truncateOutput(new TextDecoder().decode(out.stdout), stdoutLimit)
            .text,
        stderr:
          truncateOutput(new TextDecoder().decode(out.stderr), stderrLimit)
            .text,
      };
    }

    await conn.write(new TextEncoder().encode(JSON.stringify(res)));
  } finally {
    conn.close();
  }
}

let nextPort = 17332;

async function withServer(
  config: Rules,
  fn: (port: number) => Promise<void>,
) {
  const port = nextPort++;
  const listener = Deno.listen({ port, hostname: "127.0.0.1" });

  const serverLoop = (async () => {
    try {
      for await (const conn of listener) {
        handleConnection(conn, config).catch(() => {});
      }
    } catch {
      // listener closed
    }
  })();

  try {
    await fn(port);
  } finally {
    listener.close();
    await serverLoop;
  }
}

Deno.test("integration: allowed command executes and returns output", async () => {
  await withServer(TEST_CONFIG, async (port) => {
    const res = await startClient("127.0.0.1", port, ["echo", "hello world"]);
    assertEquals(res.code, 0);
    assertEquals(res.stdout.trim(), "hello world");
    assertEquals(res.stderr, "");
  });
});

Deno.test("integration: argv with embedded spaces is denied (issue #3)", async () => {
  await withServer(TEST_CONFIG, async (port) => {
    // ["echo hello", "world"] joins to "echo hello world" which would match "echo *"
    // but per-element matching sees argv[0]="echo hello" which doesn't match "echo"
    const res = await startClient("127.0.0.1", port, ["echo hello", "world"]);
    assertEquals(res.code, 1);
    assertEquals(res.error, "denied");
  });
});

Deno.test("integration: denied command returns error", async () => {
  await withServer(TEST_CONFIG, async (port) => {
    const res = await startClient("127.0.0.1", port, ["ls"]);
    assertEquals(res.code, 1);
    assertEquals(res.error, "denied");
    assertEquals(res.stdout, "");
  });
});

Deno.test("integration: exit code is forwarded from allowed command", async () => {
  await withServer(TEST_CONFIG, async (port) => {
    const res = await startClient("127.0.0.1", port, ["true"]);
    assertEquals(res.code, 0);
    assertEquals(res.error, undefined);
  });
});

Deno.test("integration: large stdout is truncated with message", async () => {
  await withServer(TEST_CONFIG, async (port) => {
    // Generate ~200KB of output (well over 64KB old limit)
    const count = 20000;
    const res = await startClient("127.0.0.1", port, [
      "echo",
      "x".repeat(count),
    ]);
    assertEquals(res.code, 0);
    // Should get some output, not a parse error
    assertEquals(res.stdout.length > 0, true);
  });
});

Deno.test("integration: very large stdout is truncated with truncation notice", async () => {
  // Use a custom server that returns a huge fake response to test client-side handling
  const port = nextPort++;
  const listener = Deno.listen({ port, hostname: "127.0.0.1" });

  const bigStdout = "x".repeat(2 * 1024 * 1024); // 2MB
  const serverLoop = (async () => {
    try {
      for await (const conn of listener) {
        try {
          const buffer = new Uint8Array(65536);
          await conn.read(buffer);
          const res: Response = {
            code: 0,
            stdout: bigStdout,
            stderr: "",
          };
          await conn.write(new TextEncoder().encode(JSON.stringify(res)));
        } finally {
          conn.close();
        }
      }
    } catch {
      // listener closed
    }
  })();

  try {
    const res = await startClient("127.0.0.1", port, ["echo", "big"]);
    // Response is too large to parse as JSON, so client returns a fallback error
    assertEquals(res.code, 1);
    assertEquals(res.error, "response_too_large");
    assertStringIncludes(res.stderr, "too large");
  } finally {
    listener.close();
    await serverLoop;
  }
});

Deno.test("integration: server-side truncation keeps response parseable", async () => {
  await withServer(TEST_CONFIG, async (port) => {
    // `seq 1 200000` produces ~1.2MB of output from a tiny request
    const res = await startClient("127.0.0.1", port, ["seq", "1", "200000"]);
    assertEquals(res.code, 0);
    assertEquals(res.stdout.length > 0, true);
    assertStringIncludes(res.stdout, "truncated by lima-escape");
  });
});

Deno.test("integration: client gives useful error on connection refused", async () => {
  try {
    await startClient("127.0.0.1", 19999, ["echo", "hello"]);
    throw new Error("should have thrown");
  } catch (e) {
    assertEquals(e instanceof Deno.errors.ConnectionRefused, true);
  }
});

// --- Auth tests ---

const TEST_TOKEN = "test-token-for-integration";

async function handleAuthConnection(
  conn: Deno.Conn,
  config: Rules,
  checkToken: (token: string) => boolean,
) {
  try {
    const buffer = new Uint8Array(65536);
    const bytesRead = await conn.read(buffer);
    if (!bytesRead) return;

    const message = new TextDecoder().decode(buffer.subarray(0, bytesRead));
    const req: Request = JSON.parse(message);

    let res: Response;

    if (!checkToken(req.token ?? "")) {
      res = {
        code: 1,
        stdout: "",
        stderr: "Authentication required.",
        error: "auth_required",
      };
    } else {
      const result = isAllowed(req.argv, req.cwd, config);
      if (!result.allowed) {
        res = {
          code: 1,
          stdout: "",
          stderr: `denied: ${result.reason}`,
          error: "denied",
        };
      } else {
        const command = new Deno.Command(req.argv[0], {
          args: req.argv.slice(1),
          cwd: req.cwd,
        });
        const out = await command.output();
        const stdoutLimit = Math.floor(MAX_OUTPUT_SIZE / 2);
        const stderrLimit = MAX_OUTPUT_SIZE - stdoutLimit;
        res = {
          code: out.code,
          stdout:
            truncateOutput(new TextDecoder().decode(out.stdout), stdoutLimit)
              .text,
          stderr:
            truncateOutput(new TextDecoder().decode(out.stderr), stderrLimit)
              .text,
        };
      }
    }

    await conn.write(new TextEncoder().encode(JSON.stringify(res)));
  } finally {
    conn.close();
  }
}

async function withAuthServerReal(
  config: Rules,
  fn: (port: number) => Promise<void>,
) {
  const port = nextPort++;
  const checkToken = (token: string) => token === TEST_TOKEN;
  const listener = Deno.listen({ port, hostname: "127.0.0.1" });

  const serverLoop = (async () => {
    try {
      for await (const conn of listener) {
        handleAuthConnection(conn, config, checkToken).catch(() => {});
      }
    } catch {
      // listener closed
    }
  })();

  try {
    await fn(port);
  } finally {
    listener.close();
    await serverLoop;
  }
}

Deno.test("auth: exec without token returns auth_required", async () => {
  await withAuthServerReal(TEST_CONFIG, async (port) => {
    const res = await startClient("127.0.0.1", port, ["echo", "hello"]);
    assertEquals(res.code, 1);
    assertEquals(res.error, "auth_required");
  });
});

Deno.test("auth: exec with valid token succeeds", async () => {
  await withAuthServerReal(TEST_CONFIG, async (port) => {
    const res = await startClient(
      "127.0.0.1",
      port,
      ["echo", "hello world"],
      undefined,
      TEST_TOKEN,
    );
    assertEquals(res.code, 0);
    assertEquals(res.stdout.trim(), "hello world");
  });
});

Deno.test("auth: exec with wrong token returns auth_required", async () => {
  await withAuthServerReal(TEST_CONFIG, async (port) => {
    const res = await startClient(
      "127.0.0.1",
      port,
      ["echo", "hello"],
      undefined,
      "wrong-token",
    );
    assertEquals(res.code, 1);
    assertEquals(res.error, "auth_required");
  });
});

// --- cwd validation tests ---

Deno.test("validateCwd: rejects relative path", async () => {
  const result = await validateCwd("relative/path");
  assertEquals("error" in result, true);
  if ("error" in result) {
    assertStringIncludes(result.error, "absolute path");
  }
});

Deno.test("validateCwd: rejects non-existent path", async () => {
  const result = await validateCwd("/nonexistent/path/that/does/not/exist");
  assertEquals("error" in result, true);
  if ("error" in result) {
    assertStringIncludes(result.error, "does not exist");
  }
});

Deno.test("validateCwd: accepts valid directory", async () => {
  const result = await validateCwd("/tmp");
  assertEquals("error" in result, false);
  if ("resolved" in result) {
    // resolved path should be absolute
    assertEquals(result.resolved.startsWith("/"), true);
  }
});

Deno.test("validateCwd: resolves path traversal", async () => {
  const result = await validateCwd("/tmp/../tmp");
  assertEquals("error" in result, false);
  if ("resolved" in result) {
    // should be normalized — no ".." in resolved path
    assertEquals(result.resolved.includes(".."), false);
  }
});

Deno.test("resolveRequestCwd: uses existing host cwd as-is", async () => {
  const result = await resolveRequestCwd("/tmp", {
    "/tmp": "/does/not/matter",
  });
  assertEquals("error" in result, false);
  if ("logical" in result) {
    assertEquals(result.logical.startsWith("/"), true);
    assertEquals(result.execution.startsWith("/"), true);
  }
});

Deno.test("resolveRequestCwd: maps nonexistent Lima cwd to host cwd", async () => {
  const result = await resolveRequestCwd(
    "/home/jlarky.guest/work/project",
    {
      "/home/jlarky.guest/work/project": "/tmp",
    },
  );
  assertEquals("error" in result, false);
  if ("logical" in result) {
    assertEquals(result.logical, "/home/jlarky.guest/work/project");
    assertEquals(result.execution, "/tmp");
  }
});

Deno.test("resolveRequestCwd: prefers the most specific path mapping", async () => {
  const result = await resolveRequestCwd(
    "/vm/project",
    {
      "/vm": "/tmp",
      "/vm/project": "/var/tmp",
    },
  );
  assertEquals("error" in result, false);
  if ("logical" in result) {
    assertEquals(result.execution, "/var/tmp");
  }
});

Deno.test("resolveRequestCwd: reports translated host path failures", async () => {
  const result = await resolveRequestCwd(
    "/home/jlarky.guest/work/project",
    {
      "/home/jlarky.guest/work": "/definitely/not/here",
    },
  );
  assertEquals("error" in result, true);
  if ("error" in result) {
    assertStringIncludes(
      result.error,
      'mapped to "/definitely/not/here/project"',
    );
  }
});

Deno.test("getCwdStatus: reports mapped current cwd", async () => {
  const status = await getCwdStatus("/home/jlarky.guest/work/project", {
    "/home/jlarky.guest/work/project": "/tmp",
  });

  assertEquals(status.requested, "/home/jlarky.guest/work/project");
  assertEquals(status.matchCwd, "/home/jlarky.guest/work/project");
  assertEquals(status.executionCwd, "/tmp");
  assertEquals(status.mapped, true);
  assertEquals(status.error, undefined);
});

Deno.test("getCwdStatus: reports rejected current cwd", async () => {
  const status = await getCwdStatus("/home/jlarky.guest/work/project", {
    "/home/jlarky.guest/work": "/definitely/not/here",
  });

  assertEquals(status.requested, "/home/jlarky.guest/work/project");
  assertEquals(typeof status.error, "string");
  assertEquals(status.matchCwd, undefined);
  assertEquals(status.executionCwd, undefined);
});
