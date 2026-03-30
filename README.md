# lima-escape

Run arbitrary (allowlisted) commands on your host machine from inside a Lima VM.

## Setup

### 1. Install the client (in the VM)

Create `~/.local/bin/lima-escape`:

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/lima-escape << 'EOF'
#!/bin/bash
exec deno run --no-prompt --allow-net --ignore-env \
  https://raw.githubusercontent.com/JLarky/lima-escape/refs/heads/main/main.ts "$@"
EOF
chmod +x ~/.local/bin/lima-escape
```

Add `~/.local/bin` to your PATH in `~/.profile` (not `~/.bashrc` — LLM agents
run in non-interactive shells where `~/.bashrc` is skipped):

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile
source ~/.profile
```

Create wrapper scripts for commands you want to proxy (e.g. `gh`):

```bash
cat > ~/.local/bin/gh << 'EOF'
#!/bin/bash
exec lima-escape gh "$@"
EOF
chmod +x ~/.local/bin/gh
```

### 2. Authenticate (in the VM)

```bash
lima-escape --auth
```

This generates a random token and saves it to `~/.lima-escape-token`. It will
print the token and instructions. Copy the token for the next step.

### 3. Create a config (on host)

Create `~/.config/lima-escape/config.json` on your **host** with allow/deny
rules scoped by directory:

```json
{
  "tokens": ["<paste token from lima-escape --auth>"],
  "allow": {
    "*": [
      "gh pr view *",
      "gh pr list *",
      "gh issue view *",
      "gh issue list *"
    ]
  },
  "deny": {
    "/home/user/prod-infra": ["gh *"]
  }
}
```

Keys are directory patterns (POSIX `fnmatch` glob syntax). Use `"*"` to match
any directory. Command patterns also use `fnmatch` — `*` matches anything. Deny
rules take precedence over allow rules.

### 4. Start the server (on host)

```bash
deno run --no-prompt --allow-ffi --allow-env=HOME,LIMA_ESCAPE_TOKENS --allow-read=$HOME/.config/lima-escape --allow-net=0.0.0.0:27332 --allow-run=gh,git https://raw.githubusercontent.com/JLarky/lima-escape/refs/heads/main/server.ts
```

Adjust `--allow-run` to only allow specific commands. Use `--allow-run=*` to
allow everything in the config.

### 5. Verify

```bash
lima-escape --status   # check server connectivity and allowed patterns
lima-escape --help     # full setup reference
```

## Permissions

- **Server**: `--allow-run` (execute commands), `--allow-ffi` (for fnmatch),
  `--allow-env=HOME` and `--allow-read` (to read the config file), `--allow-net`
  (to listen for client connections)
- **Client**: `--allow-net` (to connect to the server), `--ignore-env` (change
  to --allow-env=LIMA_ESCAPE_HOST,LIMA_ESCAPE_PORT if you need to adjust that)

## Security

1. **Token auth**: clients must present a token from `config.json` — without it,
   exec requests are rejected
2. **Allowlist**: only commands matching `fnmatch` patterns in config execute
3. **No shell**: always `Deno.Command` with argv array, never `sh -c`
4. **Argv-in, argv-out**: client sends pre-split argv from the OS, server
   executes as argv — no string splitting
5. **TCP exposure**: server binds to `0.0.0.0` by default — any host on the
   network can connect. Scope with `--allow-net=0.0.0.0:27332` for the listening
   port only
