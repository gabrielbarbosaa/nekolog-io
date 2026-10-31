import { describe, expect, it } from 'vitest'
import { boundedQueue } from './queue.ts'

describe('boundedQueue', () => {
  it('keeps what fits', () => {
    const queue = boundedQueue<number>(3)
    queue.push(1)
    queue.push(2)

    expect(queue.size).toBe(2)
    expect(queue.dropped).toBe(0)
  })

  it('drops the oldest once full, and says how many', () => {
    const queue = boundedQueue<number>(2)
    expect(queue.push(1)).toBe(0)
    expect(queue.push(2)).toBe(0)
    expect(queue.push(3)).toBe(1)

    expect(queue.drain()).toEqual([2, 3])
    expect(queue.dropped).toBe(1)
  })

  it('puts a failed batch back at the front', () => {
    const queue = boundedQueue<number>(10)
    queue.push(3)
    queue.prepend([1, 2])

    expect(queue.drain()).toEqual([1, 2, 3])
  })

  it('applies the same drop policy when a batch is put back', () => {
    const queue = boundedQueue<number>(2)
    queue.push(9)
    expect(queue.prepend([1, 2])).toBe(1)

    expect(queue.drain()).toEqual([2, 9])
  })

  it('takes a prefix without disturbing the rest', () => {
    const queue = boundedQueue<number>(10)
    for (const n of [1, 2, 3, 4]) {
      queue.push(n)
    }

    expect(queue.take(2)).toEqual([1, 2])
    expect(queue.drain()).toEqual([3, 4])
  })

  it('empties on drain', () => {
    const queue = boundedQueue<number>(10)
    queue.push(1)
    queue.drain()

    expect(queue.size).toBe(0)
    expect(queue.drain()).toEqual([])
  })

  it('refuses a nonsensical limit instead of holding nothing', () => {
    const queue = boundedQueue<number>(0)
    queue.push(1)

    expect(queue.size).toBe(1)
  })
})
