/**
 * The set of clients watching a run live.
 *
 * Split out of `RunSessionDO` because it is where a run can quietly die, and
 * because it holds no Workers runtime imports it can be tested directly.
 *
 * The rule this exists to enforce: a watcher can never block the run.
 *
 * An SSE frame is written to a `TransformStream` whose readable side is the
 * HTTP response body. Those streams apply backpressure from the very first
 * chunk, so `writer.write()` on a stream nobody is reading returns a promise
 * that never settles. A client that goes away without the runtime noticing (a
 * navigation, a sleeping laptop, a dropped mobile connection, a proxy that
 * holds the socket open) leaves exactly such a stream behind. Awaiting that
 * write in the engine's event path froze runs mid-flight: the finding was
 * already written to D1, the run never reached a terminal state, and the
 * billable browser session stayed open until its own timeout expired.
 *
 * So every write is raced against a deadline and every watcher is written to
 * concurrently. A watcher that misses the deadline is dropped and aborted,
 * which ends its response; browsers reconnect an `EventSource` on their own,
 * and the reconnected client gets the full timeline from the page loader.
 * Falling behind costs a viewer their live connection, never the run.
 */

/**
 * How long one watcher may take to accept one frame.
 *
 * Frames are a few hundred bytes and a healthy client takes microseconds. This
 * is sized for a genuinely slow link rather than for a stalled one, and it is
 * paid at most once per watcher because a watcher that misses it is dropped.
 */
const WRITE_TIMEOUT_MS = 5_000

type Writer = WritableStreamDefaultWriter<Uint8Array>

/** Resolves `true` when the write lands, `false` when it stalls or fails. */
async function writeWithin(
  writer: Writer,
  frame: Uint8Array,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const stalled = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })

  // The rejection is handled here rather than left to the race: once the race
  // has been settled by `stalled`, an unhandled rejection from the abandoned
  // write would otherwise surface as an unrelated error later in the run.
  const wrote = writer.write(frame).then(
    () => true,
    () => false,
  )

  try {
    return await Promise.race([wrote, stalled])
  } finally {
    clearTimeout(timer)
  }
}

export class RunWatchers {
  private readonly writers = new Set<Writer>()

  constructor(private readonly timeoutMs: number = WRITE_TIMEOUT_MS) {}

  get size(): number {
    return this.writers.size
  }

  add(writer: Writer): void {
    this.writers.add(writer)
  }

  /**
   * Drops a watcher and ends its response.
   *
   * `abort` is not awaited: a stream that will not accept a write is not
   * guaranteed to settle an abort either, and this is called from the path
   * that must not block.
   */
  private drop(writer: Writer): void {
    this.writers.delete(writer)
    void writer.abort().catch(() => undefined)
  }

  /**
   * Sends one frame to every watcher.
   *
   * Concurrent rather than sequential, so one slow client cannot make every
   * other client wait, and so the whole fan-out costs one deadline rather than
   * one deadline per watcher.
   */
  async broadcast(frame: Uint8Array): Promise<void> {
    if (this.writers.size === 0) return

    const targets = [...this.writers]
    const results = await Promise.all(
      targets.map((writer) => writeWithin(writer, frame, this.timeoutMs)),
    )

    results.forEach((delivered, i) => {
      if (!delivered) this.drop(targets[i])
    })
  }

  /**
   * Ends every stream, telling clients the run is over first.
   *
   * Under the same deadline as `broadcast`: this runs in the Durable Object's
   * `finally`, and a watcher that has already stopped reading must not be able
   * to hold the object open after the run it belongs to has finished.
   */
  async closeAll(frame: Uint8Array): Promise<void> {
    const targets = [...this.writers]
    this.writers.clear()

    await Promise.all(
      targets.map(async (writer) => {
        const delivered = await writeWithin(writer, frame, this.timeoutMs)
        if (!delivered) {
          void writer.abort().catch(() => undefined)
          return
        }
        await Promise.race([
          writer.close().catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, this.timeoutMs)),
        ])
      }),
    )
  }
}
