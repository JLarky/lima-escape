import { stringify as yamlStringify } from "@std/yaml";
import { workflow } from "@jlarky/gha-ts/workflow-types";
import { checkout } from "@jlarky/gha-ts/actions";
import { generateWorkflow } from "@jlarky/gha-ts/cli";

const wf = workflow({
  name: "Publish",
  on: {
    push: { branches: ["main"] },
    workflow_dispatch: {},
  },
  jobs: {
    publish: {
      "runs-on": "ubuntu-24.04-arm",
      permissions: {
        contents: "read",
        "id-token": "write",
      },
      steps: [
        checkout(),
        {
          name: "Setup Deno",
          uses: "denoland/setup-deno@v2",
          with: { "deno-version": "v2.x" },
        },
        { name: "Publish to JSR", run: "deno publish" },
      ],
    },
  },
});

await generateWorkflow(wf, (data) => yamlStringify(data), import.meta.url);
