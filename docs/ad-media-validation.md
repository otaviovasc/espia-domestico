# Imagens e carrosséis: validação local

Validação em 5 de outubro de 2026. Alterações locais; sem publicação ou deploy.

## Comportamento

- Vídeos aceitam JPG, PNG e WebP como cenas, inclusive projetos só com imagens.
- Carrosséis têm de 2 a 20 slides ordenados, com imagens e vídeos, texto opcional
  por slide e legenda de até 2.200 caracteres.
- Saídas: JPG e MP4 numerados, em 1080×1350 ou 1080×1080. Vídeos preservam
  áudio e se repetem quando a duração solicitada excede a duração de origem.
- Renders usam uma cópia da configuração enviada, preservada mesmo quando o
  projeto é editado depois. Cópias remapeiam os IDs para as próprias mídias.
- A migração `20261005000001-add-ad-images` acrescenta `image` ao enum do
  PostgreSQL. Ela deve ser aplicada antes de usar os novos uploads.

## Verificações

- Builds TypeScript do backend e frontend.
- Backend: 70 testes, incluindo geração FFmpeg de vídeos só com imagens,
  sequências mistas e carrosséis. FFprobe confirmou dimensões, duração,
  continuidade dos quadros, tipos de saída e presença de áudio. Um teste de contrato confirma o MIME dos objetos JPG/MP4 no armazenamento.
- Frontend: nove testes de preview, incluindo seleção de imagens e ordem e
  limites dos uploads para carrosséis.
- Lint do backend sem erros. Lint do frontend sem erros, com dois avisos
  anteriores em `WhatsAppBubble.tsx` e `GroupMessagesPage.tsx`.
- `node scripts/validate-ad-media.cjs`: banco PostgreSQL temporário com todas as
  migrações; uploads reais JPG/PNG/WebP e MP4; rejeição de assinatura/tipo
  incompatível; validação de referências; isolamento entre usuários; worker;
  preservação da configuração do job; saídas JPG/MP4; downloads e ranges HTTP;
  cópias; vídeo só com imagem e vídeo misto. O script remove o banco e as mídias.

## Navegador

No preview T3, com sessão autenticada na API isolada:

- Criação de um carrossel pelo botão Novo carrossel.
- Inserção de imagem e vídeo pelos inputs de upload da interface.
- Edição de texto e legenda, reordenação pelas setas e escolha do formato 1:1.
- Geração concluída com `slide-01.mp4` e `slide-02.jpg`; cliques de download.
- Reload preservou ordem, texto e legenda. API confirmou o tipo de projeto,
  os arquivos e as dimensões. Nenhum alerta apareceu.
- Prévia carregou a imagem e o texto. A interface coube em 1440px e 390px;
  em 390px não houve elementos maiores que a viewport nem overflow horizontal.
- O vídeo misto preparado pela validação carregou na interface com imagens
  prontas na prévia. Uma tentativa adicional de inserir outra imagem pelo
  navegador ficou incompleta quando o host T3 desconectou.

Não houve publicação no Instagram nem validação de infraestrutura S3 remota.
Os exports locais são para publicação manual pelo usuário.
