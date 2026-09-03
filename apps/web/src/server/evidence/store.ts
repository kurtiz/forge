/**
 * Evidence store.
 *
 * Artifacts go to R2 under a run-scoped key prefix; D1 holds only the key and
 * metadata. Access is always brokered through the API so ownership is checked
 * on every read - R2 objects are never made public.
 */
import { env } from 'cloudflare:workers'
import { asc, eq } from 'drizzle-orm'
import { db, newId, nowIso, parseJson, tables } from "@/server/db"
import type { Evidence, EvidenceKind, JsonValue } from "@/server/contracts"

/** Default artifact lifetime. Recordings are heavy and rarely read after a week. */
const RETENTION_DAYS = 14

export type EvidenceInput = {
  runId: string
  findingId?: string | null
  journeyId?: string | null
  kind: EvidenceKind
  label: string
  metadata?: Record<string, JsonValue>
  body?: { bytes: Uint8Array | string; contentType: string }
}

type EvidenceRow = typeof tables.evidence.$inferSelect

function storageKey(runId: string, kind: EvidenceKind, id: string, ext: string) {
  return `runs/${runId}/${kind}/${id}.${ext}`
}

function extensionFor(contentType: string): string {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('jpeg')) return 'jpg'
  if (contentType.includes('json')) return 'json'
  if (contentType.includes('html')) return 'html'
  return 'txt'
}

function toEvidence(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    runId: row.runId,
    findingId: row.findingId,
    journeyId: row.journeyId,
    kind: row.kind,
    label: row.label,
    storageKey: row.storageKey,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    metadata: parseJson<Record<string, JsonValue>>(row.metadata, {}),
    createdAt: row.createdAt,
  }
}

export async function recordEvidence(input: EvidenceInput): Promise<Evidence> {
  const id = newId('ev')

  let key: string | null = null
  let contentType: string | null = null
  let sizeBytes: number | null = null

  if (input.body) {
    contentType = input.body.contentType
    key = storageKey(input.runId, input.kind, id, extensionFor(contentType))
    const bytes =
      typeof input.body.bytes === 'string'
        ? new TextEncoder().encode(input.body.bytes)
        : input.body.bytes
    sizeBytes = bytes.byteLength

    // R2 first: a metadata row pointing at an object that does not exist is
    // worse than an orphaned object, which retention will sweep up.
    await env.EVIDENCE.put(key, bytes, {
      httpMetadata: { contentType },
      customMetadata: { runId: input.runId },
    })
  }

  const [row] = await db()
    .insert(tables.evidence)
    .values({
      id,
      runId: input.runId,
      findingId: input.findingId ?? null,
      journeyId: input.journeyId ?? null,
      kind: input.kind,
      label: input.label,
      storageKey: key,
      contentType,
      sizeBytes,
      metadata: JSON.stringify(input.metadata ?? {}),
      expiresAt: new Date(
        Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
      createdAt: nowIso(),
    })
    .returning()

  return toEvidence(row)
}

export async function listRunEvidence(runId: string): Promise<Evidence[]> {
  const rows = await db()
    .select()
    .from(tables.evidence)
    .where(eq(tables.evidence.runId, runId))
    .orderBy(asc(tables.evidence.createdAt), asc(tables.evidence.id))

  return rows.map(toEvidence)
}

export async function getEvidence(id: string): Promise<Evidence | null> {
  const [row] = await db()
    .select()
    .from(tables.evidence)
    .where(eq(tables.evidence.id, id))
    .limit(1)

  return row ? toEvidence(row) : null
}

export async function readArtifact(key: string): Promise<R2ObjectBody | null> {
  return env.EVIDENCE.get(key)
}

export { linkJourneyEvidence as linkEvidenceToFinding } from '@/server/runs/repository'
