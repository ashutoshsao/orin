import { $ } from "bun";
import { join } from "node:path";

const root = join(import.meta.dir, "../../../..");

const template = join(root, "apps/react-template");
const workspace = join(root, "apps/workspace");

export async function scaffoldWorkspace() {
  await $`rsync -a --delete ${template}/ ${workspace}/`;

  const packageJsonPath = join(workspace, "package.json");
  const packageJson = await Bun.file(packageJsonPath).json();

  packageJson.name = "@turbo/workspace";

  await Bun.write(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2) + "\n",
  );

  return workspace;
}
