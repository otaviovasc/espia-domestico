const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Prefer the observed product type over broad/free-form AI categories. */
export function dailyCategoryKey(category = 'outros', title = ''): string {
  const type = normalized(title || category).replace(/[^a-z0-9]+/g, ' ').trim()
  const types: Array<[RegExp, string]> = [
    [/\b(furadeira|parafusadeira|parafusadera)\b/, 'furadeira e parafusadeira'],
    [/\bcompressor(?:es)?\b/, 'compressor'],
    [/\b(smartwatch|smartwatches|relogio|relogios)\b/, 'relogio e smartwatch'],
    [/\blixeira\b/, 'lixeira'],
    [/\b(lencol|lencois)\b|\bjogo de cama\b/, 'lencol e jogo de cama'],
    [/\b(coberdrom|cobertor|edredom|manta)\b/, 'cobertor e edredom'],
    [/\bchaleira\b/, 'chaleira'], [/\b(barbeador|aparador)\b/, 'barbeador'],
    [/\btenis\b/, 'tenis'], [/\baspirador\b/, 'aspirador'],
    [/\bcafeteira\b/, 'cafeteira'], [/\bliquidificador\b/, 'liquidificador'],
    [/\b(escova secadora|secador)\b/, 'secador e escova'],
    [/\b(frigideira|panela)\b/, 'panela e frigideira'],
    [/\b(fritadeira|air fryer|airfryer)\b/, 'fritadeira'],
    [/\b(perfume|colonia)\b/, 'perfume'], [/\b(fone|headphone|headset)\b/, 'fone'],
    [/\b(caixa de som|speaker)\b/, 'caixa de som'],
    [/\b(tv|televisor|televisao)\b/, 'televisao'], [/\b(webcam|web cam)\b/, 'webcam'],
    [/\b(porteiro|campainha|interfone)\b/, 'porteiro e campainha'],
    [/\b(teclado|mouse)\b/, 'periferico de informatica'],
    [/\b(esmerilhadeira|lixadeira)\b/, 'esmerilhadeira e lixadeira'],
    [/\bchave de impacto\b/, 'chave de impacto'],
    [/\b(jogo|kit) (?:de )?(chaves|ferramentas)\b/, 'ferramentas manuais'],
    [/\b(patinete|bicicleta)\b/, 'mobilidade'], [/\bmochila\b/, 'mochila'],
    [/\bbermuda\b/, 'bermuda'], [/\b(blusa|casaco|moletom)\b/, 'moletom'],
    [/\b(lustre|luminaria|lampada)\b/, 'iluminacao'], [/\bmop\b/, 'mop'],
    [/\b(shampoo|condicionador)\b/, 'cuidado capilar'], [/\broupao\b/, 'roupao'],
    [/\bpotes?\b/, 'potes'], [/\b(ralador|fatiador|cortador)\b/, 'cortador'],
    [/\bbanqueta\b/, 'banqueta'], [/\barmario\b/, 'armario'],
    [/\b(organizador|organizadores)\b|\bsacos?\b.*\borganizadores?\b/, 'organizador'],
  ]
  // A shoe bundled with a watch is primarily a shoe; an accessory mentioning
  // another product later in its title should not take that product's quota.
  const match = types.map(([pattern, key]) => ({ key, index: pattern.exec(type)?.index }))
    .filter((entry): entry is { key: string; index: number } => entry.index !== undefined)
    .sort((a, b) => a.index - b.index)[0]
  if (match?.key === 'ferramentas manuais' && types[0][0].test(type)) return types[0][1]
  if (match) return match.key
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

// Applied in this order by JS and PostgreSQL. Keep capacities, power, thread
// counts and model numbers: only explicitly marked sizes/quantities are noise.
const titleReplacements: Array<[string, string]> = [
  ['r\\s*\\$\\s*[0-9]+(?:[.,][0-9]+)*', ' '],
  ['\\b[0-9]{2,3}(?:\\s*/\\s*[0-9]{2,3})?\\s*v(?:olts?)?\\b', ' '],
  ['[^a-z0-9]+', ' '],
  ['\\b(?:vendido|enviado)\\s+por\\b.*$', ' '],
  ['\\b(?:loja|seller|vendedor)\\b.*$', ' '],
  ['\\b[0-9]{2,3}\\s*v(?:olts?)?\\b|\\bbivolt\\b', ' '],
  ['\\b(?:tamanho|tam|numero)\\s+(?:[0-9]+(?:\\s*br)?|p|m|g|gg|xg|xl|xxl)\\b|\\b[0-9]+\\s*br\\b|\\b(?:p|m|g|gg|xg|xl|xxl)$', ' '],
  ['\\b(kit|jogo|conjunto|pacote)(?:\\s+de)?\\s+[0-9]+\\b', '$1'],
  ['\\b[0-9]+\\s*(?:pc|pcs|peca|pecas|un|und|unid|unidade|unidades|pares)\\b', ' '],
  ['\\b(?:queen|king|casal|solteiro|size)\\b', ' '],
  ['\\bdesenho(?:\\s+do)?\\s+tecido\\b|\\b(?:liso|lisa)\\b', ' '],
  ['\\b([0-9]+)\\s*l(?:itros?)?\\b', '$1l'],
  ['\\b(?:azul|verde|rosa|rose|vermelho|vermelha|preto|preta|branco|branca|amarelo|amarela|laranja|roxo|roxa|lilas|bege|cinza|grafite|marrom|pink|transparente|gelo|nude|caqui|thiffany|tiffany|golden|prata|dourado|dourada|prateado|prateada|marinho|claro|clara|escuro|escura)\\b', ' '],
  ['\\b(?:cor|cores|voltagem|tensao|de|da|do|das|dos|com|para|e|em)\\b', ' '],
]

const smartBin = '\\blixeira\\b'
const smartSensor = '\\b(sensor|inteligente|smart)\\b'
const sensorSynonyms = '\\b(inteligente|smart)\\b'
const binNoise = '\\b(automatico|automatica|recarregavel|banheiro|cozinha|moderno|moderna|lixo|abre|facil|toque|cesto|quarto)\\b'

export function dailyNormalizedTitle(title: string): string {
  let value = normalized(title)
  for (const [pattern, replacement] of titleReplacements) value = value.replace(new RegExp(pattern, 'g'), replacement)
  if (new RegExp(smartBin).test(value) && new RegExp(smartSensor).test(value)) {
    value = value.replace(new RegExp(sensorSynonyms, 'g'), 'sensor').replace(new RegExp(binNoise, 'g'), ' ')
  }
  return [...new Set(value.trim().split(/ +/).filter(Boolean))].sort().join(' ')
}

/** Same canonical title as JS, without an unaccent extension or stored aliases.
 * The expression is an internal SQL column, never user input.
 */
export function dailyNormalizedTitleSql(expression: string): string {
  let value = `REGEXP_REPLACE(NORMALIZE(LOWER(COALESCE(${expression}, '')), NFD), '[\u0300-\u036f]', '', 'g')`
  for (const [pattern, replacement] of titleReplacements) {
    const sqlPattern = pattern.replace(/\\b/g, '\\y').replace(/'/g, "''")
    const sqlReplacement = replacement.replace(/\$(\d)/g, '\\$1')
    value = `REGEXP_REPLACE(${value}, '${sqlPattern}', '${sqlReplacement}', 'g')`
  }
  const pg = (pattern: string) => pattern.replace(/\\b/g, '\\y')
  value = `CASE WHEN ${value} ~ '${pg(smartBin)}' AND ${value} ~ '${pg(smartSensor)}'
    THEN REGEXP_REPLACE(REGEXP_REPLACE(${value}, '${pg(sensorSynonyms)}', 'sensor', 'g'), '${pg(binNoise)}', ' ', 'g') ELSE ${value} END`
  return `ARRAY_TO_STRING(ARRAY(SELECT DISTINCT token FROM REGEXP_SPLIT_TO_TABLE(TRIM(${value}), ' +') AS token WHERE token <> '' ORDER BY token), ' ')`
}

/** Aliases complement immutable listing identities; bundles keep their own title. */
export function dailyVariantKey(product: { title?: string }): string | undefined {
  if (!product.title?.trim()) return undefined
  const title = normalized(product.title).replace(/[^a-z0-9]+/g, ' ').trim()
  const accessory = /\b(kit|combo|conjunto)\b|^(capa|suporte|bateria|carregador|fonte|cabo|case|bolsa|peca|alca|controle)\b|\bcompativel\b/.test(title)
  if (!accessory) {
    const boombox = /\bboombox\s+(\d+)\b/.exec(title)
    if (/\bjbl\b/.test(title) && /\b(caixa de som|speaker|alto falante)\b/.test(title) && boombox) return `model:jbl:boombox:${boombox[1]}`
    const genio = /\bgenio s (basic|plus|touch)\b/.exec(title)
    if (/\bcafeteira\b/.test(title) && /\bdolce gusto\b/.test(title) && genio) return `model:dolce-gusto:genio-s:${genio[1]}`
    if (/\baspirador\b/.test(title) && /\bwap\b/.test(title) && /\bgtw\s*10\b/.test(title)) return 'model:wap:gtw:10'
    if (/\bliquidificador\b/.test(title) && /\bmondial\b/.test(title) && /\bl\s*99\s*fb\b/.test(title)) return 'model:mondial:l99fb'
  }
  const canonical = dailyNormalizedTitle(product.title)
  return `title:${canonical}`
}

/** Title patterns run against dailyNormalizedTitleSql; model patterns use raw titles. */
export function dailyVariantPattern(product: { title?: string }): string | null {
  const key = dailyVariantKey(product)
  if (key?.startsWith('title:')) return `^${key.slice(6)}$`
  let pattern: string | undefined
  if (key?.startsWith('model:jbl:boombox:')) pattern = `(?=.*\\mjbl\\M)(?=.*\\mboombox[[:space:]]+${key.split(':').pop()}\\M)(?=.*\\m(caixa[[:space:]]+de[[:space:]]+som|speaker|alto[[:space:]]+falante)\\M)`
  if (key?.startsWith('model:dolce-gusto:genio-s:')) pattern = `(?=.*\\mcafeteira\\M)(?=.*\\mdolce[[:space:]]+gusto\\M)(?=.*\\mg[eê]nio[[:space:]]+s[[:space:]]+${key.split(':').pop()}\\M)`
  if (key === 'model:wap:gtw:10') pattern = '(?=.*\\maspirador\\M)(?=.*\\mwap\\M)(?=.*\\mgtw[[:space:]]*10\\M)'
  if (key === 'model:mondial:l99fb') pattern = '(?=.*\\mliquidificador\\M)(?=.*\\mmondial\\M)(?=.*\\ml[[:space:]-]*99[[:space:]-]*fb\\M)'
  return pattern ? `^(?!.*\\m(kit|combo|conjunto|compat[ií]vel)\\M)(?!(capa|suporte|bateria|carregador|fonte|cabo|case|bolsa|peca|peça|alca|alça|controle)\\M)${pattern}.*` : null
}

/** Largest remaining type first avoids adjacent types when feasible. Fresh
 * products always precede repeats, including across the partition boundary.
 */
export function dailySpacedOrder<T extends { category?: string; product: { title?: string }; repeatFallback?: boolean }>(input: T[]): T[] {
  const types = new Map(input.map(item => [item, dailyCategoryKey(item.category, item.product.title)]))
  const type = (item: T) => types.get(item)!
  // With fixed neighbours, a type has at most otherCount + 1 positions,
  // minus a position for each neighbour of that same type.
  const feasible = (items: T[], previous?: string, next?: string) => {
    if (!items.length) return !previous || !next || previous !== next
    const counts = new Map<string, number>()
    for (const item of items) counts.set(type(item), (counts.get(type(item)) ?? 0) + 1)
    return [...counts].every(([key, count]) => count <= items.length - count + 1 - Number(previous === key) - Number(next === key))
  }
  const partition = (items: T[], previous?: string, next?: string): T[] => {
    const result: T[] = []
    const queues = new Map<string, { first: number; items: T[] }>()
    items.forEach((item, index) => {
      const key = type(item)
      const queue = queues.get(key) ?? { first: index, items: [] }
      queue.items.push(item)
      queues.set(key, queue)
    })
    while (queues.size) {
      const choices = [...queues.entries()].sort((a, b) => b[1].items.length - a[1].items.length || a[1].first - b[1].first)
      const safe = choices.find(([key]) => key !== previous && feasible(
        choices.flatMap(([other, queue]) => other === key ? queue.items.slice(1) : queue.items), key, next,
      ))
      const [key, queue] = safe ?? choices.find(([key]) => key !== previous) ?? choices[0]
      result.push(queue.items.shift()!)
      previous = key
      if (!queue.items.length) queues.delete(key)
    }
    return result
  }
  const fresh = input.filter(item => !item.repeatFallback)
  const repeats = input.filter(item => item.repeatFallback)
  // Choose the boundary before ordering either partition. A B | B and
  // C A B C | C both have avoidable adjacency despite individually valid blocks.
  if (fresh.length && repeats.length) {
    for (const [index, first] of repeats.entries()) {
      const rest = repeats.filter((_, other) => other !== index)
      if (feasible(fresh, undefined, type(first)) && feasible(rest, type(first))) {
        return [...partition(fresh, undefined, type(first)), first, ...partition(rest, type(first))]
      }
    }
  }
  const ordered = partition(fresh)
  return [...ordered, ...partition(repeats, ordered.length ? type(ordered[ordered.length - 1]) : undefined)]
}
