/**
 * Application chrome.
 *
 * A single-line top bar and a contained page column. The console pages are
 * dense, so the shell stays out of the way: no sidebar, no breadcrumb trail
 * deeper than the object being viewed.
 */
import { Link } from '@tanstack/react-router'
import { Button } from '@cloudflare/kumo/components/button'
import { ThemeToggle } from '#/components/theme'
import type { SessionUser } from '#/server/auth'
import type { ReactNode } from "react";

export function ForgeMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <path
        d="M4 20V4h13"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="square"
      />
      <path d="M4 12h9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" />
      <path
        d="m15.5 15.5 2.8 2.8 5-5"
        stroke="var(--forge-accent)"
        strokeWidth="2.4"
        strokeLinecap="square"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function TopBar({
  user,
  right,
}: {
  user: SessionUser | null
  right?: ReactNode
}) {
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-kumo-hairline bg-kumo-base/85 backdrop-blur">
      <div className="mx-auto flex h-full max-w-[1180px] items-center gap-4 px-5">
        <Link
          to={user ? '/dashboard' : '/'}
          className="flex items-center gap-2 text-kumo-strong no-underline"
        >
          <ForgeMark />
          <span className="text-[15px] font-semibold tracking-tight">Forge</span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          {right}
          <ThemeToggle />
          {user ? <AccountChip user={user} /> : null}
        </div>
      </div>
    </header>
  )
}

function AccountChip({ user }: { user: SessionUser }) {
  return (
    <div className="flex items-center gap-2">
      {user.isAnonymous ? (
        <Link to="/sign-in" search={{ upgrade: true }} className="no-underline">
          <Button variant="secondary" size="sm" className="hit-44">
            Save this session
          </Button>
        </Link>
      ) : (
        <span className="hidden text-sm text-kumo-subtle sm:inline">
          {user.email}
        </span>
      )}
      <form method="post" action="/api/auth/sign-out">
        <Button variant="ghost" size="sm" type="submit" className="hit-44">
          Sign out
        </Button>
      </form>
    </div>
  )
}

export function Page({
  children,
  wide,
}: {
  children: ReactNode
  wide?: boolean
}) {
  return (
    <main
      className={`mx-auto w-full px-5 pb-24 pt-8 ${wide ? 'max-w-[1180px]' : 'max-w-[880px]'}`}
    >
      {children}
    </main>
  )
}

/** Page header: title, optional description, optional actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  above,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  above?: ReactNode
}) {
  return (
    <div className="mb-7">
      {above ? <div className="mb-3">{above}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-2xl font-semibold tracking-tight text-kumo-strong">
            {title}
          </h1>
          {description ? (
            <div className="mt-1.5 max-w-[62ch] text-sm text-kumo-subtle">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  )
}

/** A labelled section separated by a hairline rather than wrapped in a card. */
export function Section({
  title,
  meta,
  children,
}: {
  title: string
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-kumo-hairline pb-2">
        <h2 className="m-0 text-sm font-semibold text-kumo-strong">{title}</h2>
        {meta ? (
          <div className="tabular text-xs text-kumo-subtle">{meta}</div>
        ) : null}
      </div>
      {children}
    </section>
  )
}

/** A single measured number. Deliberately not a card. */
export function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: string
}) {
  return (
    <div>
      <div className="text-xs text-kumo-subtle">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold tracking-tight text-kumo-strong">
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-kumo-subtle">{hint}</div> : null}
    </div>
  )
}
