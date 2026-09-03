/**
 * Confirmation dialogs.
 *
 * Six places in the console guarded a destructive action with the browser's
 * `confirm()`. It cannot be styled, cannot show that the work is in flight, and
 * looks like a phishing prompt sitting on top of an otherwise Kumo page — while
 * the one it guards is sometimes "delete this project and all of its runs".
 *
 * The awkward part of replacing it is that `confirm()` is an expression and a
 * dialog is a tree, so the naive port drags open state, a pending target, and
 * eight lines of JSX into every call site. A promise puts that back: one dialog
 * is mounted once, here, and `useConfirm()` hands out a function with the same
 * shape the call sites already had.
 *
 *     if (!(await confirm({ title: 'Revoke "ci"?' }))) return
 *
 * Being mounted once is also what keeps the dialog animating. Kumo's dialogs
 * animate on the `open` prop and cannot animate a subtree that unmounts, so the
 * request outlives its own dismissal: `open` goes false immediately, and the
 * text stays until the next call replaces it, rather than vanishing mid-fade.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import type { ReactNode } from 'react'

export type ConfirmOptions = {
  /** The question, as a heading. */
  title: string
  /** What the action costs, when that is not obvious from the title. */
  description?: string
  /** Label for the button that proceeds. */
  action?: string
  /** Label for the button that does not. */
  cancel?: string
  /**
   * Destructive by default: every caller today is a delete, a revoke, or a
   * disconnect, and that is the answer this component exists to make harder to
   * give by accident.
   */
  variant?: 'destructive' | 'primary'
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

/**
 * Returns a function that asks, and resolves to what the person chose.
 *
 * Anything other than pressing the action button resolves `false` -- cancel,
 * Escape, the close button. There is no rejection path, so a call site never
 * has to wrap this in a try to avoid an unhandled rejection on dismissal.
 */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext)
  if (!confirm) {
    throw new Error('useConfirm must be used inside <ConfirmProvider>.')
  }
  return confirm
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmOptions | null>(null)
  const [open, setOpen] = useState(false)

  /* Held rather than stored in state: resolving is not a render, and putting
     the resolver in state would make every dialog answer a second render. */
  const resolve = useRef<((result: boolean) => void) | null>(null)

  /**
   * Answers the outstanding question, once. Clearing the ref first is what
   * makes it idempotent, which it has to be: pressing a button closes the
   * dialog, and closing the dialog reports a dismissal, so both paths arrive
   * here for a single answer and the second must not overwrite the first.
   */
  const settle = useCallback((result: boolean) => {
    const pending = resolve.current
    resolve.current = null
    setOpen(false)
    pending?.(result)
  }, [])

  const confirm = useCallback<Confirm>((options) => {
    return new Promise<boolean>((resolvePromise) => {
      /* A second question while one is open would otherwise abandon the first
         promise unresolved, and whoever awaited it would hang for good. */
      resolve.current?.(false)
      resolve.current = resolvePromise
      setRequest(options)
      setOpen(true)
    })
  }, [])

  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}

      <Dialog.Root
        /*
         * Not `role="alertdialog"`, which is what this should be. Kumo 2.12.0
         * swaps the root for Base UI's AlertDialog when that role is set but
         * still renders the plain Dialog portal and popup inside it -- the
         * ternaries picking between them have the same component on both sides
         * -- so the two halves look for different contexts and the dialog never
         * appears at all. Verified in a browser: nothing is added to the DOM.
         * The default role works, and dismissing it is a cancel either way.
         */
        open={open}
        onOpenChange={(next) => {
          if (!next) settle(false)
        }}
      >
        <Dialog className="max-w-[26rem] p-6">
          <Dialog.Title>{request?.title}</Dialog.Title>
          {request?.description ? (
            <Dialog.Description className="mt-2 text-sm text-kumo-subtle">
              {request.description}
            </Dialog.Description>
          ) : null}

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => settle(false)}>
              {request?.cancel ?? 'Cancel'}
            </Button>
            <Button
              variant={request?.variant ?? 'destructive'}
              onClick={() => settle(true)}
            >
              {request?.action ?? 'Confirm'}
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </ConfirmContext.Provider>
  )
}
