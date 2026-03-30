#!/usr/bin/env -S deno run --no-prompt --allow-net --allow-env=HOME,LIMA_ESCAPE_HOST,LIMA_ESCAPE_PORT,LIMA_ESCAPE_TOKEN --allow-read --allow-write
import { prettyPrintPattern } from "./match.ts";
import { DEFAULT_PORT, startClient, type StatusInfo } from "./shared.ts";

function tokenPath(): string {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME not set");
  return home + "/.lima-escape-token";
}

function loadClientToken(): string | null {
  const envToken = Deno.env.get("LIMA_ESCAPE_TOKEN");
  if (envToken) return envToken;
  try {
    const token = Deno.readTextFileSync(tokenPath()).trim();
    return token || null;
  } catch {
    return null;
  }
}

if (import.meta.main) {
  const cmd =
    `deno run --no-prompt --allow-env=HOME --allow-read=$HOME/.config/lima-escape --allow-net=0.0.0.0:27332 --allow-run=gh,git https://raw.githubusercontent.com/JLarky/lima-escape/refs/heads/main/server.ts`;

  if (
    Deno.args.length === 0 || Deno.args[0] === "--help" ||
    Deno.args[0] === "-h" || Deno.args[0] === ""
  ) {
    console.log(
      `lima-escape — run allowlisted commands on your host from inside a Lima VM

Usage:
  lima-escape <command> [args...]
  lima-escape --auth             Authenticate with the server
  lima-escape --help
  lima-escape --status

Examples:
  lima-escape gh pr view 123
  lima-escape git status
  lima-escape --status          Check server status and config

Setup:
  1. Create a script at ~/.local/bin/lima-escape in your Lima VM:

     #!/bin/bash
     exec deno run --no-prompt --allow-net --ignore-env \\
       https://raw.githubusercontent.com/JLarky/lima-escape/refs/heads/main/main.ts "$@"

     Then: chmod +x ~/.local/bin/lima-escape

  2. Create wrapper scripts for commands you want to proxy, e.g. ~/.local/bin/gh:

     #!/bin/bash
     exec lima-escape gh "$@"

     Then: chmod +x ~/.local/bin/gh

  3. Make sure ~/.local/bin is on your PATH by adding to ~/.profile:

     export PATH="$HOME/.local/bin:$PATH"

  Note: Use ~/.profile, not ~/.bashrc. LLM agents like Claude Code run in
  non-interactive shells where ~/.bashrc is skipped (due to the interactive
  guard). Only ~/.profile is sourced for login shells, so PATH changes there
  are visible to both you and your AI tools.

  4. Start the server on your host machine with:

     ${cmd}

  5. Create a config file at ~/.config/lima-escape/config.json with allow/deny
     rules scoped by directory, e.g.:

     {
       "tokens": ["<paste token from step 6>"],
       "allow": { "*": ["gh pr view *", "git status"] },
       "deny": { "/sensitive": ["git *"] }
     }

     Keys are directory patterns. "*" matches any directory; paths use prefix
     matching (e.g. "/home/user" matches "/home/user/sub"). Command patterns
     use exact token matching — "gh pr *" means gh + pr + zero or more args.
     Deny rules take precedence over allow rules at equal specificity.

  6. Authenticate from the VM:

     lima-escape --auth

     This generates a token and saves it to ~/.lima-escape-token.
     Copy the printed token into the "tokens" array in your host config.

For LLM agents:
  When you are running inside a Lima VM some of the commands like \`gh\` might
  be a wrapper script (check with \`type gh\` or \`which gh\`).

  If you can't access something you will need to explain to your user how to
  update the config and restart the server.

Learn more at:
  https://github.com/JLarky/lima-escape
`,
    );
    Deno.exit(0);
  }

  const hostname = Deno.env.get("LIMA_ESCAPE_HOST") ?? "host.lima.internal";
  const port = Number(Deno.env.get("LIMA_ESCAPE_PORT") ?? DEFAULT_PORT);

  if (Deno.args[0] === "--status") {
    let res;
    try {
      res = await startClient(hostname, port, [], "status");
    } catch (e) {
      if (e instanceof Deno.errors.ConnectionRefused) {
        console.log(`Server:  down (${hostname}:${port})\n`);
        console.log("Start it with this command:\n  ", cmd);
        Deno.exit(1);
      }
      throw e;
    }
    console.log(`Server:  up (${hostname}:${port})\n`);
    let status: StatusInfo | undefined;
    try {
      status = JSON.parse(res.stdout);
    } catch {
      // Old server that doesn't support --status
    }
    if (status?.allow) {
      console.log("Allowed patterns:");
      for (const [cwdPattern, patterns] of Object.entries(status.allow)) {
        console.log(`  [cwd: ${cwdPattern}]`);
        for (const pattern of patterns) {
          console.log(`    ${prettyPrintPattern(pattern)}`);
        }
      }
      if (status.deny) {
        console.log("\nDenied patterns:");
        for (const [cwdPattern, patterns] of Object.entries(status.deny)) {
          console.log(`  [cwd: ${cwdPattern}]`);
          for (const pattern of patterns) {
            console.log(`    ${prettyPrintPattern(pattern)}`);
          }
        }
      }
      console.log("\nExecutable commands (--allow-run):");
      for (const [command, state] of Object.entries(status.allowRun)) {
        console.log(`  ${command.padEnd(12)} ${state}`);
      }
      const allowRunKeys = Object.keys(status.allowRun);
      const serverUrl =
        `https://raw.githubusercontent.com/JLarky/lima-escape/refs/heads/main/server.ts`;
      const serverCmd = (cmds: string[]) =>
        `deno run --no-prompt --allow-env=HOME --allow-read=$HOME/.config/lima-escape --allow-net=0.0.0.0:${port} --allow-run=${
          cmds.join(",")
        } ${serverUrl}`;
      const configJson = JSON.stringify(
        { allow: status.allow, ...(status.deny ? { deny: status.deny } : {}) },
        null,
        2,
      );
      console.log(`
For LLM agents:
  If a command is denied, ask the user to run these on the host machine:

  1. Edit ~/.config/lima-escape/config.json. Current config:
     ${configJson.split("\n").join("\n     ")}

     Keys are directory patterns ("*" = any dir). Add your pattern to the
     appropriate cwd key in "allow", or add a "deny" key to block commands.

  2. Kill the running server and restart it with the new command in --allow-run:
     ${
        status.pid
          ? `kill ${status.pid}`
          : "# find and kill the lima-escape server process"
      }
     ${serverCmd([...allowRunKeys, "<new-cmd>"])}

  If only the config changed (no new binary), skip --allow-run changes:
     ${
        status.pid
          ? `kill ${status.pid}`
          : "# find and kill the lima-escape server process"
      }
     ${serverCmd(allowRunKeys)}`);
    } else {
      console.log(
        "Server is running but does not support --status.\nUpdate the server to get config details.",
      );
    }
    Deno.exit(0);
  }

  if (Deno.args[0] === "--auth") {
    const existing = loadClientToken();
    if (existing && !Deno.args.includes("--force")) {
      console.log("Already authenticated. Token found at", tokenPath());
      console.log("Run `lima-escape --auth --force` to re-authenticate.");
      Deno.exit(0);
    }

    const token = crypto.randomUUID();
    Deno.writeTextFileSync(tokenPath(), token + "\n", { mode: 0o600 });
    console.log(`Token saved to ${tokenPath()}\n`);
    console.log(
      `Add this token to your host config (~/.config/lima-escape/config.json):`,
    );
    console.log(`\n  "tokens": ["${token}"]`);
    console.log(
      `\nThen restart the server (or it will pick up the new token on the next request).`,
    );
    Deno.exit(0);
  }

  const token = loadClientToken();
  if (!token) {
    console.error(
      "Not authenticated. Run `lima-escape --auth` to generate a token.",
    );
    Deno.exit(1);
  }

  let res;
  try {
    console.log(
      "Attempting to run a command using github.com/JLarky/lima-escape",
    );
    res = await startClient(hostname, port, Deno.args, undefined, token);
  } catch (e) {
    if (e instanceof Deno.errors.ConnectionRefused) {
      console.error(
        `%cNo lima-escape server found at ${hostname}:${port}. Start the server on your host machine first.`,
        "color: red; font-weight: bold",
      );

      console.log("Start it with this command:\n  ", cmd);
      Deno.exit(1);
    }
    throw e;
  }

  if (res.stdout) {
    const out = res.stdout.endsWith("\n") ? res.stdout : res.stdout + "\n";
    Deno.stdout.writeSync(new TextEncoder().encode(out));
  }
  if (res.stderr) {
    const err = res.stderr.endsWith("\n") ? res.stderr : res.stderr + "\n";
    Deno.stderr.writeSync(new TextEncoder().encode(err));
  }

  Deno.exit(res.code);
}
