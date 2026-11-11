const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function dailyCategoryKey(category = 'outros'): string {
  const value = normalized(category).replace(/[^a-z0-9]+/g, ' ').trim()
  if (/limpeza|aspirador/.test(value)) return 'limpeza'
  if (/cabelo|beleza|skincare/.test(value)) return 'beleza'
  if (/cama|banho|lencol/.test(value)) return 'cama e banho'
  if (/cozinha|eletroporta|eletrodomest/.test(value)) return 'cozinha'
  if (/eletronic|tecnologia|wearable|^tv /.test(value)) return 'tecnologia'
  if (/ferramenta/.test(value)) return 'ferramentas'
  if (/moda/.test(value)) return 'moda'
  return value
}

/** Conservative product families; never replace ledger identities. */
export function dailyVariantKey(product: { title?: string }): string | undefined {
  if (!product.title) return undefined
  const title = normalized(product.title).replace(/[^a-z0-9]+/g, ' ').trim()
  if (/\b(kit|combo|conjunto)\b|^(capa|suporte|bateria|carregador|fonte|cabo|case|bolsa|peca|alca|controle)\b|\bcompativel\b/.test(title)) return undefined
  const boombox = /\bboombox\s+(\d+)\b/.exec(title)
  if (/\bjbl\b/.test(title) && /\b(caixa de som|speaker|alto falante)\b/.test(title) && boombox) return `model:jbl:boombox:${boombox[1]}`
  const genio = /\bgenio s (basic|plus|touch)\b/.exec(title)
  if (/\bcafeteira\b/.test(title) && /\bdolce gusto\b/.test(title) && genio) return `model:dolce-gusto:genio-s:${genio[1]}`
  if (/\baspirador\b/.test(title) && /\bwap\b/.test(title) && /\bgtw\s*10\b/.test(title)) return 'model:wap:gtw:10'
  if (/\bliquidificador\b/.test(title) && /\bmondial\b/.test(title) && /\bl\s*99\s*fb\b/.test(title)) return 'model:mondial:l99fb'
  if (title.split(' ').length < 5 || title.length < 24) return undefined
  return `title:${title}`
}

/** PostgreSQL patterns use only explicitly recognized brand/model tokens. */
export function dailyVariantPattern(product: { title?: string }): string | null {
  const key = dailyVariantKey(product)
  let pattern: string | undefined
  if (key?.startsWith('model:jbl:boombox:')) pattern = `(?=.*\\mjbl\\M)(?=.*\\mboombox[[:space:]]+${key.split(':').pop()}\\M)(?=.*\\m(caixa[[:space:]]+de[[:space:]]+som|speaker|alto[[:space:]]+falante)\\M)`
  if (key?.startsWith('model:dolce-gusto:genio-s:')) pattern = `(?=.*\\mcafeteira\\M)(?=.*\\mdolce[[:space:]]+gusto\\M)(?=.*\\mg[eê]nio[[:space:]]+s[[:space:]]+${key.split(':').pop()}\\M)`
  if (key === 'model:wap:gtw:10') pattern = '(?=.*\\maspirador\\M)(?=.*\\mwap\\M)(?=.*\\mgtw[[:space:]]*10\\M)'
  if (key === 'model:mondial:l99fb') pattern = '(?=.*\\mliquidificador\\M)(?=.*\\mmondial\\M)(?=.*\\ml[[:space:]-]*99[[:space:]-]*fb\\M)'
  return pattern ? `^(?!.*\\m(kit|combo|conjunto|compat[ií]vel)\\M)(?!(capa|suporte|bateria|carregador|fonte|cabo|case|bolsa|peca|peça|alca|alça|controle)\\M)${pattern}.*` : null
}
