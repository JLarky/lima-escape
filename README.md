# lima-escape

Run arbitrary (allowlisted) commands on your host machine from inside a Lima VM.

## Setup

### 1. Config

Create `~/.config/lima-escape/config.json` on your **host** with the commands
you want to allow:

```json
{
  "allow": [
    "gh pr view *",
    "gh pr list *",
    "git status",
    "git log *"
  ]
}
```

Patterns use POSIX `fnmatch` glob syntax — `*` matches anything.

### 2. Start the server (on host)

```bash
deno run --no-prompt --allow-run --allow-read --allow-write=/tmp --allow-ffi --allow-env=HOME server.ts
```

Or with the deno task:

```bash
deno task server
```

### 3. Run commands (from inside the VM)

```bash
deno run --no-prompt --allow-read=/tmp --allow-write=/tmp main.ts gh pr view 123
```

Or with the deno task:

```bash
deno task client gh pr view 123
```

The client sends the argv to the server, which checks it against the allowlist.
If allowed, it executes the command and returns stdout, stderr, and exit code.

## Permissions

- **Server**: `--allow-run` (execute commands), `--allow-read` (config + /tmp),
  `--allow-write=/tmp` (socket), `--allow-ffi` (fnmatch via libc),
  `--allow-env=HOME` (find config path)
- **Client**: `--allow-read=/tmp` and `--allow-write=/tmp` (connect to socket)

## Security

1. **Allowlist**: only commands matching `fnmatch` patterns in config execute
2. **No shell**: always `Deno.Command` with argv array, never `sh -c`
3. **Argv-in, argv-out**: client sends pre-split argv from the OS, server
   executes as argv — no string splitting
4. **Socket in /tmp**: any local user can connect to the socket. This is a known
   limitation (same as lima-code before it)
