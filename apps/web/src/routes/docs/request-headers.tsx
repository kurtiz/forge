/**
 * Request headers, explained.
 *
 * The page behind the help control on a project's Request headers section. It
 * answers the two questions the panel cannot answer in a paragraph: why a
 * header is the way past a bot challenge, and where the matching rule goes at
 * each service people actually use.
 *
 * It is a condensation of docs/bot-protection.md rather than a second source:
 * that file is the one an engineer reads in the repository, this is the one a
 * reader reaches from the console at the moment they are stuck. Both have to
 * say the same thing, and the rule shape is the part that must not drift.
 *
 * Open to signed-out visitors. Someone evaluating Forge against a target
 * behind Cloudflare hits this question before they have an account.
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  LockKeyIcon,
  ShieldWarningIcon,
  WarningIcon,
} from '@phosphor-icons/react'
import { Page, PageHeader, Section, TopBar } from '@/components/app/shell'

export const Route = createFileRoute('/docs/request-headers')({
  head: () => ({
    meta: [
      { title: 'Request headers · Forge' },
      {
        name: 'description',
        content:
          'Why a verification run carries request headers, how to let one past a bot challenge without weakening it for anyone else, and where the rule goes at each service.',
      },
    ],
  }),
  component: RequestHeadersDoc,
})

/** Where the rule goes, per service. The shape is identical; the menus differ. */
const SERVICES: { name: string; where: string; rule: string }[] = [
  {
    name: 'Cloudflare',
    where: 'Your zone, then Security, WAF, Custom rules.',
    rule: 'An expression matching the header name lowercased against the exact value, action Skip, ticking the components that issue the challenge, ordered above whatever is challenging. Plain Bot Fight Mode cannot be exempted by a custom rule: turn it off for the hostname or verify a different origin.',
  },
  {
    name: 'Cloudflare Access',
    where: 'A service token, rather than a WAF rule.',
    rule: 'Create the token and store both of its headers, CF-Access-Client-Id and CF-Access-Client-Secret. That is why the panel takes a list of pairs rather than one field.',
  },
  {
    name: 'Vercel',
    where:
      'Project, Settings, Deployment Protection, Protection Bypass for Automation.',
    rule: 'Vercel issues the secret. Store it under the name x-vercel-protection-bypass. There is no rule to write.',
  },
  {
    name: 'AWS WAF',
    where: 'Your web ACL, then Rules.',
    rule: 'A custom rule matching the single header against the exact value, action Allow, at a lower priority number than the bot-control rule so it runs first. Add an AND on Host if the ACL covers more than one hostname.',
  },
  {
    name: 'Fastly',
    where: 'The service configuration you deploy, not a one-off.',
    rule: 'A VCL snippet or Compute code that skips the bot-detection logic when the header equals the stored secret, placed before the check.',
  },
  {
    name: 'Akamai',
    where: 'Control Center, Security, your configuration, Bot Manager.',
    rule: 'An exception, or a bypass match target, for requests carrying the header.',
  },
  {
    name: 'Imperva',
    where: 'Cloud WAF console, your site, Security, Bot Access Control.',
    rule: 'An allow rule for requests carrying the header, above the challenge policy.',
  },
  {
    name: 'DataDome',
    where: 'Dashboard, Management, Custom rules.',
    rule: 'An allow rule matching the header, so those requests are never scored.',
  },
  {
    name: 'Netlify',
    where: 'Site-wide rather than rule-based.',
    rule: 'Use a branch deploy that is not password-protected, or, on plans with edge firewall rules, a rule matching the header. If neither is available, verify a preview origin instead.',
  },
  {
    name: 'reCAPTCHA and hCaptcha',
    where: 'Not an edge. Your own code renders the widget.',
    rule: 'There is no rule to write. Gate the widget on the verification header in preview environments only, never in production, and never remove it.',
  },
]

function RequestHeadersDoc() {
  const { session } = Route.useRouteContext()

  return (
    <>
      <TopBar user={session.user} />
      <Page>
        <PageHeader
          above={
            <Link
              to={session.user ? '/dashboard' : '/'}
              className="inline-flex items-center gap-1.5 text-xs text-kumo-subtle no-underline hover:text-kumo-strong"
            >
              <ArrowLeftIcon size={12} />
              {session.user ? 'Verification' : 'Forge'}
            </Link>
          }
          title="Request headers"
          description="Name and value pairs a run attaches to every request it makes to one project's target. They exist so a verifier can be let past a bot challenge or an access gate without that gate being weakened for anyone else."
        />

        <Section title="The problem they solve">
          <div className="grid max-w-[68ch] gap-4 text-sm leading-relaxed text-kumo-secondary">
            <p className="m-0">
              A run against a target behind Cloudflare, DataDome, or anything of
              that family does not fail. It succeeds at everything, against the
              wrong page.
            </p>
            <p className="m-0">
              The interstitial answers <strong>HTTP 200</strong>. It has a title,
              headings, and links. So the run explores it, discovers journeys
              from it, tries to drive them, finds no control because the widget
              lives in a cross-origin frame, and reports an application with
              nothing on it. Sign-in reports no password field at{' '}
              <code className="font-mono text-[0.9em]">/login</code>, which sends
              you to look at an authentication setup that was never the problem.
            </p>
            <p className="m-0">
              Every sentence in that report is about the interstitial, and none
              of it says the only true thing: Forge never saw the application.
              Forge detects this case and stops with one finding naming the
              service, classified as an environment problem so it reports without
              failing a pull request check.
            </p>
          </div>
        </Section>

        <Section title="The two ways through">
          <div className="grid gap-4 sm:grid-cols-2">
            <Route1 />
            <Route2 />
          </div>
        </Section>

        <Section title="Where the rule goes">
          <p className="mt-0 mb-5 max-w-[68ch] text-sm leading-relaxed text-kumo-secondary">
            The rule is the same shape everywhere:{' '}
            <strong className="text-kumo-strong">
              evaluated before whatever issues the challenge, matching a header
              name and its exact value, on that hostname only, skipping or
              allowing that challenge and nothing else.
            </strong>{' '}
            Menu labels move around; that shape does not. Prefer a change you
            keep in version control. Where a service only offers a dashboard,
            record the click path in your own runbook.
          </p>

          <ul className="m-0 list-none divide-y divide-kumo-hairline p-0">
            {SERVICES.map((service) => (
              <li key={service.name} className="grid gap-1 py-4 sm:grid-cols-[10rem_1fr] sm:gap-4">
                <div className="text-sm font-medium text-kumo-strong">
                  {service.name}
                </div>
                <div className="min-w-0">
                  <p className="m-0 text-sm leading-relaxed text-kumo-secondary">
                    {service.rule}
                  </p>
                  <p className="mt-1 mb-0 text-xs text-kumo-subtle">
                    {service.where}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Checking it worked">
          <p className="mt-0 mb-4 max-w-[68ch] text-sm leading-relaxed text-kumo-secondary">
            Two requests. The point is that the second one still fails.
          </p>
          <pre className="console m-0 overflow-x-auto rounded-lg px-4 py-3 font-mono text-xs leading-relaxed text-kumo-secondary">
            {`# With the header: your own HTML.
curl -sI https://app.example.com/ -H 'x-forge-verify: <secret>' | head -1

# Without it: still challenged.
curl -sI https://app.example.com/ | head -1`}
          </pre>
          <p className="mt-4 mb-0 max-w-[68ch] text-sm leading-relaxed text-kumo-secondary">
            Then run the verification again. A run that got through discovers
            journeys from your own pages instead of from the challenge screen,
            and that is the tell. If it is still blocked, in order of likelihood:
            the rule is evaluated after the one that challenges; it matches the
            name but not the value, or the other way round; the name in the
            expression is not lowercased where the vendor requires it; the
            challenge comes from a product that rule cannot skip; or the value
            here and the value in the rule have drifted.
          </p>
        </Section>

        <Section title="What Forge will not do">
          <div className="grid max-w-[68ch] gap-4 text-sm leading-relaxed text-kumo-secondary">
            <p className="m-0">
              Forge does not attempt to solve or evade a challenge. No solvers,
              no stealth flags, no user-agent spoofing:{' '}
              <code className="font-mono text-[0.9em]">User-Agent</code> is
              refused by name, and the fix instructions Forge generates forbid
              the agent reading them from trying either. A verification tool that
              taught itself to defeat bot protection would be a tool nobody could
              safely point at their own production site.
            </p>
            <p className="m-0">
              Two properties are enforced rather than advised. A header is
              attached only to requests whose scheme, host, and port match the
              project's target, because a target page is attacker-controlled and
              journeys follow the links they find. And nothing that disguises the
              client is allowed:{' '}
              <code className="font-mono text-[0.9em]">User-Agent</code>,{' '}
              <code className="font-mono text-[0.9em]">Host</code>,{' '}
              <code className="font-mono text-[0.9em]">Cookie</code>, the
              hop-by-hop set, and the{' '}
              <code className="font-mono text-[0.9em]">Sec-</code> and{' '}
              <code className="font-mono text-[0.9em]">Proxy-</code> prefixes are
              all refused, as is any value carrying a line break.
            </p>
          </div>
        </Section>

        <Section title="Treat the value as a credential">
          <ul className="m-0 grid max-w-[68ch] list-disc gap-2 pl-5 text-sm leading-relaxed text-kumo-secondary">
            <li>
              Rotate by pasting a new value over the old one under Request
              headers, then updating the rule. Runs pick up the new value
              immediately.
            </li>
            <li>
              Keep the rule scoped to the hostname under verification, and keep
              that hostname off production data where you can.
            </li>
            <li>
              If it leaks, whoever holds it can skip that challenge on that
              hostname and nothing more, provided the rule is scoped as above.
              Rotate and move on.
            </li>
            <li>
              Never key the rule on something a stranger can also send. A user
              agent, a path, or an IP range you do not control is not a secret.
            </li>
          </ul>
        </Section>

        <Section title="Other uses">
          <div className="grid max-w-[68ch] gap-4 text-sm leading-relaxed text-kumo-secondary">
            <p className="m-0">
              The bot challenge is the reason the feature exists, but anything
              your target decides on a request header works the same way: a
              preview deployment behind password protection that accepts a bypass
              token, an API gateway that wants a key, a feature flag or tenant
              header that puts the application into the state you want verified,
              a header your own middleware reads to pick a seeded test dataset.
            </p>
            <p className="m-0">
              The rule for all of them is the same. It has to be something the
              target already understands, it is stored encrypted and never read
              back, and it goes only to the project's own origin.
            </p>
          </div>
        </Section>
      </Page>
    </>
  )
}

function Route1() {
  return (
    <div className="rounded-lg border border-kumo-hairline p-4">
      <div className="mb-2 flex items-center gap-2">
        <ShieldWarningIcon size={16} className="text-forge-pass" />
        <h3 className="m-0 text-sm font-semibold text-kumo-strong">
          Verify an origin that does not challenge
        </h3>
      </div>
      <p className="m-0 text-sm leading-relaxed text-kumo-secondary">
        The cheapest fix, and the one to prefer. Point the project at a preview
        or staging hostname with no bot protection. No rule to write, nothing
        relaxed, production untouched. Weigh this before the other one.
      </p>
    </div>
  )
}

function Route2() {
  return (
    <div className="rounded-lg border border-kumo-hairline p-4">
      <div className="mb-2 flex items-center gap-2">
        <LockKeyIcon size={16} className="text-forge-accent" />
        <h3 className="m-0 text-sm font-semibold text-kumo-strong">
          Open a door only Forge can walk through
        </h3>
      </div>
      <p className="m-0 text-sm leading-relaxed text-kumo-secondary">
        Store a secret as a request header, then write one rule at your edge that
        lets requests carrying it past the challenge. Everyone else still meets
        it. The panel can generate the secret for you, and shows it once so you
        can paste it into the rule.
      </p>
      <p className="mt-3 mb-0 flex items-start gap-1.5 text-xs leading-relaxed text-kumo-subtle">
        <WarningIcon size={13} className="mt-0.5 shrink-0" />
        Values are encrypted at rest, decrypted only inside the run, registered
        for redaction before the first request, and never returned by the API.
      </p>
    </div>
  )
}
