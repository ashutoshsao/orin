import { Template } from 'e2b'
import { join } from 'node:path'

export const template = Template({
  fileContextPath: join(import.meta.dirname, '../react-template'),
  fileIgnorePatterns: ['**/node_modules/**'],
})
  .fromImage('oven/bun:1.3.14')
  .copy('.', '/home/user/react-template')
  .runCmd('chown -R user /home/user/react-template', { user: 'root' })
  .setWorkdir('/home/user/react-template')
  .runCmd('bun install')
