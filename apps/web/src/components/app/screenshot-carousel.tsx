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
import type { Evidence } from '@/server/contracts'

const source = (id: string) => `/api/evidence/${id}`

export function ScreenshotCarousel({ shots }: { shots: Evidence[] }) {
  const strip = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState<number | null>(null)
  /** Whether there is anything left to scroll to on each side. */
  const [reach, setReach] = useState({ left: false, right: false })

  /** Scrolls by roughly a card, so a click always moves a whole screenshot. */
  const scrollBy = useCallback((direction: 1 | -1) => {
    const el = strip.current
    if (!el) return
    el.scrollBy({ left: direction * (el.clientWidth * 0.8), behavior: 'smooth' })
  }, [])

  const measure = useCallback(() => {
    const el = strip.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    // A pixel of slack: fractional layout widths leave a sub-pixel remainder
    // at the end of the strip, which would otherwise keep the arrow lit
    // forever on a strip that has nowhere left to go.
    setReach({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 })
  }, [])

  /*
   * A horizontal strip on a desktop mouse.
   *
   * `overflow-x: auto` makes the strip scrollable in principle, but a wheel
   * only produces `deltaY`, so the filmstrip sat there refusing to move for
   * anyone without a trackpad. Translating the vertical wheel into horizontal
   * scroll is what makes it feel scrollable at all.
   *
   * The listener has to be non-passive to call `preventDefault`, which React's
   * `onWheel` cannot be, hence the manual registration. It only claims the
   * gesture while the strip can still move that way: at either end the event
   * is left alone so the wheel goes on scrolling the page, rather than the
   * strip swallowing it and trapping the reader mid-run.
   */
  useEffect(() => {
    const el = strip.current
    if (!el) return

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return // pinch-zoom
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY
      if (delta === 0) return

      const max = el.scrollWidth - el.clientWidth
      if (max <= 0) return
      const atEnd = delta > 0 ? el.scrollLeft >= max - 1 : el.scrollLeft <= 1
      if (atEnd) return

      event.preventDefault()
      el.scrollLeft += delta
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /* Arrow state follows the strip, the viewport, and the images as they load. */
  useEffect(() => {
    const el = strip.current
    if (!el) return

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    for (const child of Array.from(el.children)) observer.observe(child)

    return () => observer.disconnect()
  }, [measure, shots.length])

  if (shots.length === 0) return null

  return (
    <div className="relative">
      {shots.length > 1 ? (
        <>
          <StripButton
            side="left"
            disabled={!reach.left}
            onClick={() => scrollBy(-1)}
          />
          <StripButton
            side="right"
            disabled={!reach.right}
            onClick={() => scrollBy(1)}
          />
        </>
      ) : null}

      <ul
        ref={strip}
        onScroll={measure}
        // `snap-x` lands a card against the edge rather than half of one, and
        // `overscroll-x-contain` stops a flick at the end of the strip from
        // turning into a browser back-swipe.
        className="scrollbar-thin m-0 flex snap-x snap-mandatory list-none gap-3 overflow-x-auto overscroll-x-contain p-0 pb-2"
      >
        {shots.map((shot, index) => (
          <li key={shot.id} className="w-[15rem] shrink-0 snap-start sm:w-[19rem]">
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

/**
 * A strip arrow.
 *
 * Kept mounted and disabled at the ends rather than unmounted: a control that
 * appears and disappears under the cursor makes the strip feel like it is
 * moving on its own.
 */
function StripButton({
  side,
  disabled,
  onClick,
}: {
  side: 'left' | 'right'
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={side === 'left' ? 'Scroll left' : 'Scroll right'}
      disabled={disabled}
      onClick={onClick}
      className={`absolute top-[35%] z-10 hidden size-8 items-center justify-center rounded-full border border-kumo-hairline bg-kumo-base text-kumo-strong shadow-sm transition-opacity sm:flex ${
        disabled
          ? 'cursor-default opacity-0'
          : 'cursor-pointer opacity-100 hover:bg-kumo-tint'
      } ${side === 'left' ? '-left-3' : '-right-3'}`}
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
