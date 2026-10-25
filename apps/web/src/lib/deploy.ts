// Publishing an app (spec 12): what the server tells the builder, and the link-name field.

// GET /projects/:id/deploy. Before the first deploy: an `example` for the name field's
// placeholder and the fixed `suffix` the link will carry. After: the stored link.
export type DeployInfo = {
  canDeploy: boolean
  unavailableReason?: 'deploy_not_allowed' | 'deploy_unconfigured' | null
  vercelProject: string | null
  deployUrl: string | null
  deployedCommit: string | null
  deployedAt: string | null
  example?: string
  suffix?: string
}

// Same limit as the server (apps/api/src/deploy/naming.ts SLUG_MAX).
export const SLUG_MAX = 40

// Shapes what's typed into a slug as it's typed, so a sentence never makes it into the field:
// "Coffee Shop" → "coffee-shop". A trailing dash is kept while typing ("coffee-" on the way to
// "coffee-shop") and trimmed by finalSlug() on submit.
export function slugInput(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_MAX)
}

export const finalSlug = (s: string) => s.replace(/-+$/, '')

// The server's rule (naming.ts isValidSlug): one or more letters/digits, joined by single dashes.
export const isSlug = (s: string) => s.length > 0 && s.length <= SLUG_MAX && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)

// "https://coffee-shop-1a2b.vercel.app" → "coffee-shop-1a2b.vercel.app"
export const bareHost = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

// POST /projects/:id/deploy refusals, in words. name_taken is shown in the dialog itself.
export function deployErrorText(code: string): string {
  switch (code) {
    case 'name_taken': return 'That name is taken. Try another.'
    case 'invalid_name': return 'Use lowercase letters, numbers and dashes.'
    case 'name_required': return 'Choose a name for the link.'
    case 'run_active': return 'Wait for the current change to finish, then publish.'
    case 'deploy_in_progress': return 'Already publishing.'
    case 'not_running': return 'The app isn’t running. Reopen the project to publish.'
    case 'deploy_not_allowed': return 'Publishing isn’t available on this account.'
    case 'deploy_unconfigured': return 'Publishing isn’t set up on this server.'
    default: return 'Couldn’t start publishing. Try again.'
  }
}
