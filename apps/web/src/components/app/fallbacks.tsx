/**
 * What the router shows when there is no page, or the page threw.
 *
 * The router had neither, so an unmatched URL and a failed loader both fell
 * through to TanStack's built-in output: unstyled, and in the error's case a
 * raw stack. These keep the chrome so a dead end still looks like the console,
 * and more importantly still has a way out of it.
 *
 * The error page shows `error.message` rather than a fixed apology. The server
 * errors that reach here are written as sentences meant for a person -- see
 * NotFoundError and ForbiddenError in src/server/runs/repository.ts -- so
 * replacing them with "something went wrong" would throw away the only useful
 * part. A `NotFoundError` is routed to the not-found page instead: a project
 * that was deleted is missing, not broken, and saying so is the difference
 * between a user who navigates away and one who files a bug.
 */
import { Link } from '@tanstack/react-router'
import {
  ArrowClockwiseIcon,
  SignpostIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Page, TopBar } from '@/components/app/shell'
import type { ErrorComponentProps } from '@tanstack/react-router'

/**
 * These render outside any route that resolved a session -- a 404 has no
 * matched route at all, and an error may be the root loader's -- so the bar is
 * always signed-out. It keeps the mark, the theme toggle, and a link home,
 * which is all a dead end needs.
 */
function Chrome({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopBar user={null} />
      <Page>
        <div className="mt-10">{children}</div>
      </Page>
    </>
  )
}

function HomeLink() {
  return (
    <Link to="/dashboard" className="no-underline">
      <Button variant="secondary">Go to dashboard</Button>
    </Link>
  )
}

export function NotFoundPage() {
  return (
    <Chrome>
      <Empty
        size="lg"
        icon={<SignpostIcon />}
        title="Page not found"
        description="That address does not match anything here. It may have been deleted, or the link may be wrong."
        contents={<HomeLink />}
      />
    </Chrome>
  )
}

export function ErrorPage({ error, reset }: ErrorComponentProps) {
  /* Thrown by assertProjectAccess and its siblings. The name survives the
     server-function boundary, where an `instanceof` check would not. */
  if (error.name === 'NotFoundError') return <NotFoundPage />

  return (
    <Chrome>
      <Empty
        size="lg"
        icon={<WarningCircleIcon />}
        title="Something went wrong"
        description={error.message || 'The page could not be loaded.'}
        contents={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="primary"
              icon={<ArrowClockwiseIcon size={16} />}
              /* `reset` retries the boundary without a round trip, but it is
                 absent on a server-rendered error -- which is most of them,
                 since these fail in a loader. Reloading is the same intent at a
                 coarser grain, and leaves the button meaning one thing. */
              onClick={() => (reset ? reset() : window.location.reload())}
            >
              Try again
            </Button>
            <HomeLink />
          </div>
        }
      />
    </Chrome>
  )
}
