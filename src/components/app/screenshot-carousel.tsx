/**
 * Screenshots, as a filmstrip with a viewer behind it.
 *
 * A run's screenshots are a sequence - entry page, then each journey's final
 * state - so they read as a strip you scroll along rather than a grid that
 * reflows. Opening one opens the viewer rather than the raw image endpoint:
 * the point of a screenshot is what it shows next to its label, and a browser
 * tab full of PNG with an opaque URL has lost both.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  CaretLeftIcon,
  CaretRightIcon,
  XIcon,
} from '@phosphor-icons/react'
import type { Evidence } from '#/server/contracts'

const source = (id: string) => `/api/evidence/${id}`

export function ScreenshotCarousel({ shots }: { shots: Evidence[] }) {
  const strip = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState<number | null>(null)

  /** Scrolls by roughly a card, so a click always moves a whole screenshot. */
  const scrollBy = (direction: 1 | -1) => {
    const el = strip.current
    if (!el) return
    el.scrollBy({ left: direction * (el.clientWidth * 0.8), behavior: 'smooth' })
  }

  if (shots.length === 0) return null

  return (
    <div className="relative">
      {shots.length > 1 ? (
        <>
          <StripButton side="left" onClick={() => scrollBy(-1)} />
          <StripButton side="right" onClick={() => scrollBy(1)} />
        </>
      ) : null}

      <ul
        ref={strip}
        className="scrollbar-thin m-0 flex list-none gap-3 overflow-x-auto p-0 pb-2"
      >
        {shots.map((shot, index) => (
          <li key={shot.id} className="w-[15rem] shrink-0 sm:w-[19rem]">
            <button
              type="button"
              onClick={() => setOpen(index)}
              className="block w-full cursor-pointer overflow-hidden rounded-lg border border-kumo-hairline bg-transparent p-0 text-left transition-colors hover:border-kumo-line"
            >
              <img
                src={source(shot.id)}
                alt={shot.label}
                loading="lazy"
                className="image-frame block aspect-[16/10] w-full bg-kumo-recessed object-cover object-top"
              />
              <span className="block truncate px-2.5 py-2 text-xs text-kumo-subtle">
                {shot.label}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {open !== null ? (
        <Lightbox
          shots={shots}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  )
}

function StripButton({
  side,
  onClick,
}: {
  side: 'left' | 'right'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={side === 'left' ? 'Scroll left' : 'Scroll right'}
      onClick={onClick}
      className={`absolute top-[35%] z-10 hidden size-8 cursor-pointer items-center justify-center rounded-full border border-kumo-hairline bg-kumo-base text-kumo-strong shadow-sm hover:bg-kumo-tint sm:flex ${
        side === 'left' ? '-left-3' : '-right-3'
      }`}
    >
      {side === 'left' ? <CaretLeftIcon size={14} /> : <CaretRightIcon size={14} />}
    </button>
  )
}

/**
 * The viewer.
 *
 * Its own element rather than a library: it needs a backdrop, arrow keys,
 * Escape, and a link to the raw artifact, and that is all it needs.
 */
function Lightbox({
  shots,
  index,
  onIndex,
  onClose,
}: {
  shots: Evidence[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
}) {
  const shot = shots[index]

  const step = useCallback(
    (direction: 1 | -1) => {
      // Wraps, so the arrows never dead-end on the first or last screenshot.
      onIndex((index + direction + shots.length) % shots.length)
    },
    [index, onIndex, shots.length],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') step(1)
      if (event.key === 'ArrowLeft') step(-1)
    }

    window.addEventListener('keydown', onKey)
    // The page behind must not scroll while the viewer is over it.
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose, step])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={shot.label}
      className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent p-1 text-sm text-white/80 hover:text-white"
        >
          <ArrowLeftIcon size={16} />
          Back
        </button>

        <span className="min-w-0 flex-1 truncate text-center text-sm">
          {shot.label}
        </span>

        <span className="tabular shrink-0 text-xs text-white/60">
          {index + 1} / {shots.length}
        </span>

        <a
          href={source(shot.id)}
          target="_blank"
          rel="noreferrer"
          aria-label="Open the full image"
          onClick={(event) => event.stopPropagation()}
          className="flex items-center p-1 text-white/80 no-underline hover:text-white"
        >
          <ArrowSquareOutIcon size={16} />
        </a>

        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="cursor-pointer rounded border-0 bg-transparent p-1 text-white/80 hover:text-white"
        >
          <XIcon size={18} />
        </button>
      </div>

      {/* Stops a click on the image itself from closing the viewer. */}
      <div
        className="flex min-h-0 flex-1 items-center justify-center gap-3 px-3 pb-6"
        onClick={(event) => event.stopPropagation()}
      >
        {shots.length > 1 ? (
          <ViewerArrow side="left" onClick={() => step(-1)} />
        ) : null}

        <img
          src={source(shot.id)}
          alt={shot.label}
          className="max-h-full max-w-full rounded-lg object-contain"
        />

        {shots.length > 1 ? (
          <ViewerArrow side="right" onClick={() => step(1)} />
        ) : null}
      </div>
    </div>
  )
}

function ViewerArrow({
  side,
  onClick,
}: {
  side: 'left' | 'right'
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={side === 'left' ? 'Previous screenshot' : 'Next screenshot'}
      onClick={onClick}
      className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 text-white hover:bg-white/20"
    >
      {side === 'left' ? <CaretLeftIcon size={18} /> : <CaretRightIcon size={18} />}
    </button>
  )
}
