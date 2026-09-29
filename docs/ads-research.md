# Biblioteca de anúncios: pesquisa técnica

Pesquisa realizada em 2026-09-29. As fontes abaixo são documentação oficial,
repositórios dos próprios projetos ou o registro do artigo original. As
recomendações de produto são inferências para esta aplicação.

## Formatos e revisão antes de publicar na Meta

O [guia da Meta para Instagram Reels](https://www.facebook.com/business/ads-guide/update/video/instagram-reels)
recomenda vídeo vertical 9:16, resolução de 1440×2560, H.264, taxa de quadros
fixa e áudio AAC de pelo menos 128 kbps. O guia recomenda som, mas orienta a
usar música original ou livre de direitos, sem música licenciada para esse
posicionamento. É preciso conferir os direitos da faixa enviada pelo usuário.
O texto, logotipo e demais elementos principais devem ficar fora dos 14%
superiores, 35% inferiores e 6% de cada lateral. A prévia do editor exibe
essas zonas para facilitar a conferência. A exportação padrão de 1080×1920
mantém a proporção 9:16; ela não corresponde à resolução recomendada de
1440×2560, que o usuário pode selecionar no editor.

O [guia da Meta para Facebook Feed](https://www.facebook.com/business/ads-guide/update/video)
recomenda 4:5 em 1440×1800 e legendas. O
[guia para Instagram Feed](https://www.facebook.com/business/ads-guide/update/video/instagram-feed)
também apresenta vídeo 9:16 em 1080×1920. Os formatos dependem do
posicionamento; a prévia e o arquivo final precisam ser conferidos no
posicionamento escolhido antes de subir o anúncio. O preset quadrado 1:1 é
uma opção adicional para reutilização, sem equivaler às recomendações
específicas acima.

Clipes de proporções diferentes não devem ser deformados. O editor oferece
preenchimento com corte e foco ajustável, encaixe sobre fundo borrado, e
encaixe sobre cor sólida. FFmpeg usa `force_original_aspect_ratio` para manter
a proporção, depois `crop`, `pad` ou `overlay` conforme o modo. Clipes menores
que a saída são ampliados e podem perder nitidez; o editor mostra um alerta.
O render final deve passar por revisão humana de legibilidade, margens,
direitos de mídia e cortes de cena. Essas escolhas não garantem aprovação nem
desempenho do anúncio.

## Decisões recomendadas

1. Renderizar no backend com FFmpeg, produzindo MP4 H.264/AAC em 1080×1920,
   30 fps e SAR 1. Cada render deve ter um manifesto com seed, clipes,
   intervalos, texto, preset de cor, música e versão do renderer.
2. Na etapa de preparação, remover sempre o áudio dos clipes (`-map 0:v:0
   -an`) e, na etapa final, mapear somente a música escolhida pelo usuário.
   Isso evita que o áudio de origem reapareça em concatenações ou variações.
3. Implementar dois modos de sincronização: `interval` (intervalo fixo
   configurável) e `beats` (marcadores detectados na música). Em ambos, limitar
   a quantidade de cortes e oferecer fallback para intervalo fixo quando a
   confiança da análise for baixa.
4. Gerar combinações de forma determinística: embaralhar com um seed salvo,
   rejeitar a mesma sequência e o mesmo par texto/clipe, e manter um limite de
   duração. Assim um retry não cria anúncios diferentes silenciosamente.

## FFmpeg: composição, texto, cor e áudio

* `scale` redimensiona e também converte o formato de pixel; `crop` aceita
  expressões e centraliza por padrão. Para material vertical, a composição
  base pode ser `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1`.
  Fonte: [FFmpeg scale](https://ffmpeg.org/ffmpeg-filters.html#scale) e
  [FFmpeg crop](https://ffmpeg.org/ffmpeg-filters.html#crop).
* `drawtext` usa libfreetype e suporta texto, posição, cor, caixa e borda.
  A fonte deve ser empacotada/configurada no worker; o texto do usuário deve
  ser escrito em arquivo temporário com escaping, em vez de interpolado
  diretamente no filtro. A composição visual da referência pode ser obtida
  com texto branco, `borderw` preto e `x=(w-text_w)/2`.
  Fonte: [FFmpeg drawtext](https://ffmpeg.org/ffmpeg-filters.html#drawtext).
* Para presets de tratamento, usar uma cadeia pequena e versionada, por
  exemplo `eq=contrast=1.06:saturation=1.12:brightness=0.01` e opcionalmente
  `colorlevels`. O filtro `colorlevels` documenta pontos de preto/branco de
  entrada e saída por canal. Manter presets conservadores para não estourar
  tons de pele e permitir pré-visualização antes do render completo.
  Fontes: [FFmpeg eq](https://ffmpeg.org/ffmpeg-filters.html#eq) e
  [FFmpeg colorlevels](https://ffmpeg.org/ffmpeg-filters.html#colorlevels).
* Para transições, `xfade` exige entradas com mesma resolução, pixel format,
  frame rate e timebase. Normalizar todos os clipes antes de aplicar a
  transição; caso contrário usar cortes secos, que são mais baratos e
  previsíveis. Fonte: [FFmpeg xfade](https://ffmpeg.org/ffmpeg-filters.html#xfade).
* `loudnorm` pode normalizar a faixa final; medir depois de mixar e limitar o
  pico. Fonte: [FFmpeg loudnorm](https://ffmpeg.org/ffmpeg-filters.html#loudnorm).
* A seleção de streams e a opção `-an` são parte da interface de linha de
  comando do FFmpeg. Usar mapeamento explícito e falhar se não existir vídeo
  evita que uma faixa de áudio seja escolhida por acidente.
  Fonte: [FFmpeg stream selection](https://ffmpeg.org/ffmpeg.html#Stream-selection).

Exemplo conceitual da etapa final (a implementação deve montar filtros com uma
API segura; o áudio original já foi removido na preparação):

```bash
ffmpeg -i clip.mp4 -i music.m4a \
  -map 0:v:0 -map 1:a:0 -shortest \
  -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,eq=contrast=1.06:saturation=1.12,drawtext=fontfile=/fonts/Inter-Bold.ttf:textfile=/tmp/copy.txt:fontcolor=white:bordercolor=black:borderw=8:x=(w-text_w)/2:y=(h-text_h)/2" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart output.mp4
```

O exemplo representa uma saída; para vários clipes, o worker deve criar uma
timeline normalizada e concatená-la antes de aplicar a música e o overlay.

## Sincronização com música

### Beat mode

Há duas opções oficiais de referência:

* [aubioonset](https://aubio.org/manpages/latest/aubioonset.1.html) detecta o
  início de eventos discretos e emite os tempos em segundos. Ele expõe janela,
  hop, método, threshold, intervalo mínimo entre onsets e limiar de silêncio.
  É adequado para um modo leve de cortes/acentos, mas onset não é garantia de
  beat musical.
* [Essentia RhythmExtractor2013](https://essentia.upf.edu/reference/streaming_RhythmExtractor2013.html)
  retorna ticks, BPM, confiança e intervalos de batida. A documentação diz que
  a entrada precisa de 44.100 Hz para funcionar corretamente. O código fonte
  do algoritmo está linkado na própria página.

Algoritmo prático recomendado:

1. Extrair a música para mono, 44.100 Hz, PCM (`ffmpeg -vn -ac 1 -ar 44100`).
2. Rodar RhythmExtractor2013 e salvar `ticks`, `bpm`, `confidence` e o hash
   da música. Se Essentia não estiver disponível no worker, usar aubioonset
   como fallback e marcar o resultado como `onset`, não `beat`.
3. Aceitar o modo beat somente quando a confiança passar um limiar configurado
   (começar em 0.45 e calibrar com amostras reais). Quantizar ticks muito
   próximos, remover os primeiros/últimos marcadores que não formem um segmento
   útil e limitar a duração mínima do segmento, por exemplo 0,35 s.
4. Distribuir os clips selecionados pelos segmentos com rotação determinística;
   texto pode mudar no mesmo marcador ou em uma janela configurável após ele.
   Se houver menos clips/textos que segmentos, repetir em ordem embaralhada;
   nunca descartar silenciosamente o restante.
5. Fazer loop/trim da música no final, aplicar fade out configurável e registrar
   no manifesto se a música foi cortada ou repetida.

O trabalho de referência para detecção de onset é Bello et al., “A tutorial on
onset detection in music signals”, IEEE, DOI
[10.1109/TSA.2005.851998](https://doi.org/10.1109/TSA.2005.851998). Ele é uma
base conceitual, não uma dependência de runtime; as bibliotecas acima fornecem
implementações operacionais.

### Interval mode

Gerar limites `0, interval, 2*interval...`, truncar o último segmento à duração
do anúncio e aplicar a mesma rotação determinística. Expor presets de 0,5 s,
1 s, 1,5 s, 2 s e um campo customizado. Esse modo deve funcionar sem qualquer
analisador de áudio.

## Projetos existentes para inspiração

| Projeto | Evidência primária | Uso recomendado | Cuidado |
| --- | --- | --- | --- |
| Auto-Editor | [README](https://github.com/WyattBlue/auto-editor) | Inspiração para análise de loudness/movimento, margem entre cortes e export de sequência. | O README informa que o projeto é Public Domain, mas seus binários/releases podem ter licenças variadas; não copiar binários sem revisar. |
| MoviePy 2 | [README](https://github.com/Zulko/moviepy) | Protótipo local e testes de composição (`TextClip`, concatenação, composição). | O próprio projeto informa que a importação/exportação é mais lenta que FFmpeg direto; não usar como caminho quente de muitos renders. |
| Remotion | [renderer docs](https://www.remotion.dev/docs/renderer) e [license/pricing](https://www.remotion.dev/docs/license/pricing) | Referência para uma composição declarativa, preview com os mesmos parâmetros e render server-side. | A página de licença/pricing precisa ser revisada antes de adotar em produto comercial; FFmpeg direto evita essa dependência/licença específica. |
| Motion Canvas | [README](https://github.com/motion-canvas/motion-canvas) | Inspiração para preview em tempo real e edição de timeline em TypeScript. | É um editor/renderer especializado em animação; a pipeline de mídia e filas ainda seria responsabilidade desta aplicação. |
| OpenCut | [README](https://github.com/OpenCut-app/OpenCut) | Referência de UX e de uma futura API/headless mode. | O próprio README diz que a reescrita está em andamento; tratar como inspiração, não como dependência estável. |

## Escopo de produto sugerido

* Upload com validação de MIME, duração, resolução e tamanho; thumbnails e
  waveform; reordenação e remoção dos clipes selecionados.
* Campos para nome do projeto, proporção preset 9:16, duração máxima, modo de
  timing, intervalo/threshold, preset de cor, posição/tamanho/estilo do texto,
  cinco ou mais cópias, emoji opcional, música, volume e fade.
* Preview low-res do primeiro resultado e uma grade das variações. Cada card
  deve mostrar copy, seed, duração e estado (`queued`, `rendering`, `ready`,
  `failed`), com retry/cancelamento.
* Download individual e pacote ZIP com MP4 + manifesto JSON. Salvar o projeto e
  permitir duplicá-lo para criar uma nova rodada sem re-enviar os mesmos assets.
* Worker idempotente: chavear job por hash do projeto/manifesto, manter arquivos
  temporários em diretório por job, limitar concorrência por CPU/disco e limpar
  artefatos após TTL. O progresso deve ser baseado em etapas reais (análise,
  composição, encode, upload), não em um contador estimado.
* Preservar a origem e a licença dos vídeos/músicas fornecidos pelo usuário;
  registrar apenas metadados necessários e bloquear uploads não suportados antes
  de iniciar um render pago ou longo.

## Railway Storage Buckets para mídia do backend

Os [Storage Buckets do Railway](https://docs.railway.com/storage-buckets) são
privados e compatíveis com S3. O bucket não tem URL pública; para downloads,
usar uma URL pré-assinada (válida por até 90 dias) ou um proxy autenticado no
backend. A URL pré-assinada entrega o arquivo diretamente do bucket; o proxy
permite controlar headers e transformações, mas o tráfego servido pelo serviço
conta como egress do serviço. Para vídeo com seek, encaminhar `Range`,
`Content-Range`, `Accept-Ranges`, `Content-Length` e o status `206` no endpoint
do backend. A documentação confirma o controle dos headers no proxy, mas não
promete comportamento automático de byte range; essa parte é um requisito da
implementação de streaming desta aplicação. Fonte: [Uploading & Serving
Files](https://docs.railway.com/storage-buckets/uploading-serving).

### Variáveis e referência no Railway

O Railway expõe no bucket `BUCKET` (nome S3 global), `ENDPOINT`, `REGION`,
`ACCESS_KEY_ID` e `SECRET_ACCESS_KEY`. `RAILWAY_BUCKET_NAME` é apenas o nome
do recurso no Railway e não deve ser usado como `Bucket` na API S3. A opção de
injeção automática escolhe aliases conforme o cliente; a alternativa explícita
é criar referências no serviço pelo formato documentado
`${{SERVICE_NAME.VAR}}`. Para este backend, o mapeamento direto recomendado é:

```dotenv
AD_STORAGE_DRIVER=s3
AD_S3_BUCKET=${{ad-library-media.BUCKET}}
AD_S3_ENDPOINT=${{ad-library-media.ENDPOINT}}
AD_S3_REGION=${{ad-library-media.REGION}}
AD_S3_ACCESS_KEY_ID=${{ad-library-media.ACCESS_KEY_ID}}
AD_S3_SECRET_ACCESS_KEY=${{ad-library-media.SECRET_ACCESS_KEY}}
AD_S3_FORCE_PATH_STYLE=false
```

`ad-library-media` é o nome do recurso criado neste projeto. O schema do
backend aceita os nomes Railway sem prefixo (`BUCKET`,
`ENDPOINT`, `REGION`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`) e também os
`AD_S3_*`; os últimos têm precedência. Se forem usadas as variáveis exibidas
por `railway bucket credentials` (`AWS_ENDPOINT_URL`, `AWS_S3_BUCKET_NAME`,
`AWS_DEFAULT_REGION`), é preciso traduzi-las para os nomes acima, pois esses
três aliases não são lidos pelo schema atual. Fontes: [Storage
Buckets](https://docs.railway.com/storage-buckets#railway-provided-variables),
[Using Variables](https://docs.railway.com/variables#referencing-another-services-variable)
e [schema de ambiente do backend](../achadinhos-backend/src/config/env.ts).

Railway usa URLs virtual-hosted por padrão: informe o endpoint base, como
`https://t3.storageapi.dev`, e deixe o cliente montar a URL com o bucket. Um
bucket antigo pode exigir path-style; conferir o estilo mostrado na aba
Credentials antes de definir `AD_S3_FORCE_PATH_STYLE=true`. As operações
confirmadas são Put, Get, Head, Delete, List/List V2, Copy, URLs pré-assinadas,
tags e multipart upload. Server-side encryption, versionamento, object lock e
lifecycle de bucket ainda não são suportados. Fonte: [S3
compatibility](https://docs.railway.com/storage-buckets#s3-compatibility).

### Provisionamento e isolamento

No canvas do projeto, criar **Bucket**, escolher região e nome, e fazer deploy;
a região não pode ser alterada depois. Em seguida, abrir a aba Credentials e
criar as referências acima (ou usar o preset do cliente S3). Pela CLI, o fluxo
equivalente é `railway bucket create ad-media --region sjc` e depois
`railway bucket credentials`; as regiões disponíveis e o formato JSON estão em
[railway bucket](https://docs.railway.com/cli/bucket). Cada ambiente recebe uma
instância e credenciais próprias, inclusive ambientes duplicados e PR
environments; configurar staging e produção separadamente e não compartilhar
objetos entre eles. Fonte: [Buckets in
environments](https://docs.railway.com/storage-buckets#buckets-in-environments).

## Limites e validação

Os documentos das ferramentas confirmam as capacidades de filtro, análise e
renderização citadas acima; não confirmam que um preset visual ou threshold
produzirá bom desempenho em todos os nichos. Validar com clipes curtos reais,
músicas com diferentes BPM e casos sem áudio. Inspecionar o MP4 final com
`ffprobe` (streams, duração, 1080×1920, 30 fps, áudio AAC) e assistir ao início,
às transições e ao final para verificar corte de texto, clipping, sincronização,
nível de áudio e tratamento de cor.
