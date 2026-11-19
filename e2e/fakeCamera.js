/**
 * Fake camera for headless Chromium: the demo GS1 DataMatrix, rendered and
 * encoded as the Y4M clip Chromium plays through
 * `--use-file-for-fake-video-capture`. Shared by `screenshots.js` (the
 * scan-lot capture) and the accessibility spec (the scanner state).
 * Requires ffmpeg on PATH (the Playwright base image ships one).
 */
import { toBuffer } from 'bwip-js/node'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'


// The payload printed on the demo pack, byte-for-byte the shape
// `_gs1_payload` builds in `backend/apps/core/management/commands/seed.py`
// (that file is the source of truth — keep the GTIN in step with `_DEMO_GTIN`):
// AI 01 GTIN · AI 17 expiry YYMMDD · AI 10 batch, GS-terminated · AI 21 serial.
const GS = '\x1d'
const DEMO_GTIN = '09506000134376'
const DEMO_PAYLOAD = `01${DEMO_GTIN}17270930` + `10MET-A${GS}21A9F3K2M7QX`

/**
 * Render the demo DataMatrix and encode it as the Y4M clip Chromium plays
 * through `--use-file-for-fake-video-capture`, so the scanner scene has
 * something to look at in a headless container with no camera.
 *
 * The frame is deliberately modest: a box face on a neutral surface, the code
 * centred, two bars standing in for printing. Enough to read as "a code on a
 * medicine box" without pretending to be a photograph of a real product.
 *
 * Centred matters twice over — the reticle frames the middle of the viewport,
 * and the decoder only ever reads a square centre crop of the video.
 *
 * Returns the path of the generated `.y4m`, inside a container temp dir so no
 * binary ever lands in the repository.
 */
export async function buildFakeCameraVideo() {
  const dir = mkdtempSync(join(tmpdir(), 'nudge-cam-'))
  const codePath = join(dir, 'datamatrix.png')
  const videoPath = join(dir, 'camera.y4m')

  writeFileSync(
    codePath,
    await toBuffer({ bcid: 'datamatrix', text: DEMO_PAYLOAD, scale: 6, padding: 8, backgroundcolor: 'FFFFFF' }),
  )

  // 4:3 like the constraints the modal asks the camera for, so the centre
  // crop the decoder takes matches what a real phone would hand it.
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=0xC9C2B6:s=640x480:r=15:d=2',
    '-loop',
    '1',
    '-i',
    codePath,
    '-filter_complex',
    '[0:v]drawbox=x=95:y=45:w=450:h=390:color=0xF5F1E9:t=fill,' +
      'drawbox=x=95:y=45:w=450:h=390:color=0xACA294:t=3,' +
      'drawbox=x=140:y=372:w=170:h=7:color=0x8C8578:t=fill,' +
      'drawbox=x=140:y=392:w=110:h=7:color=0x8C8578:t=fill[bg];' +
      '[1:v]scale=215:215[dm];[bg][dm]overlay=(W-w)/2:(H-h)/2[v]',
    '-map',
    '[v]',
    '-t',
    '2',
    '-pix_fmt',
    'yuv420p',
    '-f',
    'yuv4mpegpipe',
    videoPath,
  ])

  return videoPath
}

/** Chromium flags that turn the clip into the camera and grant it without a prompt. */
export const fakeCameraArgs = (videoPath) => [
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=${videoPath}`,
  '--use-fake-ui-for-media-stream',
]
