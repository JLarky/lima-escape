import type { DefaultJob } from "@jlarky/gha-ts/workflow-types";
import { checkoutAndInstallDeno } from "./steps.ts";

export function publishJsr(
  opts: { dryRun?: boolean } = { dryRun: true },
): DefaultJob {
  const label = opts.dryRun ? "Dry run publish package" : "Publish package";
  return {
    name: label,
    "runs-on": "ubuntu-latest",
    steps: [
      ...checkoutAndInstallDeno(),
      {
        name: label,
        run: opts.dryRun ? "deno publish --dry-run" : "deno publish",
      },
    ],
  };
}
