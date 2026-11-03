import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_DETAIL, pageUrl } from './page.ts'

describe('the page the log came from', () => {
  it('keeps the path, which is what tells one screen from another', () => {
    expect(pageUrl('https://shop.test/checkout/payment', 'path')).toBe(
      'https://shop.test/checkout/payment',
    )
  })

  it('leaves the query string behind, because it carries tokens', () => {
    expect(pageUrl('https://shop.test/reset?token=abc123&email=a@b.test', 'path')).toBe(
      'https://shop.test/reset',
    )
  })

  it('leaves the fragment behind, because single page apps put tokens there too', () => {
    expect(pageUrl('https://shop.test/callback#access_token=abc123', 'path')).toBe(
      'https://shop.test/callback',
    )
  })

  it('sends the whole address only when asked for it', () => {
    expect(pageUrl('https://shop.test/reset?token=abc123', 'full')).toBe(
      'https://shop.test/reset?token=abc123',
    )
  })

  it('sends nothing at all when turned off', () => {
    expect(pageUrl('https://shop.test/reset?token=abc123', false)).toBeUndefined()
  })

  it.each(['', 'not a url', 'javascript:alert(1)/', 'data:text/html,<script>alert(1)</script>'])(
    'answers nothing for %j, so no such string ever becomes an attribute',
    (href) => {
      expect(pageUrl(href, 'path')).toBeUndefined()
      expect(pageUrl(href, 'full')).toBeUndefined()
    },
  )

  it('keeps a self-hosted page opened from disk', () => {
    expect(pageUrl('file:///home/me/app/index.html?token=abc', 'path')).toBe(
      'file:///home/me/app/index.html',
    )
  })

  it('answers nothing when there is no address', () => {
    expect(pageUrl(undefined, 'path')).toBeUndefined()
  })

  it('strips the query by default', () => {
    expect(pageUrl('https://shop.test/reset?token=abc123', DEFAULT_PAGE_DETAIL)).toBe(
      'https://shop.test/reset',
    )
  })
})
