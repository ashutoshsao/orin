import { Template } from 'e2b'
import { join } from 'node:path'

export const template = Template({
  fileContextPath: join(import.meta.dirname, '../react-template'),
  fileIgnorePatterns: ['**/node_modules/**'],
})
  .fromImage('oven/bun:1.3.14')
  // git is needed for per-round snapshots (M5b); the bun slim image doesn't ship it.
  .runCmd('apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*', { user: 'root' })
  .copy('.', '/home/user/react-template')
  .runCmd('chown -R user /home/user/react-template', { user: 'root' })
  .setWorkdir('/home/user/react-template')
  .runCmd('bun install')
  // Base commit: every per-round snapshot is a delta on top of this. Runs as `user`
  // (build default) so .git is user-owned and the runtime agent can commit onto it.
  // node_modules/dist are already .gitignored, so this stays a clean source tree.
  .runCmd('git config --global user.email "agent@orin.dev" && git config --global user.name "Orin Agent" && git init -q -b main && git add -A && git commit -q -m "base: react-template scaffold"')
