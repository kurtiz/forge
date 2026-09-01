/**
 * Model provider abstraction.
 *
 * Forge routes by task rather than binding to one model: discovery and
 * classification are cheap and frequent, judging is not. Workers AI is the
 * default because it needs no external key; an AI Gateway URL plus an API key
 * switches the same interface to a stronger external model.
 */
import { env } from 'cloudflare:workers'

export { extractJson } from './json'

export type ModelTask = 'discovery' | 'judging'

export type ModelInput = {
  system: string
  user: string
  task: ModelTask
  maxTokens?: number
}

export type ModelOutput = {
  text: string
  model: string
}

export interface ModelProvider {
  readonly available: boolean
  generate(input: ModelInput): Promise<ModelOutput>
}

/** Workers AI. Reasonable quality, no external account, billed per neuron. */
class WorkersAiProvider implements ModelProvider {
  readonly available = true

  private modelFor(task: ModelTask): string {
    return task === 'judging'
      ? '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
      : '@cf/meta/llama-3.1-8b-instruct-fast'
  }

  async generate(input: ModelInput): Promise<ModelOutput> {
    const model = this.modelFor(input.task)
    const result = (await env.AI.run(model as never, {
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      max_tokens: input.maxTokens ?? 900,
      temperature: 0.2,
    } as never)) as { response?: string }

    return { text: result.response ?? '', model }
  }
}

/** Any OpenAI-compatible endpoint, typically reached through AI Gateway. */
class GatewayProvider implements ModelProvider {
  readonly available = true

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async generate(input: ModelInput): Promise<ModelOutput> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: input.maxTokens ?? 900,
        temperature: 0.2,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error(`Model gateway returned ${response.status}`)
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return {
      text: body.choices?.[0]?.message?.content ?? '',
      model: this.model,
    }
  }
}

class UnavailableProvider implements ModelProvider {
  readonly available = false
  async generate(): Promise<ModelOutput> {
    throw new Error('No model provider is configured.')
  }
}

export function modelProvider(): ModelProvider {
  if (env.AI_GATEWAY_URL && env.AI_GATEWAY_KEY) {
    return new GatewayProvider(
      env.AI_GATEWAY_URL,
      env.AI_GATEWAY_KEY,
      env.AI_GATEWAY_MODEL || 'gpt-4o-mini',
    )
  }
  if (env.AI) return new WorkersAiProvider()
  return new UnavailableProvider()
}
