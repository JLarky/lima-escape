# lima-escape

Run arbitrary (allowlisted) commands on your host machine from inside a Lima VM.

## Setup

### 1. Config

Create `~/.config/lima-escape/config.json` on your **host** with the commands
you want to allow:

```json
{
  "allow": {
    "*": [
      "gh pr view *",
      "gh pr list *",
      "gh issue view *",
      "gh issue list *",
      "git status",
      "git log *",
      "git diff *"
    ],
    "/home/user/full-vibes": [
      "git push -f",
      "git push *"
    ]
  },
  "deny": {
    "*": [
      "git push -f"
    ],
    "/home/user/prod-infra": [
      "git *"
    ]
  }
}
```

Keys are directory patterns (POSIX `fnmatch` glob syntax). Use `"*"` to match
any directory. Command patterns also use `fnmatch` — `*` matches anything.

Deny rules take precedence over allow rules. A command is blocked if it matches
any deny rule for the working directory, even if an allow rule would permit it.

### 2. Start the server (on host)

```bash
deno run --no-prompt --allow-ffi --allow-env=HOME --allow-read=$HOME/.config/lima-escape --allow-net=0.0.0.0:27332 --allow-run=gh,git https://raw.githubusercontent.com/JLarky/lima-escape/refs/heads/main/server.ts
```

Adjust `--allow-run` to have additional layer of security by only allowing
specific commands to be executed on the host. By default, it allows `gh` and
`git` since that's the example commands in the config, but you can add more or
use `--allow-run=*` to run everything allowed in the config.

### 3. Run commands (from inside the VM)

```bash
deno run --no-prompt --allow-net --ignore-env https://raw.githubusercontent.com/JLarky/lima-escape/refs/heads/main/main.ts gh pr view 123
```

The client sends the argv to the server, which checks it against the allowlist.
If allowed, it executes the command and returns stdout, stderr, and exit code.

Use `--help` for setup instructions and `--status` to check server connectivity
and see currently allowed patterns:

```bash
lima-escape --help
lima-escape --status
```

## Permissions

- **Server**: `--allow-run` (execute commands), `--allow-ffi` (for fnmatch),
  `--allow-env=HOME` and `--allow-read` (to read the config file), `--allow-net`
  (to listen for client connections)
- **Client**: `--allow-net` (to connect to the server), `--ignore-env` (change
  to --allow-end=LIMA_ESCAPE_HOST,LIMA_ESCAPE_PORT if you need to adjust that)

## Security

1. **Allowlist**: only commands matching `fnmatch` patterns in config execute
2. **No shell**: always `Deno.Command` with argv array, never `sh -c`
3. **Argv-in, argv-out**: client sends pre-split argv from the OS, server
   executes as argv — no string splitting
4. **TCP exposure**: server binds to `0.0.0.0` by default — any host on the
   network can connect. Scope with `--allow-net=0.0.0.0:27332` for the listening
   port only
