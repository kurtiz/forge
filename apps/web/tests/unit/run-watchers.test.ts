import { describe, expect, it } from 'vitest'
import { RunWatchers } from '@/server/runs/watchers'

const frame = (text: string) => new TextEncoder().encode(text)

/** A watcher nobody reads from: the shape an abandoned SSE client leaves. */
function stalled() {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  return { readable, writer: writable.getWriter() }
}

/** A watcher that drains everything, the way a live browser does. */
function draining() {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const reader = readable.getReader()
  const received: string[] = []
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      received.push(new TextDecoder().decode(value))
    }
  })().catch(() => undefined)
  return { writer: writable.getWriter(), received, pump }
}

/** Resolves to `'hung'` if the promise has not settled within `ms`. */
function within<T>(promise: Promise<T>, ms: number) {
  return Promise.race([
    promise.then(() => 'settled' as const),
    new Promise<'hung'>((r) => setTimeout(() => r('hung'), ms)),
  ])
}

describe('run watchers', () => {
  it('does not let a watcher that stopped reading block the run', async () => {
    const watchers = new RunWatchers(50)
    const gone = stalled()
    watchers.add(gone.writer)

    // The regression: awaiting this write directly never settles, which froze
    // the engine mid-run with the finding already persisted.
    expect(await within(watchers.broadcast(frame('a')), 2000)).toBe('settled')
  })

  it('drops the stalled watcher rather than retrying it every event', async () => {
    const watchers = new RunWatchers(50)
    watchers.add(stalled().writer)

    await watchers.broadcast(frame('a'))
    expect(watchers.size).toBe(0)

    // Nothing left to wait on, so later events cost nothing at all.
    const started = Date.now()
    await watchers.broadcast(frame('b'))
    expect(Date.now() - started).toBeLessThan(40)
  })

  it('keeps delivering to healthy watchers alongside a stalled one', async () => {
    const watchers = new RunWatchers(50)
    const live = draining()
    watchers.add(stalled().writer)
    watchers.add(live.writer)

    await watchers.broadcast(frame('one'))
    await watchers.broadcast(frame('two'))

    expect(watchers.size).toBe(1)
    expect(live.received).toEqual(['one', 'two'])
  })

  it('pays the deadline once for the whole fan-out, not once per watcher', async () => {
    const watchers = new RunWatchers(200)
    for (let i = 0; i < 5; i++) watchers.add(stalled().writer)

    const started = Date.now()
    await watchers.broadcast(frame('a'))
    const elapsed = Date.now() - started

    // Sequentially this would be five deadlines, not one.
    expect(elapsed).toBeLessThan(600)
    expect(watchers.size).toBe(0)
  })

  it('drops a watcher whose stream has already errored', async () => {
    const watchers = new RunWatchers(50)
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const writer = writable.getWriter()
    await readable.cancel(new Error('client went away'))
    watchers.add(writer)

    expect(await within(watchers.broadcast(frame('a')), 2000)).toBe('settled')
    expect(watchers.size).toBe(0)
  })

  it('closes out live watchers and gives up on stalled ones', async () => {
    const watchers = new RunWatchers(50)
    const live = draining()
    watchers.add(live.writer)
    watchers.add(stalled().writer)

    expect(await within(watchers.closeAll(frame('done')), 2000)).toBe('settled')
    await live.pump

    expect(watchers.size).toBe(0)
    expect(live.received).toEqual(['done'])
  })
})
