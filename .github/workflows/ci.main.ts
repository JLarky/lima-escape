import { stringify as yamlStringify } from "@std/yaml";
import { workflow } from "@jlarky/gha-ts/workflow-types";
import { checkout } from "@jlarky/gha-ts/actions";
import { generateWorkflow } from "@jlarky/gha-ts/cli";
import { lines } from "@jlarky/gha-ts/utils";
import { publishJsr } from "./utils/jobs.ts";

const wf = workflow({
  name: "CI",
  on: {
    push: { branches: ["main"] },
    pull_request: {},
  },
  jobs: {
    dryRunPublish: publishJsr({ dryRun: true }),
    test: {
      "runs-on": "ubuntu-24.04-arm",
      steps: [
        checkout(),
        {
          name: "Setup Deno",
          uses: "denoland/setup-deno@v2",
          with: { "deno-version": "v2.x" },
        },
        {
          name: "Check generated workflows are up to date",
          run: lines`
            for f in .github/workflows/*.main.ts; do
              deno run --allow-read --allow-write "$f"
            done
            git diff --exit-code .github/workflows/
          `,
        },
        { name: "Lint", run: "deno lint" },
        { name: "Format check", run: "deno fmt --check" },
        {
          name: "Test",
          run: lines`
            export TMPDIR="$RUNNER_TEMP/lima-escape-tests"
            mkdir -p "$TMPDIR"
            deno test --allow-net --allow-run --allow-read --allow-env --allow-write="$TMPDIR"
          `,
        },
      ],
    },
  },
});

await generateWorkflow(wf, (data) => yamlStringify(data), import.meta.url);
