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

/**
 * Truncates and redacts sensitive data for dev logging.
 * Redacts API keys, tokens, and long strings.
 */
function redactForLog(text: string, maxLength = 500): string {
  let redacted = String(text)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/api[_-]?key['":\s]*['"][^'"]+['"]/gi, 'api_key: [REDACTED]')
    .replace(/token['":\s]*['"][^'"]+['"]/gi, 'token: [REDACTED]')
  if (redacted.length > maxLength) {
    redacted = redacted.slice(0, maxLength) + '... [truncated]'
  }
  return redacted
}

/**
 * Coerces a Workers AI result to text.
 *
 * `response` is documented as a string and is not always one: a model that
 * decides to answer with structured output puts an object there, and the
 * caller - which only ever wants text to pull JSON out of - used to take
 * `.replace` to it and throw `text.replace is not a function` inside the try
 * that wraps discovery. The run then silently dropped to heuristic journeys
 * with a model that was working perfectly well.
 *
 * Anything that is not a string is stringified rather than discarded, because
 * an object here is usually the answer already parsed.
 */
export function asText(result: unknown): string {
  if (typeof result === 'string') return result
  if (result === null || typeof result !== 'object') return ''

  const response = (result as { response?: unknown }).response
  if (typeof response === 'string') return response
  if (response !== undefined && response !== null) {
    return typeof response === 'object' ? JSON.stringify(response) : String(response)
  }

  // Some models answer in the OpenAI shape even through the Workers AI binding.
  const choice = (result as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices?.[0]?.message?.content
  if (typeof choice === 'string') return choice

  return ''
}

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

  /**
   * Both tasks get the larger model.
   *
   * Discovery used to run on llama-3.1-8b-instruct-fast, and it is the wrong
   * place to save: it happens once per run, it has to emit JSON that survives
   * schema validation, and everything the run then spends its budget on comes
   * from its answer. A cheap model that produces unparseable output drops the
   * run to heuristic journeys, which costs far more than the call it saved.
   */
  private modelFor(_task: ModelTask): string {
    return '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
  }

  async generate(input: ModelInput): Promise<ModelOutput> {
    const model = this.modelFor(input.task)
    console.debug(`[provider] WorkersAI calling ${model} for ${input.task}`)
    
    const result = (await env.AI.run(model as never, {
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      max_tokens: input.maxTokens ?? 900,
      temperature: 0.2,
    } as never)) as unknown

    const responseText = asText(result)
    console.debug(`[provider] Raw response (${responseText.length} chars): ${redactForLog(responseText)}`)

    return { text: responseText, model }
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
    console.debug(`[provider] Gateway calling ${this.model} for ${input.task}`)
    
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
      const errorText = await response.text().catch(() => 'Could not read error body')
      console.error(`[provider] Gateway error ${response.status}: ${redactForLog(errorText)}`)
      throw new Error(`Model gateway returned ${response.status}`)
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const responseText = body.choices?.[0]?.message?.content ?? ''
    console.debug(`[provider] Raw response (${responseText.length} chars): ${redactForLog(responseText)}`)
    
    return {
      text: responseText,
      model: this.model,
    }
  }
}

class UnavailableProvider implements ModelProvider {
  readonly available = false
  async generate(): Promise<ModelOutput> {
    console.debug('[provider] UnavailableProvider: no model provider configured')
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
