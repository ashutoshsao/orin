import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { trialCleanupDate, type Access } from '@/lib/access'
import { RequestAccessButton, TrialNotice } from './TrialNotice'

const access: Access = {
  tier: 'byok', stepsLimit: 60, stepsUsed: 12, stepsLeft: 48,
  expiresAt: '2026-11-01T12:00:00Z', expired: false,
}

test('active trial notice gives budget, expiry and project cleanup policy', () => {
  const html = renderToStaticMarkup(<TrialNotice access={access} onAccessChange={() => {}} />)
  expect(html).toContain('48 steps left')
  expect(html).toContain('ends')
  expect(html).toContain('Project data is scheduled for cleanup')
  expect(html).toContain('Your account and usage history stay')
  expect(html).not.toContain('Request more access')
})

test('exhausted trials offer an access request and show when a request is pending', () => {
  const exhausted = { ...access, stepsUsed: 60, stepsLeft: 0 }
  const html = renderToStaticMarkup(<TrialNotice access={exhausted} onAccessChange={() => {}} />)
  expect(html).toContain('Request more access')
  expect(html).toContain('Requesting does not delay project cleanup')
  const pending = renderToStaticMarkup(<TrialNotice access={{ ...exhausted, extensionRequestedAt: '2026-10-30T10:00:00Z' }} onAccessChange={() => {}} />)
  expect(pending).toContain('Access requested')
  expect(pending).toContain('disabled=""')
})

test('expired users can request access after their files have been removed', () => {
  const html = renderToStaticMarkup(<RequestAccessButton access={{ ...access, expired: true, dataPurgedAt: '2026-11-09T00:00:00Z' }} onAccessChange={() => {}} />)
  expect(html).toContain('Request more access')
  expect(html).not.toContain('disabled=""')
})

test('unlimited accounts have no trial notice and invalid dates do not produce a cleanup deadline', () => {
  expect(renderToStaticMarkup(<TrialNotice access={{ ...access, stepsLimit: null, stepsLeft: null }} onAccessChange={() => {}} />)).toBe('')
  expect(trialCleanupDate(null)).toBeNull()
  expect(trialCleanupDate('not-a-date')).toBeNull()
  expect(trialCleanupDate(access.expiresAt)).toBe(new Date('2026-11-08T12:00:00Z').toLocaleDateString())
})
