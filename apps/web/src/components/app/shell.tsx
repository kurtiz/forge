/**
 * Application chrome.
 *
 * A single-line top bar and a contained page column. The console pages are
 * dense, so the shell stays out of the way: no sidebar, no breadcrumb trail
 * deeper than the object being viewed.
 */
import { createLink, Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { Button } from "@cloudflare/kumo/components/button";
import { AccountMenu } from "@/components/app/account-menu";
import { ThemeToggle } from "@/components/theme";
import type { SessionUser } from "@/server/auth";
import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

/**
 * The mark: an F, and a tick in the accent.
 *
 * The view box is not `0 0 24 24`. At 24 the tick's square cap ran a whole
 * unit past the right edge and the viewport clipped its tip flat, which is
 * invisible at 18px and unmistakable anywhere the mark is shown large. The box
 * below is 25 units square, positioned so the artwork - which spans x 2.8 to
 * 25.0 and y 2.8 to 21.2, caps included - sits centred inside it with nothing
 * touching an edge. The paths are untouched: the framing was the bug.
 */
export function ForgeMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="1.4 -0.5 25 25"
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
      <path d="M4 12h9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square"/>
      <path
        d="m15.5 15.5 2.8 2.8 5-5"
        stroke="var(--forge-accent)"
        strokeWidth="2.4"
        strokeLinecap="square"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TopBar({
                         user,
                         right,
                       }: {
  user: SessionUser | null
  right?: ReactNode
}) {
  return (
    <header
      className="sticky top-0 z-40 h-14 border-b border-kumo-hairline bg-kumo-base/85 backdrop-blur">
      <div className="mx-auto flex h-full max-w-[1180px] items-center gap-4 px-5">
        <Link
          to={user ? "/dashboard" : "/"}
          className="flex items-center gap-2 text-kumo-strong no-underline"
        >
          <ForgeMark/>
          <span className="text-[15px] font-semibold tracking-tight">Forge</span>
        </Link>

        {/*
          * Navigation, then actions.
          *
          * Docs is unconditional: the concepts page is the answer to "what is
          * this actually doing", which is a question people have before they
          * have an account, and it is the only route in the chrome that a
          * signed-out visitor can follow. It stays visible at every width
          * because, unlike Settings, there is no account menu behind it to
          * fall back to - a signed-out visitor has no menu at all.
          */}
        <nav className="ml-auto flex items-center gap-4 text-sm">
          <Link
            to="/docs/concepts"
            className="text-kumo-subtle no-underline hover:text-kumo-strong"
          >
            Docs
          </Link>
          {user && !user.isAnonymous ? (
            <Link
              to="/settings"
              className="hidden text-kumo-subtle no-underline hover:text-kumo-strong sm:inline"
            >
              Settings
            </Link>
          ) : null}
        </nav>

        <div className="flex items-center gap-2">
          {right}
          <ThemeToggle/>
          {user ? <AccountChip user={user}/> : null}
        </div>
      </div>
    </header>
  );
}

/**
 * The account corner.
 *
 * A guest keeps its "Save this session" prompt, because a guest account is one
 * cleared cookie from gone and that is worth saying in the chrome rather than
 * only in a menu. Everything else lives behind the avatar.
 */
function AccountChip({ user }: { user: SessionUser }) {
  return (
    <div className="flex items-center gap-2">
      {user.isAnonymous ? (
        <Link to="/sign-in" search={{ upgrade: true }} className="no-underline">
          <Button variant="secondary" size="sm" className="hit-44">
            Save this session
          </Button>
        </Link>
      ) : null}
      <AccountMenu user={user} />
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
      className={`mx-auto w-full px-5 pb-24 pt-8 ${wide ? "max-w-[1180px]" : "max-w-[880px]"}`}
    >
      {children}
    </main>
  );
}

/** Page header: title, optional description, optional actions on the right. */
/**
 * The way one level up, in `PageHeader`'s `above` slot.
 *
 * The label on its own is the name of the parent object, which reads as a
 * caption rather than as somewhere to go - a run page saying the project's name
 * above the title looks like it is telling you which project you are in, and it
 * is, but it is also the way out. The arrow is the part that says so.
 *
 * Built with `createLink` rather than wrapping `Link`, so `to` and `params`
 * keep the router's type inference at every call site. The arrow is hidden from
 * assistive technology: the label already names the destination, and "left
 * arrow Verification" names it worse.
 */
const BackAnchor = forwardRef<HTMLAnchorElement, ComponentPropsWithoutRef<"a">>(
  function BackAnchor({ children, className, ...props }, ref) {
    return (
      <a
        ref={ref}
        className={`inline-flex items-center gap-1.5 no-underline hover:text-kumo-strong ${className ?? ""}`}
        {...props}
      >
        <ArrowLeftIcon size={12} aria-hidden />
        {children}
      </a>
    );
  },
);

export const BackLink = createLink(BackAnchor);

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
  );
}

/**
 * A labelled section separated by a hairline rather than wrapped in a card.
 *
 * `help` sits against the title rather than in `meta`, because it explains the
 * section rather than measuring it, and a reader looking for "what is this"
 * looks at the heading.
 */
export function Section({
                          title,
                          meta,
                          help,
                          children,
                        }: {
  title: string
  meta?: ReactNode
  help?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="mt-10">
      <div
        className="mb-3 flex items-center justify-between gap-3 border-b border-kumo-hairline pb-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="m-0 text-sm font-semibold text-kumo-strong">{title}</h2>
          {help}
        </div>
        {meta ? (
          <div className="tabular shrink-0 text-xs text-kumo-subtle">{meta}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
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
  );
}
