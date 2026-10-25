import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PublishControl } from './Publish'
import type { DeployInfo } from '@/lib/deploy'

const info: DeployInfo = {
  canDeploy: true, vercelProject: null, deployUrl: null, deployedCommit: null, deployedAt: null,
}

function render(overrides: Partial<DeployInfo>, disabled = false) {
  return renderToStaticMarkup(<PublishControl info={{ ...info, ...overrides }} publishing={false}
    outdated={false} disabled={disabled} onPublish={() => {}} onUnpublish={() => {}} />)
}

test('missing publishing configuration shows an explanation and disables Publish', () => {
  const html = render({ canDeploy: false, unavailableReason: 'deploy_unconfigured' })
  expect(html).toContain('Publish unavailable')
  expect(html).toContain('Publishing isn’t set up on this server.')
  expect(html).toContain('disabled=""')
})

test('a published URL stays accessible when publishing is unconfigured', () => {
  const html = render({ canDeploy: false, unavailableReason: 'deploy_unconfigured', deployUrl: 'https://coffee.vercel.app' })
  expect(html).toContain('href="https://coffee.vercel.app"')
  expect(html).toContain('aria-label="Copy link"')
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Unpublish<\/button>/)
})

test('a stopped sandbox blocks publishing but still allows taking the public app offline', () => {
  const html = render({ deployUrl: 'https://coffee.vercel.app' }, true)
  expect(html).toMatch(/<button[^>]*>Unpublish<\/button>/)
  expect(html).not.toContain('disabled=""')
})
