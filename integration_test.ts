import { assertEquals } from "@std/assert";
import { startClient } from "./shared.ts";
import { isAllowed } from "./fnmatch.ts";
import type { Request, Response } from "./shared.ts";

const TEST_CONFIG = {
  allow: [
    "echo *",
    "true",
  ],
};

async function handleConnection(conn: Deno.Conn, config: { allow: string[] }) {
  try {
    const buffer = new Uint8Array(65536);
    const bytesRead = await conn.read(buffer);
    if (!bytesRead) return;

    const message = new TextDecoder().decode(buffer.subarray(0, bytesRead));
    const req: Request = JSON.parse(message);

    let res: Response;

    if (!isAllowed(req.argv, config.allow)) {
      res = {
        code: 1,
        stdout: "",
        stderr: `denied: "${
          req.argv.join(" ")
        }" does not match any allowed pattern`,
        error: "denied",
      };
    } else {
      const command = new Deno.Command(req.argv[0], {
        args: req.argv.slice(1),
        cwd: req.cwd,
      });
      const out = await command.output();
      res = {
        code: out.code,
        stdout: new TextDecoder().decode(out.stdout),
        stderr: new TextDecoder().decode(out.stderr),
      };
    }

    await conn.write(new TextEncoder().encode(JSON.stringify(res)));
  } finally {
    conn.close();
  }
}

let nextPort = 17332;

async function withServer(
  config: { allow: string[] },
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
