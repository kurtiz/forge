/**
 * Forge REST client.
 *
 * Deliberately dependency-free: a verification CLI that pulls in a tree of
 * packages is a supply-chain surface on every developer machine and CI runner
 * that installs it. Node's built-in fetch is enough.
 */
import type { RunReport } from './types.js'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class ForgeClient {
  constructor(
    private readonly host: string,
    private readonly token: string,
  ) {}

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${this.host}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })
    } catch (error) {
      // A DNS failure or a refused connection is about the host, not the API,
      // and saying so saves a round of confused token debugging.
      const detail = error instanceof Error ? error.message : String(error)
      throw new ApiError(`Could not reach ${this.host}: ${detail}`, 0)
    }

    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = null
    }

    if (!response.ok) {
      const message =
        (parsed as { error?: string } | null)?.error ??
        `Request failed with HTTP ${response.status}.`
      throw new ApiError(message, response.status)
    }

    return parsed as T
  }

  whoami() {
    return this.request<{ user: { email: string; name: string }; console: string }>(
      '/api/v1/whoami',
    )
  }

  createRun(body: {
    url?: string
    projectId?: string
    repo?: string
    goal?: string
    name?: string
    idempotencyKey?: string
  }) {
    return this.request<{ run: { id: string }; url: string }>('/api/v1/runs', {
      method: 'POST',
      body,
    })
  }

  getRun(runId: string) {
    return this.request<RunReport>(`/api/v1/runs/${runId}`)
  }

  listProjects() {
    return this.request<{
      projects: Array<{ id: string; name: string; targetUrl: string }>
    }>('/api/v1/projects')
  }
}
