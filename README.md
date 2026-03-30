# lima-escape

Run arbitrary (allowlisted) commands on your host machine from inside a Lima VM.

## Setup

### 1. Install the client (in the VM)

Create `~/.local/bin/lima-escape`:

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/lima-escape << 'EOF'
#!/bin/bash
exec deno run --no-prompt --ignore-env --allow-env=HOME \
  --allow-read=$HOME/.lima-escape-token --allow-write=$HOME/.lima-escape-token \
  --allow-net=host.lima.internal:27332 \
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
      "say *",
      ["gh", "pr", ["list", "view", "checks"], "*"],
      ["gh", "issue", ["create", "edit", "list", "view"], "*"],
      "git status",
      "git log *",
      "git diff *"
    ],
    "/home/user/full-vibes": [
      "git push *"
    ]
  },
  "deny": {
    "*": ["git push -f"],
    "/home/user/prod-infra": ["git *", "gh *"]
  }
}
```

#### Command patterns

Two formats are supported:

**String patterns** (sugar for simple cases):

```json
{ "allow": { "*": ["gh pr", "gh pr *", "git status"] } }
```

- `"gh pr"` — exact match, only `gh pr` with no trailing args
- `"gh pr *"` — zero or more trailing args (matches `gh pr`, `gh pr view 123`,
  etc.)
- Tokens are matched with `===`, no glob/regex

**Array patterns** (for alternatives):

```json
{ "allow": { "*": [["gh", ["pr", "issue"], "*"], ["git", "status"]] } }
```

- `["gh", "pr"]` — exact match (same as `"gh pr"`)
- `["gh", "pr", "*"]` — zero or more trailing args (same as `"gh pr *"`)
- `["gh", ["pr", "issue"], "*"]` — alternatives: matches `gh pr ...` or
  `gh issue ...`

Fail-closed: forgetting `*` gives less access, not more.

#### CWD patterns

Keys in allow/deny objects are directory patterns:

- `"*"` — matches any working directory
- `"/home/user/project"` — exact match or any subdirectory (prefix matching)

More specific paths override less specific ones. Deny rules break ties at equal
specificity.

### 4. Start the server (on host)

```bash
deno run --no-prompt --allow-ffi --ignore-env --allow-env=HOME --allow-read=$HOME/.config/lima-escape,$HOME/vm --allow-net=0.0.0.0:27332 --allow-run=gh,git,say https://raw.githubusercontent.com/JLarky/lima-escape/refs/heads/main/server.ts
```

Adjust `--allow-run` to only allow specific commands. Use `--allow-run=*` to
allow everything in the config.

### 5. Verify

```bash
lima-escape --status   # check server connectivity and allowed patterns
lima-escape --help     # full setup reference
```

## Permissions

- **Server**: `--allow-run` (execute commands), `--allow-ffi` (required by
  Deno), `--ignore-env` (don't inherit host environment), `--allow-env=HOME` (to
  find the config file), `--allow-read` (to read the config file), `--allow-net`
  (to listen for client connections)
- **Client**: `--ignore-env` (don't inherit VM environment), `--allow-env=HOME`
  (to find the token file), `--allow-read` and `--allow-write` (for the token
  file at `~/.lima-escape-token`), `--allow-net` (to connect to the server)

## Security

1. **Token auth**: clients must present a token from `config.json` — without it,
   exec requests are rejected
2. **Allowlist**: only commands matching token-based patterns in config execute
3. **No shell**: always `Deno.Command` with argv array, never `sh -c`
4. **Argv-in, argv-out**: client sends pre-split argv from the OS, server
   executes as argv — no string splitting
5. **cwd validation**: the server resolves the client-provided working directory
   with `realPath`, rejecting non-absolute, non-existent, or non-directory
   paths. This prevents path traversal and fabricated paths.
6. **TCP exposure**: server binds to `0.0.0.0` by default — any host on the
   network can connect. Scope with `--allow-net=0.0.0.0:27332` for the listening
   port only

### Limitations of cwd-scoped deny rules

Directory-scoped deny rules (e.g., denying `git *` in `/sensitive`) are
**organizational convenience, not a security boundary**. The cwd only controls
where the process starts — commands can have global effects via their own flags
(e.g., `git -C /other/path`, `gh --repo owner/repo`). The real security
boundaries are the **command pattern allowlist** and Deno's **`--allow-run`**
permission.
