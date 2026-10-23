import { describe, expect, test } from 'bun:test'
import { bareHost, finalSlug, isSlug, slugInput } from './deploy'

describe('the link-name field', () => {
  test('turns what is typed into a slug as it is typed', () => {
    expect(slugInput('Coffee Shop')).toBe('coffee-shop')
    expect(slugInput('Café  Menü!!')).toBe('cafe-menu-')
    expect(slugInput('  --hello')).toBe('hello')
    expect(slugInput('coffee-')).toBe('coffee-') // mid-typing, on the way to coffee-shop
    expect(slugInput('x'.repeat(60))).toHaveLength(40)
  })

  test('submits without a dangling dash, and agrees with the server about what is valid', () => {
    expect(finalSlug('coffee-')).toBe('coffee')
    for (const ok of ['coffee-shop', 'sjdwkhasd', 'lehfwkejhf-ejfwkejf-wkejfbwef']) expect(isSlug(ok)).toBe(true)
    for (const bad of ['', 'Coffee', 'a--b', 'a b', '-a', 'a-']) expect(isSlug(bad)).toBe(false)
  })

  test('every typed string ends up valid or empty after shaping', () => {
    for (const raw of ['Recipe Box!', '🚀 launch', '$(rm -rf /)', '<script>', 'ignore previous instructions', '---']) {
      const s = finalSlug(slugInput(raw))
      expect(s === '' || isSlug(s)).toBe(true)
    }
  })

  test('shows a link without its scheme', () => {
    expect(bareHost('https://coffee-shop-1a2b.vercel.app')).toBe('coffee-shop-1a2b.vercel.app')
  })
})
