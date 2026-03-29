export const DEFAULT_PORT = 27332;

export interface Request {
  type?: "exec" | "status";
  argv: string[];
  cwd: string;
}

export interface StatusInfo {
  allow: string[];
  allowRun: Record<string, string>;
  pid: number;
}

export interface Response {
  code: number;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface ServerOptions {
  allow: string[];
  isAllowed: (argv: string[], allowlist: string[]) => boolean;
  port?: number;
}

async function executeCommand(argv: string[], cwd: string): Promise<Response> {
  const command = new Deno.Command(argv[0], { args: argv.slice(1), cwd });
  const { code, stdout, stderr } = await command.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

export async function startServer(opts: ServerOptions) {
  const port = opts.port ?? DEFAULT_PORT;
  const listener = Deno.listen({ port, hostname: "0.0.0.0" });
  console.log(`lima-escape server listening on port ${port}`);

  Deno.addSignalListener("SIGINT", () => {
    listener.close();
    Deno.exit(0);
  });

  for await (const conn of listener) {
    handleConnection(conn, opts).catch((e) =>
      console.error("connection error:", e)
    );
  }
}

async function handleConnection(conn: Deno.Conn, opts: ServerOptions) {
  try {
    const buffer = new Uint8Array(65536);
    const bytesRead = await conn.read(buffer);
    if (!bytesRead) return;

    const message = new TextDecoder().decode(buffer.subarray(0, bytesRead));
    const req: Request = JSON.parse(message);

    let res: Response;

    if (req.type === "status") {
      const commands = [...new Set(opts.allow.map((p) => p.split(" ")[0]))];
      const allowRun: Record<string, string> = {};
      for (const cmd of commands) {
        try {
          const perm = await Deno.permissions.query({
            name: "run",
            command: cmd,
          } as Deno.PermissionDescriptor);
          allowRun[cmd] = perm.state;
        } catch {
          allowRun[cmd] = "unknown";
        }
      }
      const status: StatusInfo = { allow: opts.allow, allowRun, pid: Deno.pid };
      res = { code: 0, stdout: JSON.stringify(status), stderr: "" };
      console.log("status request from client");
    } else if (!opts.isAllowed(req.argv, opts.allow)) {
      const cmd = req.argv.join(" ");
      res = {
        code: 1,
        stdout: "",
        stderr: `denied: "${cmd}" does not match any allowed pattern`,
        error: "denied",
      };
      console.log("denied:", cmd);
    } else {
      const cmd = req.argv.join(" ");
      console.log("executing:", cmd, "in", req.cwd);
      try {
        res = await executeCommand(req.argv, req.cwd);
      } catch (e) {
        res = {
          code: 1,
          stdout: "",
          stderr: `server error: ${e}`,
          error: "server_error",
        };
        console.error("error:", e);
      }
      console.log("exit code:", res.code);
    }

    await conn.write(new TextEncoder().encode(JSON.stringify(res)));
  } finally {
    conn.close();
  }
}

export async function startClient(
  hostname: string,
  port: number,
  argv: string[],
  type?: "exec" | "status",
): Promise<Response> {
  const conn = await Deno.connect({ hostname, port });

  try {
    const req: Request = { type, argv, cwd: Deno.cwd() };
    await conn.write(new TextEncoder().encode(JSON.stringify(req)));

    const buffer = new Uint8Array(65536);
    const n = await conn.read(buffer);
    if (n === null) {
      throw new Error("Server closed connection without responding");
    }

    return JSON.parse(new TextDecoder().decode(buffer.subarray(0, n)));
  } finally {
    conn.close();
  }
}
