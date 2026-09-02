/**
 * The account menu.
 *
 * An avatar in the top bar, and behind it who you are signed in as and the two
 * things you can do about it. Sign-out asks first: it is one click from every
 * page in the product, and for a guest it is not reversible - the session is
 * the only way back into that account.
 */
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { GearIcon, SignOutIcon, UserIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { DropdownMenu } from '@cloudflare/kumo/components/dropdown'
import { authClient } from '#/lib/auth-client'
import type { SessionUser } from '#/server/auth'

/**
 * Up to two letters from whatever the account has a name for.
 *
 * A guest has a generated email and the name "Anonymous", so the initial is
 * uninformative but stable, and the menu behind it says plainly what kind of
 * account this is.
 */
export function initialsFor(user: { name: string; email: string }): string {
  const source = user.name.trim() || user.email.trim()
  const words = source.split(/[\s@._-]+/).filter(Boolean)

  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export function Avatar({
  user,
  size = 32,
}: {
  user: { name: string; email: string; image?: string | null }
  size?: number
}) {
  if (user.image) {
    return (
      <img
        src={user.image}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
      />
    )
  }

  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-kumo-recessed font-medium text-kumo-strong"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initialsFor(user)}
    </span>
  )
}

export function AccountMenu({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  /**
   * Signs out, then invalidates the router before navigating. The session is
   * resolved in the root route's `beforeLoad` and cached with it, so without
   * the invalidation the app keeps rendering the signed-in chrome until
   * something else forces a reload.
   */
  async function signOut() {
    setSigningOut(true)
    try {
      await authClient.signOut()
      await router.invalidate()
      await router.navigate({ to: '/' })
    } finally {
      setSigningOut(false)
      setConfirming(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenu.Trigger
          aria-label="Account"
          className="cursor-pointer rounded-full border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--forge-accent)]"
        >
          <Avatar user={user} />
        </DropdownMenu.Trigger>

        <DropdownMenu.Content className="min-w-[15rem]">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Avatar user={user} size={36} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-kumo-strong">
                {user.isAnonymous ? 'Guest session' : user.name}
              </div>
              <div className="truncate text-xs text-kumo-subtle">
                {user.isAnonymous ? 'No password, no way back' : user.email}
              </div>
            </div>
          </div>

          <DropdownMenu.Separator />

          <DropdownMenu.LinkItem href="/profile" icon={UserIcon}>
            Profile
          </DropdownMenu.LinkItem>

          {!user.isAnonymous ? (
            <DropdownMenu.LinkItem href="/settings" icon={GearIcon}>
              Settings
            </DropdownMenu.LinkItem>
          ) : null}

          <DropdownMenu.Separator />

          <DropdownMenu.Item
            variant="danger"
            icon={SignOutIcon}
            onClick={() => setConfirming(true)}
          >
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>

      <Dialog.Root open={confirming} onOpenChange={setConfirming}>
        <Dialog className="max-w-[26rem] p-6">
          <Dialog.Title>Sign out?</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-kumo-subtle">
            {user.isAnonymous
              ? 'This is a guest session with no password. Signing out ends it for good, and its projects and runs go with it.'
              : `You will be signed out of ${user.email} on this device.`}
          </Dialog.Description>

          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close
              render={(props) => (
                <Button {...props} variant="secondary">
                  Stay signed in
                </Button>
              )}
            />
            <Button variant="destructive" loading={signingOut} onClick={signOut}>
              Sign out
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </>
  )
}
