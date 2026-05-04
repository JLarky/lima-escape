import { stringify as yamlStringify } from "@std/yaml";
import { workflow } from "@jlarky/gha-ts/workflow-types";
import { generateWorkflow } from "@jlarky/gha-ts/cli";
import { checkoutAndInstallDeno } from "./utils/steps.ts";

const wf = workflow({
  name: "Create Release",
  on: {
    push: {
      branches: ["main"],
      paths: ["deno.json"],
    },
  },
  permissions: {
    contents: "write",
  },
  jobs: {
    "create-release": {
      "runs-on": "ubuntu-latest",
      steps: [
        ...checkoutAndInstallDeno(),
        {
          name: "Get version from deno.json",
          id: "get_version",
          run:
            `echo "version=$(deno eval 'console.log(JSON.parse(Deno.readTextFileSync(\"deno.json\")).version)')" >> "$GITHUB_OUTPUT"`,
        },
        {
          name: "Create Release",
          uses: "softprops/action-gh-release@v2",
          with: {
            tag_name: `v\${{ steps.get_version.outputs.version }}`,
            draft: true,
            make_latest: true,
          },
        },
      ],
    },
  },
});

await generateWorkflow(wf, (data) => yamlStringify(data), import.meta.url);
