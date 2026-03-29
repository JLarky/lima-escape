#!/usr/bin/env -S deno run --no-prompt --allow-net --ignore-env
import { DEFAULT_PORT, startClient, type StatusInfo } from "./shared.ts";

if (import.meta.main) {
  const cmd =
    `deno run --no-prompt --allow-ffi --allow-env=HOME --allow-read=$HOME/.config/lima-escape --allow-net=0.0.0.0:27332 --allow-run=gh,git https://raw.githubusercontent.com/JLarky/lima-escape/refs/heads/main/server.ts`;

  if (
    Deno.args.length === 0 || Deno.args[0] === "--help" ||
    Deno.args[0] === "-h" || Deno.args[0] === ""
  ) {
    console.log(
      `lima-escape — run allowlisted commands on your host from inside a Lima VM

Usage:
  lima-escape <command> [args...]
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

  5. Create a config file at ~/.config/lima-escape/config.json with an "allow"
     array of glob patterns for allowed commands, e.g.:

     {
       "allow": ["gh pr view *", "git status"]
     }

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
      for (const pattern of status.allow) {
        console.log(`  ${pattern}`);
      }
      console.log("\nExecutable commands (--allow-run):");
      for (const [command, state] of Object.entries(status.allowRun)) {
        console.log(`  ${command.padEnd(12)} ${state}`);
      }
      const allowRunKeys = Object.keys(status.allowRun);
      const serverUrl =
        `https://raw.githubusercontent.com/JLarky/lima-escape/refs/heads/main/server.ts`;
      const serverCmd = (cmds: string[]) =>
        `deno run --no-prompt --allow-ffi --allow-env=HOME --allow-read=$HOME/.config/lima-escape --allow-net=0.0.0.0:${port} --allow-run=${
          cmds.join(",")
        } ${serverUrl}`;
      console.log(`
For LLM agents:
  If a command is denied, ask the user to run these on the host machine:

  1. Add a glob pattern to ~/.config/lima-escape/config.json:
     { "allow": [${
        status.allow.map((p) => `"${p}"`).join(", ")
      }, "<new pattern>"] }

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

  let res;
  try {
    console.log(
      "Attempting to run a command using github.com/JLarky/lima-escape",
    );
    res = await startClient(hostname, port, Deno.args);
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

  if (res.stdout) Deno.stdout.writeSync(new TextEncoder().encode(res.stdout));
  if (res.stderr) Deno.stderr.writeSync(new TextEncoder().encode(res.stderr));

  Deno.exit(res.code);
}
