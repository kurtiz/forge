/**
 * Screenshots, as a filmstrip with a viewer behind it.
 *
 * A run's screenshots are a sequence - entry page, then each journey's final
 * state - so they read as a strip you scroll along rather than a grid that
 * reflows. Opening one opens the viewer rather than the raw image endpoint:
 * the point of a screenshot is what it shows next to its label, and a browser
 * tab full of PNG with an opaque URL has lost both.
 *
 * Both halves have to work under a finger as well as a cursor, which is most
 * of what is going on below: the strip takes a wheel, a drag, the arrows, and
 * the keyboard; the viewer takes a swipe, the arrows, and the keyboard.
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

  const scrollable = reach.left || reach.right

  return (
    /*
     * `min-w-0` is load-bearing. This sits in a grid, and a grid item's
     * automatic minimum size is its content's, which without this is the whole
     * unwrapped strip: the item grew past the column, the page scrolled
     * sideways instead of the strip, and the arrows had nothing to move.
     */
    <div className="relative min-w-0">
      {scrollable ? (
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
        tabIndex={0}
        aria-label={`${shots.length} screenshots`}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            scrollBy(1)
          }
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            scrollBy(-1)
          }
        }}
        // `snap-x` lands a card against the edge rather than half of one;
        // `overscroll-x-contain` stops a flick at the end of the strip from
        // turning into a browser back-swipe; `touch-pan-x` tells the compositor
        // this is a horizontal scroller before the first frame of a drag, which
        // is what stops a diagonal swipe being handed to the page instead.
        className="scrollbar-thin m-0 flex w-full max-w-full snap-x snap-mandatory list-none touch-pan-x gap-3 overflow-x-auto overscroll-x-contain p-0 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus/50"
      >
        {shots.map((shot, index) => (
          <li
            key={shot.id}
            className="w-[13rem] shrink-0 snap-start sm:w-[19rem]"
          >
            <button
              type="button"
              onClick={() => setOpen(index)}
              className="block w-full cursor-pointer overflow-hidden rounded-lg border border-kumo-hairline bg-transparent p-0 text-left transition-colors hover:border-kumo-line"
            >
              <img
                src={source(shot.id)}
                alt={shot.label}
                loading="lazy"
                draggable={false}
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
 *
 * It sits inside the strip on a narrow screen and outside it once there is
 * margin to hang it in. Outside is better - it never covers a screenshot - but
 * on a phone the gutter is five pixels of page padding, so outside means
 * clipped, which is how the strip ended up with no visible way forward.
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
      className={`absolute top-[32%] z-10 flex size-9 items-center justify-center rounded-full border border-kumo-hairline bg-kumo-base text-kumo-strong shadow-md transition-opacity sm:size-8 sm:shadow-sm ${
        disabled
          ? 'pointer-events-none cursor-default opacity-0'
          : 'cursor-pointer opacity-100 hover:bg-kumo-tint'
      } ${side === 'left' ? 'left-1.5 sm:-left-3' : 'right-1.5 sm:-right-3'}`}
    >
      {side === 'left' ? (
        <CaretLeftIcon size={16} />
      ) : (
        <CaretRightIcon size={16} />
      )}
    </button>
  )
}

/** Past this much horizontal travel, a drag is a swipe rather than a tap. */
const SWIPE_THRESHOLD = 56

/**
 * The viewer.
 *
 * Its own element rather than a library: it needs a backdrop, arrow keys,
 * Escape, a swipe, and a link to the raw artifact, and that is all it needs.
 *
 * The layout is one column at every width. What changes on a small screen is
 * where the arrows go: flanking the image is right when there is room beside
 * it and wrong on a phone, where the image is already the full width, so there
 * they overlay its edges instead.
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
  /** Horizontal travel of the swipe in progress, so the image tracks the finger. */
  const [drag, setDrag] = useState(0)
  const gesture = useRef<{ x: number; y: number; horizontal: boolean } | null>(
    null,
  )

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

  /*
   * Swipe.
   *
   * The first few pixels decide whether the gesture is horizontal. Until then
   * nothing moves and nothing is claimed, so a vertical drag on a tall
   * screenshot is still a vertical drag. Once it is horizontal the image
   * follows the finger, which is the whole difference between a viewer that
   * responds to a swipe and one that merely acts on it afterwards.
   */
  function onTouchStart(event: React.TouchEvent) {
    if (shots.length < 2 || event.touches.length !== 1) return
    const touch = event.touches[0]
    gesture.current = { x: touch.clientX, y: touch.clientY, horizontal: false }
  }

  function onTouchMove(event: React.TouchEvent) {
    const start = gesture.current
    if (!start || event.touches.length !== 1) return

    const touch = event.touches[0]
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y

    if (!start.horizontal) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
      if (Math.abs(dx) <= Math.abs(dy)) {
        gesture.current = null
        return
      }
      start.horizontal = true
    }

    setDrag(dx)
  }

  function onTouchEnd() {
    const start = gesture.current
    gesture.current = null
    if (start?.horizontal && Math.abs(drag) > SWIPE_THRESHOLD) {
      step(drag < 0 ? 1 : -1)
    }
    setDrag(0)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={shot.label}
      // `dvh` rather than `inset-0`: on a phone the browser chrome collapses as
      // you scroll, and a viewer sized to the static viewport put its controls
      // under the address bar.
      className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex shrink-0 items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 text-white sm:gap-3 sm:px-4 sm:py-3">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent p-2 text-sm text-white/80 hover:text-white"
        >
          <ArrowLeftIcon size={18} />
          <span className="hidden sm:inline">Back</span>
        </button>

        <span className="min-w-0 flex-1 truncate text-center text-xs sm:text-sm">
          {shot.label}
        </span>

        <span className="tabular shrink-0 px-1 text-xs text-white/60">
          {index + 1} / {shots.length}
        </span>

        <a
          href={source(shot.id)}
          target="_blank"
          rel="noreferrer"
          aria-label="Open the full image"
          onClick={(event) => event.stopPropagation()}
          className="flex shrink-0 items-center p-2 text-white/80 no-underline hover:text-white"
        >
          <ArrowSquareOutIcon size={18} />
        </a>

        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="shrink-0 cursor-pointer rounded border-0 bg-transparent p-2 text-white/80 hover:text-white"
        >
          <XIcon size={20} />
        </button>
      </div>

      {/* Stops a click on the image itself from closing the viewer. */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:gap-3 sm:px-3 sm:pb-6"
        onClick={(event) => event.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {shots.length > 1 ? <ViewerArrow side="left" onClick={() => step(-1)} /> : null}

        <img
          key={shot.id}
          src={source(shot.id)}
          alt={shot.label}
          draggable={false}
          style={
            drag
              ? { transform: `translateX(${drag}px)`, transition: 'none' }
              : undefined
          }
          className="max-h-full max-w-full touch-pan-y rounded-lg object-contain transition-transform duration-200 select-none"
        />

        {shots.length > 1 ? <ViewerArrow side="right" onClick={() => step(1)} /> : null}
      </div>
    </div>
  )
}

/**
 * A viewer arrow.
 *
 * Absolute at every width rather than a flex sibling: on a phone the image
 * takes the full width, so an arrow in the flow would squeeze it, and an arrow
 * over its edge costs nothing. On a wide screen the same position lands in the
 * empty space beside a portrait screenshot anyway.
 */
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
      className={`absolute top-1/2 z-10 flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-black/40 text-white backdrop-blur-sm hover:bg-white/25 sm:size-10 sm:bg-white/10 ${
        side === 'left' ? 'left-2 sm:left-3' : 'right-2 sm:right-3'
      }`}
    >
      {side === 'left' ? (
        <CaretLeftIcon size={20} />
      ) : (
        <CaretRightIcon size={20} />
      )}
    </button>
  )
}
