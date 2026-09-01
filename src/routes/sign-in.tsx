/**
 * Sign in.
 *
 * Guest access is the primary path and sits above the fold: the fastest way to
 * evaluate Forge is to run it, not to fill in a form. An anonymous account is a
 * real account with real ownership, so everything downstream behaves
 * identically; the only difference is that it has no credentials to come back
 * with, which the page says plainly.
 */
import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import { ArrowRightIcon, UserCircleDashedIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { ForgeMark } from '#/components/app/shell'
import { ThemeToggle } from '#/components/theme'
import { authClient } from '#/lib/auth-client'

const searchSchema = z.object({
  /** Set when an anonymous session is being converted to a real account. */
  upgrade: z.boolean().optional(),
})

export const Route = createFileRoute('/sign-in')({
  validateSearch: searchSchema,
  beforeLoad: ({ context, search }) => {
    if (context.session.user && !search.upgrade) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: SignIn,
})

type Mode = 'sign-in' | 'sign-up'

function SignIn() {
  const router = useRouter()
  const { upgrade } = Route.useSearch()

  const [mode, setMode] = useState<Mode>(upgrade ? 'sign-up' : 'sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'guest' | 'credentials' | null>(null)

  async function afterAuth() {
    // The root route resolves the session in beforeLoad, so it has to re-run
    // before the dashboard will see the new user.
    await router.invalidate()
    await router.navigate({ to: '/dashboard' })
  }

  async function continueAsGuest() {
    setBusy('guest')
    setError(null)
    const { error: failure } = await authClient.signIn.anonymous()
    if (failure) {
      setError(failure.message ?? 'Could not start a guest session.')
      setBusy(null)
      return
    }
    await afterAuth()
  }

  async function submitCredentials(event: React.FormEvent) {
    event.preventDefault()
    setBusy('credentials')
    setError(null)

    const { error: failure } =
      mode === 'sign-up'
        ? await authClient.signUp.email({
            email,
            password,
            name: name.trim() || email.split('@')[0],
          })
        : await authClient.signIn.email({ email, password })

    if (failure) {
      setError(failure.message ?? 'Those credentials were not accepted.')
      setBusy(null)
      return
    }
    await afterAuth()
  }

  return (
    <div className="grid-field flex min-h-[100dvh] flex-col">
      <div className="flex items-center justify-between px-5 py-4">
        <a href="/" className="flex items-center gap-2 text-kumo-strong no-underline">
          <ForgeMark />
          <span className="text-[15px] font-semibold tracking-tight">Forge</span>
        </a>
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center px-5 pb-20">
        <div className="w-full max-w-[26rem]">
          <h1 className="m-0 text-2xl font-semibold tracking-tight text-kumo-strong">
            {upgrade ? 'Keep your work' : 'Verify your first app'}
          </h1>
          <p className="mb-8 mt-2 text-sm text-kumo-subtle">
            {upgrade
              ? 'Add an email and password to this session. Your projects and runs carry over.'
              : 'Start as a guest, or sign in to come back to your runs later.'}
          </p>

          {!upgrade ? (
            <>
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                loading={busy === 'guest'}
                disabled={busy !== null}
                onClick={continueAsGuest}
                icon={<UserCircleDashedIcon size={16} />}
              >
                Continue as guest
              </Button>
              <p className="mb-8 mt-2.5 text-xs text-kumo-subtle">
                A real account with no password. It works everywhere in Forge, but
                you cannot sign back into it once this browser forgets the session.
              </p>

              <div className="mb-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-kumo-hairline" />
                <span className="text-xs text-kumo-subtle">or use an email</span>
                <span className="h-px flex-1 bg-kumo-hairline" />
              </div>
            </>
          ) : null}

          <form onSubmit={submitCredentials} className="grid gap-4">
            {mode === 'sign-up' ? (
              <Input
                label="Name"
                autoComplete="name"
                placeholder="Ines Caetano"
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
              />
            ) : null}

            <Input
              label="Email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />

            <Input
              label="Password"
              type="password"
              required
              minLength={8}
              autoComplete={
                mode === 'sign-up' ? 'new-password' : 'current-password'
              }
              description={
                mode === 'sign-up' ? 'At least 8 characters.' : undefined
              }
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />

            {error ? (
              <p
                role="alert"
                className="m-0 rounded-lg border border-kumo-hairline bg-kumo-base px-3 py-2 text-sm text-[var(--forge-fail)]"
              >
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              variant={upgrade ? 'primary' : 'secondary'}
              size="lg"
              className="w-full"
              loading={busy === 'credentials'}
              disabled={busy !== null}
              icon={<ArrowRightIcon size={16} />}
            >
              {mode === 'sign-up' ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          {!upgrade ? (
            <p className="mt-5 text-center text-sm text-kumo-subtle">
              {mode === 'sign-up'
                ? 'Already have an account? '
                : 'No account yet? '}
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 font-medium text-kumo-link underline underline-offset-2"
                onClick={() => {
                  setMode(mode === 'sign-up' ? 'sign-in' : 'sign-up')
                  setError(null)
                }}
              >
                {mode === 'sign-up' ? 'Sign in' : 'Create one'}
              </button>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
