/**
 * Composition registry.
 *
 * Three cuts over one set of scenes. 1920×1080 at 30fps: 30 rather than 60
 * because nothing in the film is fast enough to need it, and the render loop
 * that scene work depends on is twice as quick at 30.
 */
import { Composition } from 'remotion'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import { ForgeTrailer, TRAILER_FRAMES } from './compositions/Trailer'
import {
  ForgeSocial30,
  SOCIAL_30_FRAMES,
  ForgeHook15,
  HOOK_15_FRAMES,
} from './compositions/Cuts'
import { FPS } from './motion'

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="ForgeTrailer"
        component={ForgeTrailer}
        durationInFrames={TRAILER_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="ForgeSocial30"
        component={ForgeSocial30}
        durationInFrames={SOCIAL_30_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="ForgeHook15"
        component={ForgeHook15}
        durationInFrames={HOOK_15_FRAMES}
        fps={FPS}
        width={1920}
        height={1080}
      />
    </>
  )
}
