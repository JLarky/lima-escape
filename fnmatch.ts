function libcPath(): string {
  if (Deno.build.os === "darwin") return "/usr/lib/libSystem.B.dylib";
  if (Deno.build.os === "linux") return "/lib/aarch64-linux-gnu/libc.so.6";
  throw new Error(`Unsupported OS: ${Deno.build.os}`);
}

const libc = Deno.dlopen(libcPath(), {
  fnmatch: {
    parameters: ["buffer", "buffer", "i32"],
    result: "i32",
  },
});

const encoder = new TextEncoder();

export function fnmatch(pattern: string, string: string, flags = 0): boolean {
  return libc.symbols.fnmatch(
    encoder.encode(pattern + "\0"),
    encoder.encode(string + "\0"),
    flags,
  ) === 0;
}

export function isAllowed(argv: string[], allowlist: string[]): boolean {
  const command = argv.join(" ");
  return allowlist.some((pattern) => fnmatch(pattern, command));
}
