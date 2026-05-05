export const DEFAULT_PORT = 27332;

/** Maximum size of a response the client will read (1MB) */
export const MAX_RESPONSE_SIZE = 1024 * 1024;

/** Maximum size of stdout/stderr the server will send. Leave room for JSON envelope. */
export const MAX_OUTPUT_SIZE = MAX_RESPONSE_SIZE - 1024;

export interface Request {
  type?: "exec" | "status";
  argv: string[];
  cwd: string;
  token?: string;
}

export interface StatusInfo {
  allow: Record<string, Pattern[]>;
  deny?: Record<string, Pattern[]>;
  pathMap?: Record<string, string>;
  cwdStatus?: CwdStatus;
  allowRun: Record<string, string>;
  pid?: number;
}

export interface CwdStatus {
  requested: string;
  matchCwd?: string;
  executionCwd?: string;
  mapped?: boolean;
  error?: string;
}

export interface Response {
  code: number;
  stdout: string;
  stderr: string;
  error?: string;
}

import type { AllowResult, Pattern, Rules } from "./match.ts";

export interface ServerOptions {
  allow: Record<string, Pattern[]>;
  deny?: Record<string, Pattern[]>;
  pathMap?: Record<string, string>;
  isAllowed: (argv: string[], cwd: string, rules: Rules) => AllowResult;
  port?: number;
  checkToken?: (token: string) => boolean;
}

function pathSpecificity(path: string): number {
  return path.split("/").filter(Boolean).length;
}

function translatePath(path: string, pathMap?: Record<string, string>): string {
  if (!pathMap || !path.startsWith("/")) return path;

  let bestMatch: [string, string] | undefined;
  for (const entry of Object.entries(pathMap)) {
    const [vmPrefix] = entry;
    if (path !== vmPrefix && !path.startsWith(vmPrefix + "/")) continue;
    if (
      !bestMatch || pathSpecificity(vmPrefix) > pathSpecificity(bestMatch[0])
    ) {
      bestMatch = entry;
    }
  }

  if (!bestMatch) return path;
  const [vmPrefix, hostPrefix] = bestMatch;
  const suffix = path.slice(vmPrefix.length);
  return hostPrefix + suffix;
}

export function truncateOutput(
  text: string,
  limit: number,
): { text: string; truncated: number } {
  if (text.length <= limit) return { text, truncated: 0 };
  const truncated = text.length - limit;
  return {
    text: text.slice(0, limit) +
      `\n... ${truncated} bytes truncated by lima-escape`,
    truncated,
  };
}

export async function validateCwd(
  cwd: string,
): Promise<{ resolved: string } | { error: string }> {
  if (!cwd.startsWith("/")) {
    return { error: `cwd must be an absolute path, got: "${cwd}"` };
  }
  try {
    const resolved = await Deno.realPath(cwd);
    const stat = await Deno.stat(resolved);
    if (!stat.isDirectory) {
      return { error: `cwd is not a directory: "${cwd}"` };
    }
    return { resolved };
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "NotCapable" || name === "PermissionDenied") {
      return {
        error:
          `cwd not readable on host (server needs --allow-read=${cwd}): "${cwd}"`,
      };
    }
    return { error: `cwd does not exist on host: "${cwd}"` };
  }
}

export async function resolveRequestCwd(
  requestedCwd: string,
  pathMap?: Record<string, string>,
): Promise<
  | { logical: string; execution: string }
  | { error: string }
> {
  const logicalResult = await validateCwd(requestedCwd).catch(() => ({
    error: `cwd does not exist on host: "${requestedCwd}"`,
  }));
  if ("resolved" in logicalResult) {
    return {
      logical: logicalResult.resolved,
      execution: logicalResult.resolved,
    };
  }

  const translatedCwd = translatePath(requestedCwd, pathMap);
  if (translatedCwd === requestedCwd) {
    return { error: logicalResult.error };
  }

  const translatedResult = await validateCwd(translatedCwd);
  if ("error" in translatedResult) {
    return {
      error:
        `${logicalResult.error}; mapped to "${translatedCwd}" but ${translatedResult.error}`,
    };
  }

  return {
    logical: requestedCwd,
    execution: translatedResult.resolved,
  };
}

export async function getCwdStatus(
  requestedCwd: string,
  pathMap?: Record<string, string>,
): Promise<CwdStatus> {
  const cwdResult = await resolveRequestCwd(requestedCwd, pathMap);
  if ("error" in cwdResult) {
    return {
      requested: requestedCwd,
      error: cwdResult.error,
    };
  }
  return {
    requested: requestedCwd,
    matchCwd: cwdResult.logical,
    executionCwd: cwdResult.execution,
    mapped: cwdResult.logical !== cwdResult.execution,
  };
}

async function executeCommand(argv: string[], cwd: string): Promise<Response> {
  const command = new Deno.Command(argv[0], { args: argv.slice(1), cwd });
  const { code, stdout, stderr } = await command.output();
  const stdoutLimit = Math.floor(MAX_OUTPUT_SIZE / 2);
  const stderrLimit = MAX_OUTPUT_SIZE - stdoutLimit;
  const out = truncateOutput(new TextDecoder().decode(stdout), stdoutLimit);
  const err = truncateOutput(new TextDecoder().decode(stderr), stderrLimit);
  return { code, stdout: out.text, stderr: err.text };
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
      const commands = [
        ...new Set(
          Object.values(opts.allow).flat().flatMap((p) => {
            if (typeof p === "string") return [p.split(" ")[0]];
            const first = p[0];
            if (typeof first === "string") return [first];
            return first; // string[] alternatives — all are possible commands
          }),
        ),
      ];
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
      const authenticated = !opts.checkToken ||
        opts.checkToken(req.token ?? "");
      const status: StatusInfo = {
        allow: opts.allow,
        ...(opts.deny ? { deny: opts.deny } : {}),
        ...(opts.pathMap ? { pathMap: opts.pathMap } : {}),
        cwdStatus: await getCwdStatus(req.cwd, opts.pathMap),
        allowRun,
        ...(authenticated ? { pid: Deno.pid } : {}),
      };
      res = { code: 0, stdout: JSON.stringify(status), stderr: "" };
      console.log("status request from client");
    } else {
      if (opts.checkToken && !opts.checkToken(req.token ?? "")) {
        res = {
          code: 1,
          stdout: "",
          stderr:
            `Authentication required. Run \`lima-escape --auth\` to generate a token, then add it to your host config.`,
          error: "auth_required",
        };
        console.log("rejected: invalid or missing auth token");
      } else {
        const cwdResult = await resolveRequestCwd(req.cwd, opts.pathMap);
        if ("error" in cwdResult) {
          res = {
            code: 1,
            stdout: "",
            stderr: `invalid cwd: ${cwdResult.error}`,
            error: "invalid_cwd",
          };
          console.log("rejected: invalid cwd -", cwdResult.error);
        } else {
          const matchCwd = cwdResult.logical;
          const executionCwd = cwdResult.execution;
          const rules: Rules = { allow: opts.allow, deny: opts.deny };
          const result = opts.isAllowed(req.argv, matchCwd, rules);
          if (!result.allowed) {
            const cmd = req.argv.join(" ");
            const hint = result.hint ? `\nhint: ${result.hint}` : "";
            res = {
              code: 1,
              stdout: "",
              stderr:
                `denied: ${result.reason}${hint}\n\nRun \`lima-escape --help\` for setup instructions or \`lima-escape --status\` to see currently allowed patterns.`,
              error: "denied",
            };
            console.log("denied:", cmd, "-", result.reason);
          } else {
            const cmd = req.argv.join(" ");
            console.log(
              "executing:",
              cmd,
              "for requested cwd",
              matchCwd,
              "in",
              executionCwd,
            );
            try {
              res = await executeCommand(req.argv, executionCwd);
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
        }
      }
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
  token?: string,
): Promise<Response> {
  const conn = await Deno.connect({ hostname, port });

  try {
    const req: Request = { type, argv, cwd: Deno.cwd(), token };
    await conn.write(new TextEncoder().encode(JSON.stringify(req)));

    // Read all chunks until connection closes, up to MAX_RESPONSE_SIZE
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let truncated = false;
    const buffer = new Uint8Array(65536);
    while (true) {
      const n = await conn.read(buffer);
      if (n === null) break;
      if (totalBytes + n > MAX_RESPONSE_SIZE) {
        chunks.push(buffer.slice(0, MAX_RESPONSE_SIZE - totalBytes));
        totalBytes = MAX_RESPONSE_SIZE;
        truncated = true;
        break;
      }
      chunks.push(buffer.slice(0, n));
      totalBytes += n;
    }

    if (totalBytes === 0) {
      throw new Error("Server closed connection without responding");
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const text = new TextDecoder().decode(merged);
    try {
      const res: Response = JSON.parse(text);
      if (truncated) {
        res.stderr = (res.stderr ? res.stderr + "\n" : "") +
          "Response truncated by lima-escape client (exceeded 1MB)";
      }
      return res;
    } catch {
      // JSON was truncated — return what we can
      return {
        code: 1,
        stdout: text.slice(0, 1024),
        stderr:
          `lima-escape: server response too large to parse (${totalBytes} bytes received, truncated: ${truncated}). Try a command that produces less output.`,
        error: "response_too_large",
      };
    }
  } finally {
    conn.close();
  }
}
