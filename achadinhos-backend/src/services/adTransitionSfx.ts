import type { AdProjectConfig } from '@/dtos/adProject'
import { runProcess } from '@/services/AdMediaService'

export function sfxFilter(
  preset: AdProjectConfig['transition']['sfx'],
  volume: number,
  delaySeconds: number,
  label: string,
): string {
  const delay = Math.round(delaySeconds * 1000)
  // FFmpeg's sine source peaks at 0.125 and the filtered noise source is
  // quieter still. Calibrate the user-facing 0..0.5 control so its default is
  // audible beside a music track while retaining headroom before the limiter.
  const gain = Math.min(4, volume * 8).toFixed(3)
  if (preset === 'whoosh') {
    return `anoisesrc=color=pink:seed=42:amplitude=0.35:duration=0.32:sample_rate=48000,highpass=f=700,lowpass=f=6500,afade=t=in:st=0:d=0.04,afade=t=out:st=0.12:d=0.2,volume=${gain},adelay=${delay}:all=1[${label}]`
  }
  if (preset === 'pop') {
    return `sine=frequency=210:duration=0.14:sample_rate=48000,afade=t=out:st=0.025:d=0.115,volume=${gain},adelay=${delay}:all=1[${label}]`
  }
  return `sine=frequency=1800:duration=0.055:sample_rate=48000,afade=t=out:st=0.012:d=0.043,volume=${gain},adelay=${delay}:all=1[${label}]`
}


const previewCache = new Map<string, Promise<Buffer>>()

// Use the renderer's source, filters, envelope and gain. At 0.5 the WAV
// contains the maximum user volume; preview scales it by volume / 0.5.
export function previewTransitionSfx(preset: Exclude<AdProjectConfig['transition']['sfx'], 'none'>): Promise<Buffer> {
  const cached = previewCache.get(preset)
  if (cached) return cached
  const audio = runProcess('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-filter_complex', sfxFilter(preset, 0.5, 0, 'sfx'),
    '-map', '[sfx]', '-ac', '1', '-c:a', 'pcm_f32le', '-f', 'wav', 'pipe:1',
  ], { captureStdout: true }).catch((error: unknown) => {
    previewCache.delete(preset)
    throw error
  })
  previewCache.set(preset, audio)
  return audio
}
