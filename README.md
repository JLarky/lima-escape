First, set up an alias in your shell on your host machine

```bash
alias lcode='lima mise x deno -- deno run --no-prompt --allow-write=/tmp --allow-read=/tmp --ignore-env https://raw.githubusercontent.com/JLarky/lima-code/refs/heads/main/main.ts'
```

With this you now can run `lcode --help` or `lcode /tmp` etc to execute a
command in the context of your remote editor.

Second, you would have to do this part every time you start your editor:

- start your editor and connect to the VM via SSH
- once you are in open a built-in terminal
- you have to start long running server that will let you execute commands in
  the context of your IDE

```bash
mise x deno -- deno run --no-prompt --allow-run --allow-write=/tmp --allow-read=/tmp --ignore-env https://raw.githubusercontent.com/JLarky/lima-code/refs/heads/main/server.ts
```

# Permissions

This script is trying to not to ask for too many permissions. Both commands need
to have access to `/tmp` so that they are able to talk to each other, thus
--allow-write and --allow-read.

Server needs to be able to run `cursor` command (which is an alias for something
like
`~/.cursor-server/cli/servers/Stable-fea2f546c979a0a4ad1deab23552a43568807590/server/bin/remote-cli/cursor`),
thus --allow-run.

You can see from
[this line](https://github.com/JLarky/lima-code/blob/main/shared.ts#L12) that we
are only running `cursor` command, instead of unbound shell commands.

Because we use `glob` from `node:fs` module it wants to access
`__MINIMATCH_TESTING_PLATFORM__` environment variable, thus --ignore-env.

# Security conserns

Since `/tmp` is writable to anyone there's an attack where someone could write
their own client and run `cursor` or `code` commands with an arbitrary
arguments, as of this moment I don't know how we can improve this.
