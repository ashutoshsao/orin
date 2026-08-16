import { Template, defaultBuildLogger } from 'e2b'
import { template } from './template'

async function main() {
  await Template.build(template, 'orin-react-workspace-dev', {
    onBuildLogs: defaultBuildLogger(),
  });
}

main().catch(console.error);