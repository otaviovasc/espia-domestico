# Coleções, interações e paletas para o Espia Doméstico

Pesquisa verificada em 15/10/2026. Escopo desta entrega: referências e decisões de UI para o aplicativo autenticado e login; nenhum código da aplicação foi alterado. Foram lidos o workflow local, a skill oficial Claude frontend-design, a skill local frontend-design, a skill research e o [brief compartilhado](ui-ux-design-brief.md).

## Decisão recomendada

Manter o verde de distribuição e os neutros esverdeados já definidos no brief; tornar o aplicativo mais tátil por geometria, hierarquia e feedback de estado. A oferta — foto, título, preço, destino e mensagem — continua sendo a assinatura. Azul e ameixa são alternativas comparadas abaixo, sem introduzir três sistemas concorrentes na implementação.

Uma linguagem arredondada com contornos definidos funciona para este produto se aplicada às ações e à área de criação. Não deve transformar cada linha de catálogo ou configuração em um cartão com sombra pesada. A prioridade prática é saber o que está selecionado, o que será enviado, o que foi salvo e qual ação resolve uma falha.

## Método e limites

As URLs abaixo foram abertas em fontes primárias pela ferramenta web. “Acessível” significa que a página pública retornou conteúdo legível nesta consulta; não significa inspeção de toda a biblioteca, compra de assinatura ou teste do componente em React 19/Tailwind 4. Não foram criadas contas, feitas compras, copiados screenshots, extraídos catálogos em massa ou importados snippets. Exemplos que dependem de login não fundamentam afirmações sobre comportamento observado atrás desse login.

Esta pesquisa trata de documentação e referências públicas; não fez descoberta de símbolos da aplicação. Não há conclusão de cobertura do grafo ou auditoria funcional do repositório nesta entrega. As sugestões de aplicação são propostas próprias, apoiadas pelos tipos de referência descritos, e não reprodução de telas de terceiros.

## Coleções e sistemas: seleção ampla com uso concreto

| Fonte primária e acesso verificado | O que realmente oferece / direitos | Aplicação ao Espia e decisão |
| --- | --- | --- |
| [Uiverse](https://uiverse.io/) — acessível | Elementos HTML/CSS, Tailwind e React; a própria página declara os elementos sob MIT. Ainda assim, registrar autor, URL do snippet e aviso de licença de qualquer elemento efetivamente incorporado. Biblioteca não equivale a acessibilidade testada. | Útil para estudar botões táteis, switches e loaders. Selecionar no máximo um padrão visual de botão, reconstruído sobre o componente existente. Rejeitar glow, animação infinita e cards em 3D em telas de trabalho. |
| [21st](https://21st.dev/) e [termos atuais](https://21st.dev/terms) — acessíveis | Diretório multi-autores em formato de registry, com conteúdo gratuito e premium. Os termos distinguem licença do componente original de direitos sobre previews, mídia e metadados da plataforma; não assumir licença MIT universal. | Usar como índice para localizar o autor e a fonte original licenciada. Bom para pesquisar navegação, galerias de mídia e estados de botão. Não importar um prompt sem inspecionar origem, dependências, licença e semântica; não reproduzir previews da plataforma. |
| [shadcn.io](https://www.shadcn.io/) — acessível | Diretório/coleção comercial independente. A página declara não ter afiliação com o [shadcn/ui oficial](https://ui.shadcn.com/). Há blocos e templates premium; a homepage não estabelece licença universal para todo item. | Fonte secundária de descoberta de blocos, não autoridade sobre o shadcn oficial. Rejeitar importação de marketing blocks neste escopo. Considerar somente padrões de aplicação cujo código original e licença sejam verificáveis. |
| [The Component Gallery](https://component.gallery/), [table](https://component.gallery/components/table/), [tabs](https://component.gallery/components/tabs/) e [toast](https://component.gallery/components/toast/) — acessíveis | Índice comparativo de design systems, com filtros de tecnologia, guidelines e acessibilidade. A licença de um sistema listado não se transfere automaticamente aos demais. | Melhor coleção para comparar semântica de tabs, filtros, tabelas, alertas e estado salvo. Usar para decidir o padrão e depois seguir a documentação do sistema original. Prioridade alta. |
| [Mobbin](https://mobbin.com/) — página pública acessível | Referências de apps/sites, screens, flows, animações e elementos. A página oferece planos; determinadas integrações exigem Pro/Team. É referência de produto, não distribuição de código aberto das telas retratadas. | Procurar exemplos de seleção em massa, biblioteca de mídia e confirmação de envio. Extrair princípios de tarefa e progressão; não copiar telas, marcas, assets ou presumir acesso à coleção completa. Prioridade média, sem dependência de compra. |
| [Nicelydone](https://nicelydone.club/) — acessível | Referências de SaaS por tela, componente e fluxo. A própria página mostra exemplos de modal, notificações e empty state de Descript, além de busca por texto/padrão e planos. Não é uma licença de código dos produtos retratados. | Forte afinidade com configurações de publicação e edição de mídia. Estudar estados vazios acionáveis e fechamento de operações; nenhuma tela privada foi inspecionada. Prioridade alta como inspiração, não como dependência. |
| [Landbook](https://land-book.com/) — acessível | Galeria de websites com filtros como Brutalism, Visible Borders, Dark Colors e Flat Design. Acesso básico limitado e plano Pro; alguns templates têm compra própria. | Útil apenas para calibrar contornos, cor e cantos. O catálogo é fortemente orientado a websites; rejeitar hero gigante, parallax e manifesto visual na plataforma. Prioridade baixa para interação. |
| [Recent](https://recent.design/) — acessível; [Godly](https://godly.website/) redirecionou para Recent | Galeria de design com filtros Interface e Motion, além de websites e app screenshots. Não há licença universal de reutilização de arte ou código estabelecida na página consultada. | Usar Interface/Motion como calibração visual. Não tratar Godly como coleção independente adicional nem recomendar URL antiga como destino final. Preferir movimento curto que responda a ação. |
| [Radix Colors](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale) — acessível; [licença MIT](https://github.com/radix-ui/colors/blob/main/LICENSE) verificada | Escalas com funções para fundo, estados, bordas, sólidos e texto; distinção explícita entre borda decorativa e borda de componente interativo. As garantias de contraste citadas na documentação incluem APCA em condições específicas. | Melhor modelo conceitual para separar `line`, `control-border`, `focus-ring`, `accent-soft` e `ink`. Não trocar os tokens existentes por números Radix nem assumir WCAG AA por nome de step. Prioridade alta. |
| [Leonardo](https://leonardocolor.io/) — acessível; [Apache 2.0](https://github.com/adobe/leonardo/blob/main/LICENSE) verificada | Ferramenta Adobe para escalas baseadas em contraste, temas adaptativos, comparação e exportação de tokens/CSS. Possui API; usá-la não é requisito para gerar tokens estáticos. | Excelente para gerar uma rampa verde clara/escura e explorar contrastes antes de congelar valores. Exportar valores próprios, sem adicionar runtime de tema à aplicação. Prioridade alta. |
| [OKLCH Color Picker & Converter](https://oklch.com/) — acessível | Editor/conversor com eixos perceptuais, visualização de gamut e fallback sRGB. O endereço com `www` não foi acessível nesta ferramenta; usar o domínio canônico sem `www`. | Ajustar luminosidade de texto e borda sem variar desnecessariamente o matiz. Validar os hex sRGB realmente renderizados. Ferramenta de cor não substitui medição WCAG dos pares finais. Prioridade alta. |
| [Realtime Colors](https://www.realtimecolors.com/) — acessível | Aplica cores e fontes em exemplos, alterna tema e exporta tokens. A FAQ permite uso comercial das cores geradas; a licença CC BY-NC-ND do site não concede licença comercial do código e dos materiais do próprio site. | Boa comparação rápida de verde/azul/ameixa; usar exemplos de dashboard, não seu hero como layout final. O resultado visual não prova contraste de todos os estados da plataforma. Prioridade média. |
| [Open Props](https://open-props.style/) — acessível; MIT informado pela fonte | Tokens CSS, pacotes seletivos de tamanhos, raios, bordas, durações e easings; exemplos condicionam animação à preferência de movimento. | Referência forte para uma escala única de geometria e motion. Copiar apenas valores selecionados sob licença, se necessário, em vez de importar normalize ou uma segunda fundação inteira sobre Tailwind. Prioridade alta. |
| [Happy Hues](https://www.happyhues.co/) — acessível | Paletas demonstradas por função: fundo, título, botão, texto de botão e cartões. Inspiração contextual, sem licença geral de código ou ilustração verificada nesta pesquisa. | Útil para conferir proporção de uso e atribuição de papéis. Rejeitar afirmações genéricas de “psicologia da cor” como evidência de conversão ou acessibilidade. Não copiar ilustrações. Prioridade média. |
| [Huemint](https://huemint.com/) — página pública acessível, conteúdo de app limitado | Apresenta geração de esquemas com machine learning para marca, website ou gráfico. O conteúdo extraído da homepage é pequeno; recursos internos e garantias de contraste não foram verificados. | Fonte de ideias iniciais, sem autoridade para AA. Sem necessidade de gerar dezenas de opções quando já existe direção verde. Prioridade baixa. |
| [Carbon Data table](https://carbondesignsystem.com/components/data-table/usage/) — acessível, redireciona para guidelines atuais | Documenta toolbar, densidades, seleção/expansão, ações em lote, paginação e estados; é referência comportamental primária adicional à galeria. Adotar guideline não exige instalar Carbon. | Melhor referência para catálogo e campanhas: dados no corpo, ações na toolbar, seleção explícita e detalhe sob demanda. Não importar o sistema inteiro nem seu visual de marca. Prioridade alta. |

### Fontes tentadas que não sustentam uma recomendação detalhada

| Fonte | Resultado desta consulta | Decisão |
| --- | --- | --- |
| [Page Flows](https://pageflows.com/) e [termos](https://pageflows.com/terms/) | A homepage retornou 403; termos não retornaram conteúdo útil. | Fonte candidata para fluxos, mas sem afirmar catálogo atual, preço, licença ou padrões observados. Não usar como evidência central desta entrega. |
| [Refero](https://refero.design/) | Título público retornou, corpo extraível vazio. | Não contar como coleção inspecionada em profundidade. Pode ser revisitada com acesso autorizado; nenhuma captura foi copiada. |
| [Coolors](https://coolors.co/) | Retornou 403. | Não afirmar funções/licença atuais a partir desta consulta. Leonardo/OKLCH/Realtime cobrem a necessidade sem bloqueio. |

## Como transformar referências em melhorias úteis

Estas propostas são específicas do trabalho de afiliados, não alegações de que todas as funcionalidades já existam ou estejam quebradas.

| Área | Padrão recomendado | Referência e critério de aceitação |
| --- | --- | --- |
| Catálogo | Uma toolbar de busca/filtro; seleção com contador e “Limpar seleção”; preço em coluna alinhada; thumbnail constante. Seleção oculta por filtro precisa ser limpa ou aparecer no resumo antes da ação. | Carbon + Component Gallery. A pessoa consegue responder “quais produtos serão usados?” sem navegar por várias páginas. Ações de linha não são acionadas pelo clique do checkbox. |
| Densidade | Padrão confortável com linhas de 56–64px quando há foto e duas linhas de título; compacto de 44–48px somente se o conteúdo couber. Não reduzir targets a 24/32px apenas porque a biblioteca oferece essas densidades. | Carbon fornece uma escala, não uma obrigação. Aqui a proposta adapta ao catálogo visual e aos alvos de toque de 44px do brief. |
| Mobile | Produto vira linha com foto, título e preço, seguido da ação principal; detalhes vão para expansão. Se mantiver tabela, rolagem fica no contêiner, sem rolagem horizontal do documento. | Component Gallery table + Carbon. Checkbox e menu permanecem visíveis em toque; nenhuma ação depende de hover. |
| Editor de criativo | Stage central dominante; ferramentas agrupadas em tabs “Conteúdo”, “Aparência” e “Áudio” quando compatível com o modelo existente. Resumo dos valores de ajustes avançados no disclosure. Timeline abaixo do stage somente para vídeo/sequência. | Nicelydone como pesquisa de mídia e Component Gallery tabs. Trocar aba não perde edição; tema da UI não muda pixels exportados. Os nomes finais devem refletir as capacidades existentes. |
| Biblioteca de mídia | Grade com proporção estável, nome legível, tipo/duração e estado selecionado por check + contorno. “Usar N arquivos” confirma a escolha; não iniciar envio por seleção de thumbnail. | Mobbin/Nicelydone como referências de tarefa. Vídeo não inicia automaticamente em cada item; falha de thumbnail continua permitindo identificar o arquivo. |
| Estado salvo | Uma linha próxima ao título/ação: “Alterações não salvas”, “Salvando…”, “Salvo às 14:32” ou “Não foi possível salvar · Tentar novamente”. Só mostrar “Salvo” após confirmação real do mecanismo existente. | Component Gallery toast/alert; redação própria. O toast complementa o estado persistente; erro não some antes de poder ser resolvido. Não inventar autosave se o fluxo é explicitamente “Salvar”. |
| Preview e envio | Resumo compacto do produto/destino antes de “Enviar oferta”; preview representa exatamente texto e checkbox de imagem. Manter a distinção entre aceitação do pedido e entrega confirmada. | Brief do projeto; coleções fornecem referências visuais, não semântica do provedor. A ação final tem um único significado e feedback perto dela. |
| Tabs | Aba ativa com texto/contorno ou underline espesso, não só mudança de cor. Setas navegam dentro do tablist; Enter/Espaço ativam quando há latência. | [WAI-ARIA Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/). Ativação automática só se o painel não introduz atraso perceptível; estado de edição fica preservado. Navegação entre rotas continua sendo link. |
| Progresso/falha | Mostrar nome da operação, progresso conhecido e “Tentar novamente” junto ao erro. Skeleton preserva a estrutura de conteúdo; spinner é adequado à ação em andamento. | Carbon loading + Uiverse apenas como forma visual. Sem percentuais inventados, falsa conclusão ou loader decorativo infinito. |

## Geometria: arredondado, definido e contido

Proposta própria de interpretação tátil, compatível com a direção do brief. Open Props ajuda a manter consistência; Landbook/Recent servem apenas para comparar a expressão visual.

- Campos e botões: raio 8px; grupos/toolbar 10px; painéis e diálogos 12–14px; preview com raio que corresponda ao formato real. Não aplicar `rounded-full` global.
- Contorno de ação principal: 1–2px definido; sombra deslocada de 2px somente em ação de destaque ou na moldura do stage, com cor derivada do `ink`. No estado pressionado, deslocar 1px e reduzir a sombra, sem mudar a altura do layout.
- Catálogo: separadores discretos e seleção definida. Sem sombra em cada linha e sem contorno duplo em todo painel aninhado. Um frame mais forte por região de trabalho é suficiente.
- Hierarquia de preenchimento: canvas < surface < controles/seleção. Guardar a cor mais forte para ação, seleção e feedback; não colorir todas as caixas de instrução.
- Preços, contagens e horários usam numerais tabulares; a variedade de tipografia não substitui estrutura. Preservar Manrope e IBM Plex Sans definidos no brief.

## Motion com propósito

Valores de projeto sugeridos: 120ms para hover/cor, 160ms para seleção/feedback de botão, 180–220ms para diálogo/drawer; easing `cubic-bezier(.2, 0, 0, 1)`. São escolhas desta proposta, não requisitos numéricos das bibliotecas pesquisadas.

Animar a resposta a uma ação, mantendo o conteúdo ancorado. Não animar a entrada de cada linha de tabela, reiniciar o preview ao trocar aba ou fazer números/skeletons pulsarem de forma contínua. Em `prefers-reduced-motion: reduce`, remover deslocamento, escala e animação ornamental; conservar feedback instantâneo de estado. O [WCAG 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) é nível AAA e orienta a redução de movimento não essencial; não confundir isso com os critérios AA de contraste.

## Três paletas coerentes, comparadas com papéis explícitos

Verde é a escolha recomendada por continuidade com o brief e o contexto WhatsApp. Azul traz diferenciação entre ação de marca e sucesso, mas muda a identidade. Ameixa dá mais personalidade ao estúdio, mas enfraquece a ligação com distribuição e pode competir com mídia colorida. Nenhuma opção usa verde-limão luminoso sobre preto nem gradiente ornamental como assinatura.

Os pares abaixo usam luminância relativa WCAG 2 em sRGB opaco: texto normal ≥4,5:1; texto grande ≥3:1. Bordas necessárias para identificar componentes/estados precisam ≥3:1 contra as cores adjacentes conforme [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Separadores decorativos não precisam todos ter 3:1. Referência do cálculo: [1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Não arredondar 4,49 para aprovar 4,5.

### A. Verde distribuição — recomendado

Os valores principais reproduzem o contrato atual. As três últimas linhas são correções propostas para os papéis que precisam de contraste, não uma troca ampla de paleta.

| Papel | Light | Dark |
| --- | --- | --- |
| canvas | `#f3f6f4` | `#121c18` |
| surface | `#ffffff` | `#1b2821` |
| surface-muted / raised | `#edf2ee` / `#ffffff` | `#24352b` / `#2a3d31` |
| ink | `#183025` | `#edf5ee` |
| muted | `#526a5d` | `#b0c4b5` |
| accent / foreground | `#27654f` / `#ffffff` | `#a4d6b7` / `#163b28` |
| subtle legível proposto | `#5b7264` | `#8ea996` atual |
| borda interativa proposta | `#708777` | `#78917f` |
| focus-ring | accent atual | accent atual |

| Par exato | Contraste | Resultado |
| --- | ---: | --- |
| `#183025` / `#ffffff` — ink light | 14,110:1 | Texto normal passa |
| `#526a5d` / `#ffffff` — muted light | 5,868:1 | Texto normal passa |
| `#ffffff` / `#27654f` — botão light | 6,861:1 | Texto normal passa |
| `#edf5ee` / `#1b2821` — ink dark | 13,772:1 | Texto normal passa |
| `#163b28` / `#a4d6b7` — botão dark | 7,620:1 | Texto normal passa |
| `#667e70` / `#ffffff` — subtle light atual | 4,390:1 | Falha para texto normal |
| `#667e70` / `#f3f6f4` — subtle light atual/canvas | 4,035:1 | Falha para texto normal |
| `#667e70` / `#edf2ee` — subtle light atual/muted | 3,875:1 | Falha para texto normal |
| `#5b7264` / `#edf2ee` — subtle light proposto/pior fundo listado | 4,593:1 | Texto normal passa |
| `#8ea996` / `#2a3d31` — subtle dark/raised | 4,566:1 | Texto normal passa, margem pequena |
| `#a9bfaf` / `#ffffff` — line-strong light atual | 1,952:1 | Não basta como única borda de identificação |
| `#607e68` / `#24352b` — line-strong dark atual/muted | 2,891:1 | Falha se borda for necessária |
| `#607e68` / `#2a3d31` — line-strong dark atual/raised | 2,586:1 | Falha se borda for necessária |
| `#708777` / `#edf2ee` — borda light proposta | 3,419:1 | Identificação passa |
| `#78917f` / `#2a3d31` — borda dark proposta | 3,400:1 | Identificação passa |
| `#27654f` / `#edf2ee` — foco light | 6,056:1 | Cor de foco forte |
| `#a4d6b7` / `#2a3d31` — foco dark | 7,115:1 | Cor de foco forte |

Alternativa de menor escopo: manter o token `subtle` atual apenas para elementos não textuais e usar `muted` em todas as informações pequenas; manter `line-strong` para separação decorativa e reservar uma borda/foco accent para identificar controles. O componente deve considerar o fundo real ao redor, inclusive focus sobre botão accent. Cor de foco forte isoladamente não prova todos os critérios de foco e geometria.

### B. Azul oficina — alternativa avaliada

| Papel | Light | Dark |
| --- | --- | --- |
| canvas / surface | `#f2f5f8` / `#ffffff` | `#131c25` / `#1c2935` |
| surface-muted / raised | `#eaf0f5` / `#ffffff` | `#243644` / `#2a3d4e` |
| ink / muted | `#142a3c` / `#4f6577` | `#edf4fa` / `#b0c6d8` |
| subtle | `#586e81` | `#9db6c9` |
| accent / foreground | `#245d79` / `#ffffff` | `#a8d5ed` / `#19384a` |
| borda interativa | `#71879a` | `#738fa4` |

| Pares light | Razão | Pares dark | Razão |
| --- | ---: | --- | ---: |
| ink `#142a3c` / surface `#ffffff` | 14,725:1 | ink `#edf4fa` / surface `#1c2935` | 13,344:1 |
| muted `#4f6577` / surface `#ffffff` | 6,069:1 | muted `#b0c6d8` / surface `#1c2935` | 8,403:1 |
| subtle `#586e81` / muted-bg `#eaf0f5` | 4,614:1 | subtle `#9db6c9` / raised `#2a3d4e` | 5,314:1 |
| on-accent `#ffffff` / accent `#245d79` | 7,200:1 | on-accent `#19384a` / accent `#a8d5ed` | 7,858:1 |
| borda `#71879a` / muted-bg `#eaf0f5` | 3,245:1 | borda `#738fa4` / raised `#2a3d4e` | 3,302:1 |

### C. Ameixa editorial — alternativa avaliada

| Papel | Light | Dark |
| --- | --- | --- |
| canvas / surface | `#f7f3f7` / `#ffffff` | `#211923` / `#2c2230` |
| surface-muted / raised | `#f0eaf1` / `#ffffff` | `#392c3d` / `#423349` |
| ink / muted | `#302237` / `#6c5572` | `#f7edf8` / `#d0b6d5` |
| subtle | `#755f7d` | `#c2a6c9` |
| accent / foreground | `#75477d` / `#ffffff` | `#dfb4e7` / `#43284a` |
| borda interativa | `#967a9f` | `#a080a8` |

| Pares light | Razão | Pares dark | Razão |
| --- | ---: | --- | ---: |
| ink `#302237` / surface `#ffffff` | 14,897:1 | ink `#f7edf8` / surface `#2c2230` | 13,364:1 |
| muted `#6c5572` / surface `#ffffff` | 6,604:1 | muted `#d0b6d5` / surface `#2c2230` | 8,221:1 |
| subtle `#755f7d` / muted-bg `#f0eaf1` | 4,810:1 | subtle `#c2a6c9` / raised `#423349` | 5,325:1 |
| on-accent `#ffffff` / accent `#75477d` | 7,109:1 | on-accent `#43284a` / accent `#dfb4e7` | 7,203:1 |
| borda `#967a9f` / muted-bg `#f0eaf1` | 3,179:1 | borda `#a080a8` / raised `#423349` | 3,413:1 |

Os três esquemas são bases de trabalho, não matrizes completas certificadas. Hover, disabled, overlay com alpha, erro, sucesso, gráficos e seleção ainda exigem validação nos componentes renderizados. Não mapear marca e “entregue” ao mesmo significado: manter texto/ícone de estado, especialmente no esquema verde. Cor sozinha não comunica falha, seleção ou sucesso.

### Reprodução dos números

As razões foram calculadas localmente com Python, sem biblioteca externa. Substituir os pares para reproduzir qualquer linha; os cálculos usam valores completos e arredondam só a exibição.

```python
def luminance(color):
    rgb = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [v / 12.92 if v <= 0.04045
              else ((v + 0.055) / 1.055) ** 2.4 for v in rgb]
    return sum(v * w for v, w in zip(linear, (0.2126, 0.7152, 0.0722)))

def contrast(foreground, background):
    low, high = sorted((luminance(foreground), luminance(background)))
    return (high + 0.05) / (low + 0.05)

print(f'{contrast("#5b7264", "#edf2ee"):.3f}:1')  # 4.593:1
```

## Recorte de adoção

1. Aplicar decisões comportamentais do brief com componentes existentes: seleção, preview, estado salvo, erro e tabs corretas.
2. Ajustar papéis de contraste do verde em uma única fundação; verificar light/dark em conteúdo real antes de qualquer importação visual.
3. Aplicar cantos, contornos e sombra tátil com parcimônia ao botão principal e frame de criação; comparar desktop e 390px.
4. Só incorporar código de terceiro quando ele resolver uma lacuna concreta. Registrar item, autor, URL de fonte, revisão, licença e dependências; revisar teclado, reduced motion e tema do componente.
5. Validar fluxo completo com produto selecionado, edição pendente, erro de salvar e envio; as galerias e as contas de contraste não substituem a prova de comportamento no navegador.
