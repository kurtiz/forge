/**
 * Theme control.
 *
 * Kumo's tokens resolve through `light-dark()`, driven by `color-scheme`, which
 * it switches on `data-mode="dark"`. The inline script below applies the stored
 * choice before first paint so there is no flash, and this component keeps the
 * attribute in sync afterwards.
 */
import { useEffect, useState } from 'react'
import { MonitorIcon, MoonIcon, SunIcon } from '@phosphor-icons/react'
import { Button } from '@cloudflare/kumo/components/button'

export type ThemeMode = 'light' | 'dark' | 'system'

export const THEME_INIT_SCRIPT = `(function(){try{
var m=localStorage.getItem('forge-theme');
if(m!=='light'&&m!=='dark'&&m!=='system')m='system';
var dark=m==='dark'||(m==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
var r=document.documentElement;
if(dark)r.setAttribute('data-mode','dark');else r.removeAttribute('data-mode');
r.style.colorScheme=dark?'dark':'light';
}catch(e){}})();`

function apply(mode: ThemeMode) {
  const dark =
    mode === 'dark' ||
    (mode === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)

  const root = document.documentElement
  if (dark) root.setAttribute('data-mode', 'dark')
  else root.removeAttribute('data-mode')
  root.style.colorScheme = dark ? 'dark' : 'light'
}

const NEXT: Record<ThemeMode, ThemeMode> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
}

const ICON = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonIcon,
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>('system')

  useEffect(() => {
    const stored = localStorage.getItem('forge-theme')
    const initial: ThemeMode =
      stored === 'light' || stored === 'dark' || stored === 'system'
        ? stored
        : 'system'
    setMode(initial)
    apply(initial)
  }, [])

  useEffect(() => {
    if (mode !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [mode])

  const Icon = ICON[mode]

  return (
    <Button
      variant="ghost"
      size="sm"
      shape="square"
      aria-label={`Theme: ${mode}. Switch to ${NEXT[mode]}.`}
      onClick={() => {
        const next = NEXT[mode]
        setMode(next)
        apply(next)
        localStorage.setItem('forge-theme', next)
      }}
    >
      <Icon size={15} />
    </Button>
  )
}
