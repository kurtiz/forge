/**
 * Landing page.
 *
 * The argument, in order: the problem is verification not generation, here is
 * what a run produces, here is how the machinery fits together, here is how to
 * start. Layout families deliberately differ per section so the page does not
 * read as a template.
 */
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  BracketsCurlyIcon,
  CameraIcon,
  CubeIcon,
  RepeatIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import { Button } from "@cloudflare/kumo/components/button";
import { ForgeMark, TopBar } from "@/components/app/shell";

export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => {
    // Signed-in visitors have no use for the pitch.
    if (context.session.user) throw redirect({ to: "/dashboard" });
  },
  component: Landing,
});

function Landing() {
  return (
    <>
      <TopBar
        user={null}
        right={
          <Link to="/sign-in" className="no-underline">
            <Button variant="primary" size="sm">
              Login
            </Button>
          </Link>
        }
      />
      <Hero/>
      <Evidence/>
      <Pipeline/>
      <Guarantees/>
      <Close/>
      <Footer/>
    </>
  );
}

/* ------------------------------------------------------------------- hero */

function Hero() {
  return (
    <section className="grid-field relative border-b border-kumo-hairline">
      <div
        className="mx-auto grid max-w-295 gap-12 px-5 pb-20 pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pt-24">
        <div className="enter">
          <p
            className="mb-5 inline-flex items-center gap-2 rounded-md border border-kumo-hairline bg-kumo-base px-2.5 py-1 text-xs font-medium text-kumo-subtle">
            <ForgeMark size={13}/>
            Evidence-first verification
          </p>

          <h1
            className="m-0 max-w-[15ch] text-[2.6rem] leading-[1.04] font-semibold tracking-[-0.03em] text-kumo-strong sm:text-[3.4rem]">
            AI writes the code.
            <br/>
            Forge <span className="text-forge-accent-strong">proves</span> it
            works.
          </h1>

          <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-kumo-subtle">
            Point Forge at a deployed URL. It runs the journeys that matter and
            reports only what it can prove.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/sign-in" className="no-underline">
              <Button variant="primary" size="lg">
                <span>Start verifying</span>
                <span><ArrowRightIcon size={16}/></span>
              </Button>
            </Link>
            <a href="/demo" className="no-underline">
              <Button variant="secondary" size="lg">
                Open the demo app
              </Button>
            </a>
          </div>
        </div>

        <FindingPreview/>
      </div>
    </section>
  );
}

/**
 * The hero visual is a real finding rendered by the same status components the
 * product uses, not a picture of one. Everything in it is data this app
 * genuinely produces against the bundled demo application.
 */
function FindingPreview() {
  return (
    <div
      className="enter overflow-hidden rounded-xl border border-kumo-hairline bg-kumo-base shadow-sm [animation-delay:120ms]">
      <div className="flex items-center gap-2 border-b border-kumo-hairline px-4 py-2.5">
        <span className="inline-block size-1.5 rounded-full bg-forge-fail"/>
        <span className="text-xs font-medium text-kumo-subtle">
          Finding · Northbeam checkout
        </span>
        <span className="tabular ml-auto text-xs text-kumo-subtle">3 / 3 reproduced</span>
      </div>

      <div className="px-4 py-4">
        <p className="m-0 text-[15px] font-semibold text-kumo-strong">
          Applying a coupon at checkout returns 500
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[
            ["Critical", "var(--forge-fail)"],
            ["Confirmed bug", "var(--forge-fail)"],
            ["Confidence 0.98", "var(--forge-idle)"],
          ].map(([label, color]) => (
            <span
              key={label}
              className="tabular inline-flex items-center gap-1.5 rounded-md border border-kumo-hairline px-2 py-0.5 text-xs"
              style={{ color }}
            >
              <span
                className="inline-block size-1.5 rounded-full"
                style={{ background: color }}
              />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="console px-4 py-3 font-mono text-[11.5px] leading-relaxed text-kumo-subtle">
        <div className="console-row py-1">
          <span className="text-kumo-strong">POST</span> /demo/checkout{" "}
          <span className="text-forge-fail">500</span>
        </div>
        <div className="console-row py-1">
          TypeError: Cannot read properties of undefined (reading 'amountOff')
        </div>
        <div className="console-row py-1">
          at applyCoupon (src/server/billing/coupons.ts:47)
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- evidence */

const EVIDENCE = [
  {
    icon: CameraIcon,
    title: "What the browser saw",
    body: "Screenshots, page state, console errors, and failed requests, captured at the step that broke.",
  },
  {
    icon: RepeatIcon,
    title: "How often it broke",
    body: "Every failure is re-run. Three of three is a bug. One of three is flaky, and the report says so.",
  },
  {
    icon: BracketsCurlyIcon,
    title: "What the agent did",
    body: "An auditable trace of observations, actions, and results. No hidden reasoning, no unexplained clicks.",
  },
];

function Evidence() {
  return (
    <section className="border-b border-kumo-hairline">
      <div className="mx-auto max-w-295 px-5 py-20">
        <h2
          className="m-0 max-w-[20ch] text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-kumo-strong">
          A failing test tells you something broke. Forge tells you what.
        </h2>
        <p className="mt-3 max-w-[54ch] text-[15px] text-kumo-subtle">
          Every finding carries the evidence that produced it. Nothing is reported
          on the model's word alone.
        </p>

        <div
          className="mt-12 grid gap-px overflow-hidden rounded-xl border border-kumo-hairline bg-kumo-hairline sm:grid-cols-[1.15fr_1fr_1fr]">
          {EVIDENCE.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-kumo-base p-6">
              <Icon size={20} className="text-forge-accent-strong"/>
              <h3 className="mb-1.5 mt-4 text-[15px] font-semibold text-kumo-strong">
                {title}
              </h3>
              <p className="m-0 text-sm leading-relaxed text-kumo-subtle">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- pipeline */

const PIPELINE = [
  {
    phase: "Discover",
    body: "The Explorer reads the entry page and names the journeys a real user would care about, ranked by what breaking them would cost.",
  },
  {
    phase: "Execute",
    body: "The Operator drives each journey by accessible name and role, not by coordinates. The model sets strategy; a deterministic executor does the clicking.",
  },
  {
    phase: "Reproduce",
    body: "A failure is re-run before it is believed. Infrastructure faults are classified out first so they never reach you as application defects.",
  },
  {
    phase: "Judge",
    body: "Severity and confidence come from measured reproduction, not from the model. The Judge writes the narrative; it cannot upgrade the verdict.",
  },
];

function Pipeline() {
  return (
    <section className="border-b border-kumo-hairline bg-kumo-recessed">
      <div className="mx-auto max-w-295 px-5 py-20">
        <h2 className="m-0 text-[1.75rem] font-semibold tracking-[-0.02em] text-kumo-strong">
          Four agents, one verdict
        </h2>

        <ol className="mt-10 grid list-none gap-x-8 gap-y-10 p-0 sm:grid-cols-2">
          {PIPELINE.map(({ phase, body }, i) => (
            <li key={phase} className="border-t border-kumo-hairline pt-5">
              <div className="flex items-baseline gap-3">
                <span className="tabular text-xs text-kumo-subtle">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="m-0 text-[15px] font-semibold text-kumo-strong">
                  {phase}
                </h3>
              </div>
              <p className="mt-2 max-w-[46ch] text-sm leading-relaxed text-kumo-subtle">
                {body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- guarantees */

function Guarantees() {
  return (
    <section className="border-b border-kumo-hairline">
      <div className="mx-auto grid max-w-295 gap-10 px-5 py-20 lg:grid-cols-2">
        <div>
          <ShieldCheckIcon size={22} className="text-forge-accent-strong"/>
          <h2 className="mb-3 mt-4 text-[1.4rem] font-semibold tracking-[-0.02em] text-kumo-strong">
            The agent proposes. Application code decides.
          </h2>
          <p className="m-0 max-w-[46ch] text-sm leading-relaxed text-kumo-subtle">
            Page content and repository files are treated as untrusted observation
            data, never as instruction. Tool permissions, run budgets, session
            cleanup, and authorization are enforced outside the model, so a
            prompt-injected page changes what Forge reports, not what it is
            allowed to do.
          </p>
        </div>

        <div>
          <CubeIcon size={22} className="text-forge-accent-strong"/>
          <h2 className="mb-3 mt-4 text-[1.4rem] font-semibold tracking-[-0.02em] text-kumo-strong">
            Every run is bounded
          </h2>
          <p className="m-0 max-w-[46ch] text-sm leading-relaxed text-kumo-subtle">
            Browser sessions are billable, so limits are part of the architecture:
            capped journeys, capped actions, capped reproduction attempts, capped
            wall clock. Sessions are released whether the run finishes, fails, or
            is canceled mid-flight.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ close */

function Close() {
  return (
    <section className="grid-field border-b border-kumo-hairline">
      <div className="mx-auto max-w-295 px-5 py-24 text-center">
        <h2 className="m-0 text-[2rem] font-semibold tracking-tight text-kumo-strong">
          Verify your first app in a minute
        </h2>
        <p className="mx-auto mt-3 max-w-[48ch] text-[15px] text-kumo-subtle">
          Point Forge at the bundled demo application and watch it find the
          seeded defects live.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/sign-in" className="no-underline">
            <Button variant="primary" size="lg">
              <span>Start verifying</span>
              <span><ArrowRightIcon size={16}/></span>
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer
      className="mx-auto flex max-w-295 flex-wrap items-center justify-between gap-4 px-5 py-8 text-xs text-kumo-subtle">
      <span className="inline-flex items-center gap-2">
        <ForgeMark size={14}/>
        Forge
      </span>
      <span>
        Solari browsers · Cloudflare Workers, D1, R2, Durable Objects · TanStack
        Start
      </span>
    </footer>
  );
}
