export function wallTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
export function wallTimeToUtc(value: string, timeZone: string): string {
  const wall = new Date(`${value}:00Z`).getTime()
  if (!Number.isFinite(wall)) throw new Error('Informe uma data válida')
  let candidate = wall
  for (let i = 0; i < 4; i++) {
    const displayed = new Date(
      `${wallTime(new Date(candidate).toISOString(), timeZone)}:00Z`,
    ).getTime()
    candidate += wall - displayed
  }
  const iso = new Date(candidate).toISOString()
  if (wallTime(iso, timeZone) !== value)
    throw new Error('Este horário não existe no fuso selecionado por causa do horário de verão')
  return iso
}
