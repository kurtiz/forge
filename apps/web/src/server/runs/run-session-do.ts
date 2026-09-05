/**
 * Run session Durable Object.
 *
 * One instance per verification run. It owns the run while it is executing:
 * the engine loop, the event sequence counter, the cancellation flag, and the
 * set of connected clients watching live. A Durable Object is the right
 * primitive here because all of that is single-run state that has to be
 * consistent for every viewer, which is exactly what a DO guarantees.
 */
import { DurableObject } from 'cloudflare:workers'
import type { JsonValue } from '@/server/contracts'
import { executeRun, type EngineInput } from './engine'
import { publishRunOutcome } from './outcome'
import * as repo from './repository'
import { RunWatchers } from './watchers'

type StartMessage = EngineInput

export class RunSessionDO extends DurableObject<Env> {
  /**
   * Clients currently watching this run.
   *
   * `RunWatchers` rather than a bare `Set` because a watcher that stops
   * reading must not be able to stall the engine. See the note there.
   */
  private readonly watchers = new RunWatchers()
  private canceled = false
  private sequence = 0
  private running = false

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    switch (url.pathname) {
      case '/start':
        return this.handleStart(request)
      case '/stream':
        return this.handleStream()
      case '/cancel':
        return this.handleCancel()
      default:
        return new Response('Not found', { status: 404 })
    }
  }

  private async handleStart(request: Request): Promise<Response> {
    if (this.running) {
      return Response.json({ ok: true, alreadyRunning: true })
    }
    this.running = true

    const input = (await request.json()) as StartMessage
    await this.ctx.storage.put('input', input)

    // The engine is mostly I/O against Solari and D1; running it under
    // waitUntil lets the caller get its run id back immediately.
    this.ctx.waitUntil(this.drive(input))

    return Response.json({ ok: true })
  }

  private async drive(input: StartMessage): Promise<void> {
    try {
      await executeRun(input, {
        emit: (type, message, data) => this.emit(input.runId, type, message, data),
        isCanceled: () => this.canceled,
      })
    } finally {
      this.running = false
      /*
       * Outside the engine and inside the `finally`, so a GitHub check gets a
       * conclusion and a monitor records its tick whether the run completed,
       * failed, or was canceled. It never throws.
       */
      await publishRunOutcome(input.runId)
      await this.closeWatchers()
    }
  }

  private handleStream(): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const writer = writable.getWriter()
    this.watchers.add(writer)

    // Not awaited: this runs before the response is returned, so nothing is
    // reading the other end of the stream yet and the write cannot land until
    // it is. Failures are picked up by the next broadcast.
    void writer.write(new TextEncoder().encode(': connected\n\n')).catch(() => undefined)

    return new Response(readable, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    })
  }

  private async handleCancel(): Promise<Response> {
    this.canceled = true
    const input = await this.ctx.storage.get<StartMessage>('input')
    if (input) {
      await this.emit(input.runId, 'run.canceled', 'Cancellation requested.')
    }
    return Response.json({ ok: true })
  }

  /**
   * Persists the event to D1 (so a page load after the fact shows the full
   * timeline) and pushes it to every live watcher.
   */
  private async emit(
    runId: string,
    type: string,
    message: string,
    data: Record<string, JsonValue> = {},
  ): Promise<void> {
    const sequence = ++this.sequence
    const event = await repo
      .appendEvent({ runId, sequence, type, message, data })
      .catch(() => ({
        id: `local_${sequence}`,
        runId,
        sequence,
        type,
        message,
        data,
        createdAt: new Date().toISOString(),
      }))

    await this.watchers.broadcast(
      new TextEncoder().encode(`event: run\ndata: ${JSON.stringify(event)}\n\n`),
    )
  }

  private async closeWatchers(): Promise<void> {
    await this.watchers.closeAll(
      new TextEncoder().encode('event: done\ndata: {}\n\n'),
    )
  }
}
