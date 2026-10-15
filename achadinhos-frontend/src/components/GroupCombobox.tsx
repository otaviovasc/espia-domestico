/*
 * Adapted from ReUI c-combobox-12 and shadcn/ui base-nova combobox:
 * https://reui.io/r/base-nova/c-combobox-12.json
 * https://ui.shadcn.com/r/styles/base-nova/combobox.json
 * Copyright (c) 2025 Keenthemes Inc
 * Copyright (c) 2023 shadcn
 *
 * MIT License
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { useId, useRef } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import type { Group } from '@/lib/api'

interface GroupComboboxProps {
  items: Group[]
  value: Group[]
  onChange: (groups: Group[]) => void
  disabled?: boolean
  label?: string
  description?: string
}

// Keep controlled values as full group snapshots, compare by the provider's ID.
// Refetching option objects or filtering the list cannot discard a selection.
export function GroupCombobox({ items, value, onChange, disabled = false, label = 'Destinos da campanha', description = 'Busque pelo nome e selecione um ou mais grupos. Você revisará o envio antes de iniciar.' }: GroupComboboxProps) {
  const inputId = useId()
  const anchor = useRef<HTMLDivElement>(null)

  return (
    <div className="min-w-0">
      <label htmlFor={inputId} className="field-label">{label}</label>
      <p id={`${inputId}-help`} className="mb-3 text-xs leading-relaxed text-muted">{description}</p>
      <Combobox.Root<Group, true>
        multiple
        autoHighlight
        items={items}
        value={value}
        onValueChange={(groups, details) => {
          // Base UI clears a closed combobox on Escape by default. Destinations
          // are a campaign draft: closing the list must never erase them.
          if (details.reason === 'escape-key') {
            details.cancel()
            return
          }
          onChange(groups)
        }}
        itemToStringLabel={(group) => group.name}
        itemToStringValue={(group) => group.id}
        isItemEqualToValue={(item, selected) => item.id === selected.id}
        disabled={disabled}
      >
        <div ref={anchor} className="flex min-h-12 min-w-0 items-end gap-1 rounded-xl border-2 border-line-strong bg-surface p-1.5 text-ink shadow-[2px_2px_0_var(--color-line)] focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
          <Combobox.Chips className="flex max-h-56 min-w-0 flex-1 flex-wrap items-center gap-1 overflow-y-auto">
            <Combobox.Value>
              {(groups: Group[]) => groups.map((group) => (
                <Combobox.Chip key={group.id} className="flex max-w-full items-center gap-1 rounded-lg border border-line-strong bg-accent-soft pl-2.5 text-sm text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent">
                  <span className="min-w-0 truncate">{group.name}</span>
                  <Combobox.ChipRemove type="button" aria-label={`Remover ${group.name}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-accent">
                    <X size={15} aria-hidden="true" />
                  </Combobox.ChipRemove>
                </Combobox.Chip>
              ))}
            </Combobox.Value>
            <div className="flex min-w-32 flex-1 items-center gap-2 px-2">
              <Search size={16} className="shrink-0 text-subtle" aria-hidden="true" />
              <Combobox.Input id={inputId} aria-describedby={`${inputId}-help`} placeholder={value.length ? 'Adicionar grupo…' : 'Buscar grupos de WhatsApp…'} className="h-10 min-w-0 w-full bg-transparent text-sm text-ink outline-none placeholder:text-subtle disabled:cursor-not-allowed" />
            </div>
          </Combobox.Chips>
          <Combobox.Trigger type="button" aria-label="Mostrar grupos disponíveis" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent">
            <ChevronDown size={18} aria-hidden="true" />
          </Combobox.Trigger>
        </div>
        <div className="mt-2 flex min-h-10 items-center justify-between gap-3 text-xs text-muted">
          <span role="status" aria-live="polite">{value.length === 0 ? `${items.length} grupos disponíveis. Nenhum selecionado.` : `${value.length} grupo(s) selecionado(s).`}</span>
          <Combobox.Clear type="button" tabIndex={0} className="min-h-10 shrink-0 rounded-lg px-2 font-medium text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent">Limpar grupos</Combobox.Clear>
        </div>
        <Combobox.Portal>
          <Combobox.Positioner anchor={anchor} sideOffset={8} align="start" collisionPadding={12} className="z-70 max-w-[calc(100vw-24px)] outline-none">
            <Combobox.Popup className="w-[var(--anchor-width)] max-w-[var(--available-width)] overflow-hidden rounded-xl border-2 border-line-strong bg-surface-raised text-ink shadow-[3px_3px_0_var(--color-line-strong)]">
              <Combobox.Empty><p className="p-4 text-sm leading-relaxed text-muted">Nenhum grupo corresponde à busca. Tente outro nome ou atualize os grupos.</p></Combobox.Empty>
              <Combobox.List aria-label="Grupos de WhatsApp disponíveis" className="max-h-[min(320px,calc(var(--available-height)-48px))] scroll-py-1 overflow-y-auto overscroll-contain p-1 empty:p-0">
                {(group: Group) => (
                  <Combobox.Item key={group.id} value={group} className="group relative flex min-h-16 cursor-pointer items-center gap-3 rounded-lg py-2 pl-3 pr-10 text-sm outline-none data-highlighted:bg-accent-soft data-highlighted:text-accent data-selected:bg-surface-muted">
                    <div className="min-w-0 flex-1"><span className="block break-words font-medium">{group.name}</span><span className="mt-1 block text-xs tabular-nums text-muted">{group.size} membros{group.announceOnly ? ' · Somente administradores' : ''}</span></div>
                    <Combobox.ItemIndicator className="absolute right-3 text-accent"><Check size={17} aria-hidden="true" /></Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
              <p className="border-t border-line px-3 py-2 text-xs text-muted">Enter seleciona. Esc fecha a lista.</p>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  )
}
