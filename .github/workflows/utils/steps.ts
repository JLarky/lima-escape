import { checkout as checkoutAction } from "@jlarky/gha-ts/actions";
import type { Step } from "@jlarky/gha-ts/workflow-types";

export function checkout(): Step {
  return { name: "Checkout", ...checkoutAction() };
}

export function installDeno(version: string = "v2.x"): Step {
  return {
    name: "Install Deno",
    uses: "denoland/setup-deno@v2",
    with: { "deno-version": version },
  };
}

export function checkoutAndInstallDeno(): Step[] {
  return [checkout(), installDeno()];
}
