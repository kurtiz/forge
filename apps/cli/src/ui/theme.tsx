/**
 * The shared vocabulary of the terminal UI.
 *
 * One place for the colours and glyphs so a passing journey is the same green
 * in the live panel, the final report, and the project list.
 */
import { useEffect, useState } from 'react'
import { Text } from 'ink'
import type { Tone } from '../summary.js'

export const COLOR: Record<Tone, string> = {
  pass: 'green',
  fail: 'red',
  warn: 'yellow',
  info: 'cyan',
}

export const GLYPH: Record<Tone, string> = {
  pass: '✓',
  fail: '✗',
  warn: '!',
  info: '›',
}

export function Icon({ tone }: { tone: Tone }) {
  return <Text color={COLOR[tone]}>{GLYPH[tone]}</Text>
}

/**
 * Severity as a filled badge rather than a coloured word.
 *
 * A finding is the thing someone is looking for when they scan the output, and
 * a block of colour is findable at a glance in a way that a word is not.
 */
export function Severity({ level }: { level: string }) {
  const background =
    level === 'critical' || level === 'high'
      ? 'red'
      : level === 'medium'
        ? 'yellow'
        : 'gray'
  const color = background === 'yellow' ? 'black' : 'white'
  return (
    <Text backgroundColor={background} color={color} bold>
      {` ${level.toUpperCase()} `}
    </Text>
  )
}

/**
 * A bar that fills as journeys finish.
 *
 * Written with two block characters rather than a library: it is six lines,
 * and a progress bar is not worth a dependency.
 */
export function Bar({
  done,
  total,
  width = 24,
}: {
  done: number
  total: number
  width?: number
}) {
  const ratio = total > 0 ? Math.min(done / total, 1) : 0
  const filled = Math.round(ratio * width)
  return (
    <Text>
      <Text color="cyan">{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(width - filled)}</Text>
    </Text>
  )
}

/** Braille spinner frames, the usual ten. */
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export function Spinner() {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((previous) => (previous + 1) % FRAMES.length)
    }, 80)
    return () => clearInterval(timer)
  }, [])

  return <Text color="cyan">{FRAMES[frame]}</Text>
}

/** mm:ss since the run started, so a long run visibly stays alive. */
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return <Text dimColor>{`${mm}:${ss}`}</Text>
}
