import { stringify as yamlStringify } from "@std/yaml";
import { workflow } from "@jlarky/gha-ts/workflow-types";
import { generateWorkflow } from "@jlarky/gha-ts/cli";
import { publishJsr } from "./utils/jobs.ts";

const wf = workflow({
  name: "Publish",
  on: {
    push: { branches: ["main"] },
  },
  permissions: {
    contents: "read",
    "id-token": "write",
  },
  jobs: {
    publish: publishJsr({ dryRun: false }),
  },
});

await generateWorkflow(wf, (data) => yamlStringify(data), import.meta.url);
