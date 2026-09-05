/**
 * Landing page.
 *
 * Written for the person who just shipped something an agent wrote and does not
 * know whether it works. The argument, in order: here is the bug you would have
 * missed, here is the loop you run, here is what a run actually does, here is
 * the prompt you hand back to your agent, here is why you can believe it.
 *
 * Every screenshot is a capture of this product reporting a real run against
 * the bundled demo application. Nothing here is a mock of the interface, which
 * is the point: a page about proof should not be illustrated with drawings.
 *
 * Layout families deliberately differ per section so the page does not read as
 * a template: full-width capture, a horizontal flow, a stage rail, a wide
 * figure, a split, a pair.
 */
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowRightIcon } from "@phosphor-icons/react";
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
      <Loop/>
      <Run/>
      <Prompt/>
      <Proof/>
      <Boundaries/>
      <Close/>
      <Footer/>
    </>
  );
}

/**
 * A screenshot that belongs to whichever theme the visitor is reading in.
 *
 * Two files rather than one, because the captures are of a themed interface and
 * a light screenshot dropped into dark mode reads as a hole in the page. The
 * inactive one is `display: none` and lazily loaded, so browsers skip fetching
 * it: a themed pair costs about what a single screenshot costs.
 *
 * Intrinsic size is always declared. These are the tallest things on the page
 * and reserving their box is the difference between a page that settles and a
 * page that jumps while the captures arrive.
 */
function Shot({
                name,
                alt,
                width,
                height,
                eager,
              }: {
  name: string
  alt: string
  width: number
  height: number
  eager?: boolean
}) {
  const shared = {
    alt,
    width,
    height,
    decoding: "async" as const,
    className: "image-frame w-full rounded-xl",
  };

  return (
    <>
      <img
        {...shared}
        src={`/shots/${name}-light.webp`}
        className={`${shared.className} shot-light`}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
      />
      <img
        {...shared}
        src={`/shots/${name}-dark.webp`}
        className={`${shared.className} shot-dark`}
        loading="lazy"
      />
    </>
  );
}

/** A screenshot with the sentence that says what the reader is looking at. */
function Figure({
                  children,
                  caption,
                }: {
  children: React.ReactNode
  caption: React.ReactNode
}) {
  return (
    <figure className="m-0">
      {/*
        * A 1140px-wide capture squeezed into a 350px phone shows a reader
        * nothing: the type it is made of stops resolving well before the
        * viewport does. So below `sm` the capture keeps a legible width and
        * scrolls sideways in its own track, bleeding to the screen edges so
        * the overflow is visible rather than clipped at the column. The rest
        * of the page never scrolls sideways.
        */}
      <div
        className="scrollbar-thin -mx-5 overflow-x-auto px-5 pb-3 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
        <div className="min-w-[680px] sm:min-w-0">{children}</div>
      </div>
      <figcaption className="mt-3 max-w-[70ch] text-xs leading-relaxed text-kumo-subtle">
        {caption}
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------- hero */

function Hero() {
  return (
    <section className="grid-field relative border-b border-kumo-hairline">
      <div className="mx-auto max-w-295 px-5 pb-16 pt-20 lg:pt-24">
        <div className="enter">
          <h1
            className="m-0 max-w-[20ch] text-[2.6rem] leading-[1.05] font-semibold tracking-[-0.03em] text-kumo-strong sm:text-[3.5rem]">
            Your agent says it works.
            <br/>
            Forge <span className="text-forge-accent-strong">checks</span>.
          </h1>

          <p className="mt-6 max-w-[54ch] text-base leading-relaxed text-kumo-subtle">
            Give Forge the URL of your deployed app. It opens the app in a real
            browser, walks the paths your users actually take, and tells you what
            broke. Every bug comes back as a prompt you can hand straight to your
            coding agent.
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

        <div className="enter mt-14 [animation-delay:120ms]">
          <Figure
            caption={
              <>
                An actual finding from an actual run against the demo app.
                Forge reproduced the failure three times out of three, and left
                the root cause blank because the evidence did not establish one.
              </>
            }
          >
            <Shot
              name="hero"
              alt="A Forge finding titled 'Checkout with coupon failed', marked Critical and Confirmed bug, reproduced 3 of 3 attempts at confidence 0.99, with root cause not established."
              width={2200}
              height={505}
              eager
            />
          </Figure>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- loop */

const LOOP = [
  {
    title: "Give it a URL",
    body: "A deployed preview or staging URL is all it needs. Add a test login if your app keeps anything behind a sign-in.",
  },
  {
    title: "It uses your app",
    body: "A real browser doing real clicks, real typing, and real form submissions. Forge works out which journeys matter and runs them in order.",
  },
  {
    title: "You get a prompt",
    body: "Paste it into Claude Code, Cursor, or whatever you build with. The evidence travels with it, so your agent is not guessing either.",
  },
];

function Loop() {
  return (
    <section className="border-b border-kumo-hairline">
      <div className="mx-auto max-w-295 px-5 py-20">
        <div
          className="grid gap-10 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-start lg:gap-8">
          {LOOP.map(({ title, body }, i) => (
            <div key={title} className="contents">
              <div className="max-w-[38ch]">
                <h2
                  className="m-0 text-[1.35rem] font-semibold tracking-[-0.02em] text-kumo-strong">
                  {title}
                </h2>
                <p className="mt-2.5 text-sm leading-relaxed text-kumo-subtle">
                  {body}
                </p>
              </div>
              {i < LOOP.length - 1 ? (
                <div
                  aria-hidden
                  className="hidden self-center text-kumo-subtle lg:block"
                >
                  <ArrowRightIcon size={18}/>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- run */

const STAGES = [
  {
    phase: "Discover",
    body: "Forge reads your app and works out what people come to it for. Checkout. Sign up. Invite a teammate. It ranks them by what breaking them would cost you.",
  },
  {
    phase: "Execute",
    body: "It drives each journey by the name and role of the control, the way a screen reader finds things, not by pixel coordinates. The model decides what to try. Plain code does the clicking.",
  },
  {
    phase: "Reproduce",
    body: "A failure is run again up to three times before Forge believes it. Three out of three is a bug. One out of three is flaky, and the report says which one you have.",
  },
  {
    phase: "Judge",
    body: "Severity comes from what was measured, not from what the model felt. If the evidence does not establish a cause, Forge leaves the cause blank instead of inventing one.",
  },
];

function Run() {
  return (
    <section className="border-b border-kumo-hairline bg-kumo-recessed">
      <div className="mx-auto max-w-295 px-5 py-20">
        <h2
          className="m-0 max-w-[22ch] text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-kumo-strong">
          What happens when you press Run
        </h2>

        {/*
          * The four stages wear the run page's own phase rail: a filled rule
          * over the stage name. A visitor who signs up meets this exact shape
          * again at the top of a live run, which is the cheapest way to make
          * the marketing page and the product feel like one thing.
          */}
        <ol className="mt-10 grid list-none gap-x-8 gap-y-9 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map(({ phase, body }) => (
            <li key={phase}>
              <div className="h-0.5 w-full rounded-full bg-forge-accent"/>
              <h3 className="mb-2 mt-3 text-[15px] font-semibold text-kumo-strong">
                {phase}
              </h3>
              <p className="m-0 text-sm leading-relaxed text-kumo-subtle">
                {body}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-14">
          <Figure
            caption={
              <>
                Four journeys, discovered from the page itself and then driven
                one at a time. Every step records what it expected and what it
                actually got, so a failure is already half explained by the time
                you read it.
              </>
            }
          >
            <Shot
              name="journeys"
              alt="The Journeys section of a Forge run: 'Checkout with coupon', 'Invite teammate', 'View pricing' and 'Access dashboard', each with its priority and a log of OK and FAIL steps."
              width={2200}
              height={1449}
            />
          </Figure>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- prompt */

function Prompt() {
  return (
    <section className="border-b border-kumo-hairline">
      <div className="mx-auto max-w-295 px-5 py-20">
        <h2
          className="m-0 max-w-[24ch] text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-kumo-strong">
          It writes the prompt. You paste it.
        </h2>
        <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-kumo-subtle">
          A failing test tells you that something broke. Forge tells you what
          broke, where, and what it saw when it broke, in a brief your agent can
          act on. The journey, the failing step, the console errors, and the
          failed requests go in. Nothing else does, so nothing invented comes
          out.
        </p>

        <div className="mt-12">
          <Figure
            caption={
              <>
                The prompt Forge wrote for the finding at the top of this page.
                It is shown in full rather than hidden behind the button, because
                nobody should hand their agent a prompt they have not read.
              </>
            }
          >
            <Shot
              name="prompt"
              alt="A Forge fix prompt with a Copy prompt button, containing the journey, the entry path, what the run saw, and the numbered steps with their expected and actual results."
              width={2200}
              height={861}
            />
          </Figure>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ proof */

const PROOF = [
  {
    title: "It runs again before it believes itself",
    body: "Every failure is repeated up to three times. Three out of three is a bug. One out of three is flaky, and the report tells you which one you are looking at.",
  },
  {
    title: "The model does not get to set severity",
    body: "Severity and confidence come from what was measured. The model writes the explanation. It cannot talk the verdict up.",
  },
  {
    title: "Your bugs stay separate from the plumbing",
    body: "A timeout, a bot challenge, or a missing test account is not a defect in your code, and Forge does not file it as one.",
  },
];

function Proof() {
  return (
    <section className="border-b border-kumo-hairline bg-kumo-recessed">
      <div
        className="mx-auto grid max-w-295 items-start gap-x-14 gap-y-12 px-5 py-20 lg:grid-cols-[22rem_1fr]">
        <div>
          <h2
            className="m-0 max-w-[18ch] text-[1.75rem] leading-tight font-semibold tracking-[-0.02em] text-kumo-strong">
            It only reports what it can prove
          </h2>

          <dl className="m-0 mt-8">
            {PROOF.map(({ title, body }) => (
              <div
                key={title}
                className="border-t border-kumo-hairline py-5 first:border-t-0 first:pt-0"
              >
                <dt className="text-[15px] font-semibold text-kumo-strong">
                  {title}
                </dt>
                <dd
                  className="m-0 mt-1.5 max-w-[46ch] text-sm leading-relaxed text-kumo-subtle">
                  {body}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <Figure
          caption={
            <>
              The evidence behind one finding: what the browser had on screen
              when the checkout failed, plus the agent trace, the console
              errors, and the failed requests.
            </>
          }
        >
          <Shot
            name="evidence"
            alt="The Evidence section of a Forge finding: a browser screenshot of the demo app showing 'Something went wrong' with a TypeError in applyCoupon, alongside the agent trace, console errors, and network errors."
            width={2200}
            height={803}
          />
        </Figure>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- boundaries */

function Boundaries() {
  return (
    <section className="border-b border-kumo-hairline">
      <div className="mx-auto grid max-w-295 gap-12 px-5 py-20 lg:grid-cols-2">
        <div>
          <h2 className="m-0 text-[1.4rem] font-semibold tracking-[-0.02em] text-kumo-strong">
            A page cannot give Forge orders
          </h2>
          <p className="mt-3 max-w-[48ch] text-sm leading-relaxed text-kumo-subtle">
            Page content and repository files are things Forge saw, never
            instructions Forge follows. Tool permissions, run budgets, session
            cleanup, and access checks all live in application code, outside the
            model. A page that tries to hijack the agent can change what Forge
            reports. It cannot change what Forge is allowed to do.
          </p>
        </div>

        <div>
          <h2 className="m-0 text-[1.4rem] font-semibold tracking-[-0.02em] text-kumo-strong">
            Every run has a ceiling
          </h2>
          <p className="mt-3 max-w-[48ch] text-sm leading-relaxed text-kumo-subtle">
            Browser sessions cost money, so the limits are part of the design:
            a cap on journeys, on actions, on reproduction attempts, and on wall
            clock time. The session is released whether the run finishes, fails,
            or you stop it halfway through.
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
        <p className="mx-auto mt-3 max-w-[50ch] text-[15px] leading-relaxed text-kumo-subtle">
          Point Forge at the bundled demo app and watch it find the planted bugs
          live, the same way it found the one at the top of this page.
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

/* ----------------------------------------------------------------- footer */

/**
 * What Forge runs on, as links rather than as a list of nouns.
 *
 * Naming the stack and then making a reader search for it is the worst of both:
 * the credit is claimed and the reader is stranded. Each name goes to the page
 * that documents the thing Forge actually uses it for.
 */
const STACK = [
  { name: "Solari", href: "https://getsolari.com" },
  { name: "Workers", href: "https://workers.cloudflare.com" },
  { name: "D1", href: "https://developers.cloudflare.com/d1/" },
  { name: "R2", href: "https://developers.cloudflare.com/r2/" },
  {
    name: "Durable Objects",
    href: "https://developers.cloudflare.com/durable-objects/",
  },
  { name: "Workers AI", href: "https://developers.cloudflare.com/workers-ai/" },
  { name: "TanStack Start", href: "https://tanstack.com/start" },
];

function Footer() {
  return (
    <footer
      className="mx-auto flex max-w-295 flex-wrap items-center justify-between gap-x-8 gap-y-4 px-5 py-8 text-xs text-kumo-subtle">
      <span className="inline-flex items-center gap-2">
        <ForgeMark size={14}/>
        Forge
        <Link
          to="/docs/concepts"
          className="ml-2 text-kumo-subtle no-underline hover:text-kumo-strong"
        >
          Concepts
        </Link>
      </span>

      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        <span>Runs on</span>
        {STACK.map(({ name, href }, i) => (
          <span key={name} className="inline-flex items-center gap-1.5">
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-kumo-subtle underline decoration-kumo-hairline underline-offset-[0.2em] transition-colors hover:text-kumo-strong hover:decoration-current"
            >
              {name}
            </a>
            {i < STACK.length - 1 ? (
              <span aria-hidden className="text-kumo-subtle opacity-45">·</span>
            ) : null}
          </span>
        ))}
      </span>
    </footer>
  );
}
