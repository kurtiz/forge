/**
 * Minimal Chrome DevTools Protocol client for Cloudflare Workers.
 *
 * Solari's own SDK bundles a Playwright fork, which needs raw sockets and a
 * Node runtime and therefore cannot run on Workers. Solari also exposes each
 * session's raw CDP endpoint, and Workers can hold an outbound WebSocket, so
 * Forge speaks CDP directly. That keeps the whole control plane on Workers with
 * no extra hop.
 */
import { ExecutorError } from './types'

type Pending = {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type CdpEvent = {
  method: string
  params: Record<string, unknown>
  sessionId?: string
}

export class CdpConnection {
  private socket: WebSocket | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly listeners = new Set<(event: CdpEvent) => void>()
  private closed = false

  constructor(private readonly timeoutMs = 30_000) {}

  async connect(endpoint: string): Promise<void> {
    const httpUrl = endpoint.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')

    const response = await fetch(httpUrl, {
      headers: { Upgrade: 'websocket' },
    })
    const socket = response.webSocket
    if (!socket) {
      throw new ExecutorError(
        `CDP endpoint did not upgrade (status ${response.status}).`,
        true,
      )
    }

    socket.accept()
    this.socket = socket

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return
      this.handleMessage(event.data)
    })
    socket.addEventListener('close', () => this.failAll('CDP socket closed.'))
    socket.addEventListener('error', () => this.failAll('CDP socket errored.'))
  }

  onEvent(listener: (event: CdpEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    if (!this.socket || this.closed) {
      throw new ExecutorError('CDP connection is not open.', true)
    }

    const id = this.nextId++
    const payload = JSON.stringify(
      sessionId ? { id, method, params, sessionId } : { id, method, params },
    )

    const result = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new ExecutorError(`CDP ${method} timed out.`, true))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })

    this.socket.send(payload)
    return (await result) as T
  }

  close(): void {
    this.closed = true
    this.failAll('CDP connection closed by client.')
    try {
      this.socket?.close(1000, 'done')
    } catch {
      // The socket may already be gone; closing is best effort.
    }
    this.socket = null
  }

  private handleMessage(raw: string) {
    let message: {
      id?: number
      result?: Record<string, unknown>
      error?: { message?: string }
      method?: string
      params?: Record<string, unknown>
      sessionId?: string
    }
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }

    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) {
        pending.reject(
          new ExecutorError(`CDP error: ${message.error.message ?? 'unknown'}`, false),
        )
      } else {
        pending.resolve(message.result ?? {})
      }
      return
    }

    if (message.method) {
      const event: CdpEvent = {
        method: message.method,
        params: message.params ?? {},
        sessionId: message.sessionId,
      }
      for (const listener of this.listeners) listener(event)
    }
  }

  private failAll(reason: string) {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new ExecutorError(reason, true))
    }
    this.pending.clear()
  }
}
