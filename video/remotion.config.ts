/**
 * Render settings.
 *
 * CRF 17 and the slow preset because this is a 60-second file that will be
 * uploaded once and watched on a large screen: the render cost is paid by the
 * machine, the quality is paid for by every viewer. `x264` rather than the
 * default so the output plays everywhere without a re-encode.
 */
import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
Config.setJpegQuality(95)
Config.setCodec('h264')
Config.setCrf(17)
Config.setPixelFormat('yuv420p')
Config.setChromiumOpenGlRenderer('angle')
Config.setEntryPoint('src/index.ts')
Config.setOverwriteOutput(true)
