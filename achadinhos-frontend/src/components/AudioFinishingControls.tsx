import { useId } from 'react'
import { AudioLines } from 'lucide-react'
import { resolveAdAudioFinishing, type AdAudioFinishing } from '../lib/adAudioFinishing.ts'

interface AudioFinishingControlsProps {
  value?: AdAudioFinishing
  onChange: (next: AdAudioFinishing) => void
  disabled?: boolean
}

export function AudioFinishingControls({ value, onChange, disabled = false }: AudioFinishingControlsProps) {
  const settings = resolveAdAudioFinishing(value)
  const id = useId()
  return (
    <details className="rounded-xl border border-zinc-200 bg-white">
      <summary className="cursor-pointer rounded-xl px-3 py-2 text-xs font-semibold text-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
        <span className="inline-flex items-center gap-2">
          <AudioLines size={14} aria-hidden="true" />
          Finalizar áudio
          <span className="font-normal text-zinc-500">{settings.normalizeLoudness ? `${settings.targetLufs} LUFS` : 'Original'}</span>
        </span>
      </summary>
      <fieldset disabled={disabled} className="space-y-3 border-t border-zinc-100 px-3 py-3 disabled:opacity-50">
        <label className="flex items-center gap-2 text-xs text-zinc-700">
          <input
            type="checkbox"
            checked={settings.normalizeLoudness}
            onChange={(event) => onChange({ ...settings, normalizeLoudness: event.target.checked })}
            aria-describedby={`${id}-help`}
            className="h-4 w-4 accent-violet-600"
          />
          Equilibrar volume na exportação
        </label>
        <label htmlFor={`${id}-target`} className="flex items-center justify-between gap-3 text-xs text-zinc-700">
          Volume desejado
          <select
            id={`${id}-target`}
            value={settings.targetLufs}
            disabled={!settings.normalizeLoudness}
            onChange={(event) => onChange(resolveAdAudioFinishing({ ...settings, targetLufs: Number(event.target.value) }))}
            className="min-w-0 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-violet-500 disabled:opacity-50"
          >
            <option value={-16}>Suave · -16 LUFS</option>
            <option value={-14}>Equilibrado · -14 LUFS</option>
            <option value={-12}>Intenso · -12 LUFS</option>
          </select>
        </label>
        <p id={`${id}-help`} className="text-[11px] leading-4 text-zinc-500">
          O preview mantém o volume original. Ouça o arquivo exportado para conferir o acabamento. Mídias sem áudio ou silenciadas continuam sem som.
        </p>
      </fieldset>
    </details>
  )
}

export default AudioFinishingControls
