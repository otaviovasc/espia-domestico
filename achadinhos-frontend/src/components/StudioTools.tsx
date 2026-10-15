import { useEffect, useId, useRef, useState } from "react";
import { motion } from "motion/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adProjectApi, apiErrorMessage, savedProductApi } from "@/lib/api";
import type {
  AdAsset,
  AdCarouselSlide,
  AdProject,
  AdProjectConfig,
  AdRenderJob,
} from "@/lib/api";
import { studioApi } from "@/lib/adStudioApi";
import type {
  BrandKit,
  LibraryMedia,
  Publication,
  StudioRecord,
  CreativeMetrics,
} from "@/lib/adStudioApi";
import { Button } from "@/components/ui";
import { PublicationPlanner, StudioConfirmDialog } from "./PublicationPlanner";
import { MediaLibraryPicker } from "./MediaLibraryPicker";
import { preflightMediaLibrary } from "@/lib/adMediaLibrary";
import { CreativeWorkbench } from "./CreativeWorkbench";
import { AnimatedSelection } from "./AnimatedSelection";
import { useDraftBaseline } from "@/hooks/useDraftBaseline";
const tabs = [
  "Layouts e arquivos",
  "Produtos",
  "Mídias",
  "Marca e templates",
  "Formatos",
  "Textos com IA",
  "Calendário",
  "Resultados",
] as const;
const field =
  "field-control w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink";
export function StudioTools({
  project,
  config,
  name,
  jobs,
  disabled,
  onBusy,
  onDirtyChange,
  onChange,
  onProject,
  onSelect,
  onError,
}: {
  project: AdProject;
  config: AdProjectConfig;
  name: string;
  jobs: AdRenderJob[];
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onChange: (config: AdProjectConfig) => void;
  onProject: (project: AdProject) => Promise<void>;
  onSelect: (id: number) => void;
  onError: (message: string) => void;
}) {
  const client = useQueryClient();
  const [tab, setTab] = useState<(typeof tabs)[number] | null>(null);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const [tags, setTags] = useState("");
  const [label, setLabel] = useState("");
  const [signature, setSignature] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    description: string;
    confirmLabel?: string;
    action: () => Promise<void>;
  } | null>(null);
  const tabsId = useId();
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const locked = disabled || busy;
  const [brandEdit, setBrandEdit] = useState<
    StudioRecord<BrandKit> | undefined
  >();
  const [tone, setTone] = useState("direct");
  const [suggestion, setSuggestion] = useState<{
    texts: string[];
    caption: string;
  } | null>(null);
  const [plannerDirty, setPlannerDirty] = useState(false);
  const [metricsDirty, setMetricsDirty] = useState(false);
  const [brandBaseline, setBrandBaseline] = useState({ label: "", signature: "" });
  const [appliedSuggestion, setAppliedSuggestion] = useState<string | null>(null);
  const { dirty: tagsDirty, markClean: markTagsClean } = useDraftBaseline(tags);
  const brandDirty = label !== brandBaseline.label || signature !== brandBaseline.signature;
  const suggestionDirty = suggestion !== null && JSON.stringify(suggestion) !== appliedSuggestion;
  const toolsDirty = busy || tagsDirty || brandDirty || suggestionDirty || plannerDirty || metricsDirty;
  useEffect(() => { onDirtyChange?.(toolsDirty) }, [onDirtyChange, toolsDirty]);
  useEffect(() => () => { onDirtyChange?.(false) }, [onDirtyChange]);
  function loadBrand(record: StudioRecord<BrandKit>) {
    const next = { label: record.payload.name, signature: record.payload.signature };
    setLabel(next.label);
    setSignature(next.signature);
    setBrandBaseline(next);
    setBrandEdit(record);
  }
  const products = useQuery({
    queryKey: ["studio-products"],
    enabled: tab === "Produtos",
    queryFn: async () => {
      const items = [];
      let offset = 0;
      while (true) {
        const page = await savedProductApi.list(100, offset);
        items.push(...page.items);
        offset += page.items.length;
        if (offset >= page.total || !page.items.length) return items;
      }
    },
  });
  const library = useQuery({
    queryKey: ["studio", "library", search],
    enabled: tab === "Mídias",
    queryFn: () =>
      studioApi.all<LibraryMedia>(
        "library",
        search.trim().split(/\s+/)[0] ?? "",
      ),
  });
  const brands = useQuery({
    queryKey: ["studio", "brand"],
    enabled: tab === "Marca e templates",
    queryFn: () => studioApi.all<BrandKit>("brand"),
  });
  const templates = useQuery({
    queryKey: ["studio", "template"],
    enabled: tab === "Marca e templates",
    queryFn: () =>
      studioApi.all<{
        name: string;
        config: AdProjectConfig;
        slideLayouts?: Omit<AdCarouselSlide, "assetId">[];
      }>("template"),
  });
  const publications = useQuery({
    queryKey: ["studio", "publication"],
    enabled: tab === "Calendário" || tab === "Resultados",
    queryFn: () => studioApi.all<Publication>("publication"),
  });
  const [variantFormat, setVariantFormat] = useState<
    "feed" | "carousel" | "reels" | "stories"
  >("reels");
  const [variantFraming, setVariantFraming] = useState(config.framing);
  async function run(action: () => Promise<void>) {
    onBusy(true);
    setBusy(true);
    setNotice("");
    setActionError("");
    try {
      await action();
      setNotice((current) => current || "Solicitação concluída.");
    } catch (error) {
      const message = apiErrorMessage(error);
      setActionError(message);
      onError(message);
    } finally {
      onBusy(false);
      setBusy(false);
    }
  }
  async function persist(next: AdProjectConfig) {
    const saved = await adProjectApi.update(project.id, {
      name: name.trim(),
      config: next,
      expectedRevision: project.revision,
    });
    onChange(saved.config);
    await onProject(saved);
  }
  function addAssets(assets: AdAsset[], base = config): AdProjectConfig {
    const visual = assets.filter((a) => a.kind !== "music");
    const music = assets.filter((a) => a.kind === "music");
    if (
      base.kind === "carousel" &&
      (base.carousel?.slides.length ?? 0) + visual.length > 20
    )
      throw new Error("O carrossel aceita até 20 slides");
    if (
      base.selectedClipIds.length + visual.length > 50 ||
      base.musicTracks.length + music.length > 8
    )
      throw new Error("Limite de mídias do projeto atingido");
    return {
      ...base,
      selectedClipIds: [...base.selectedClipIds, ...visual.map((a) => a.id)],
      carousel: {
        caption: base.carousel?.caption ?? "",
        slides: [
          ...(base.carousel?.slides ?? []),
          ...(base.kind === "carousel"
            ? visual.map((a) => ({
                assetId: a.id,
                text: "",
                durationSeconds: Math.max(
                  3,
                  Math.min(60, a.durationSeconds || 5),
                ),
              }))
            : []),
        ],
      },
      musicTracks: [
        ...base.musicTracks,
        ...music.map((a) => ({
          assetId: a.id,
          volume: 0.8,
          startSeconds: 0,
          endSeconds: null,
          sourceStartSeconds: 0,
          fadeInSeconds: 0,
          fadeOutSeconds: 0.8,
        })),
      ],
    };
  }
  async function saveTemplate() {
    const clean: AdProjectConfig = {
      ...config,
      selectedClipIds: [],
      clipEdits: {},
      productIds: [],
      musicAssetId: null,
      musicTracks: [],
      carousel: { slides: [], caption: config.carousel?.caption ?? "" },
      hook: { ...config.hook, clipAssetId: null },
    };
    await studioApi.save("template", {
      name: label.trim() || name,
      config: clean,
      slideLayouts: (config.carousel?.slides ?? []).map(
        ({ assetId: _id, ...layout }) => {
          void _id;
          return {
            ...layout,
            ...(layout.edit
              ? {
                  edit: {
                    ...layout.edit,
                    trimStart: 0,
                    trimEnd: null,
                    speed: 1 as const,
                  },
                }
              : {}),
          };
        },
      ),
    });
    await client.invalidateQueries({ queryKey: ["studio", "template"] });
    setBrandBaseline((previous) => ({ ...previous, label }));
    setNotice("Template salvo na sua conta.");
  }
  const activeQueries =
    tab === "Produtos"
      ? [products]
      : tab === "Mídias"
        ? [library]
        : tab === "Marca e templates"
          ? [brands, templates]
          : tab === "Calendário" || tab === "Resultados"
            ? [publications]
            : [];
  const failedQueries = activeQueries.filter((query) => query.isError);
  const queryError = failedQueries[0]?.error;
  const loading = activeQueries.some((query) => query.isPending);
  const filteredProducts = (products.data ?? []).filter((product) =>
    product.offer.title
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  const hiddenSelected = chosen.filter(
    (id) => !filteredProducts.some((product) => product.id === id),
  ).length;
  function openTab(next: (typeof tabs)[number]) {
    setTab(next);
    setSearch("");
    setActionError("");
    setNotice("");
  }
  return (
    <section
      className="min-w-0 rounded-xl border border-line bg-surface text-ink"
      aria-label="Ferramentas do estúdio"
    >
      <div className="flex items-center gap-3 border-b border-line px-3 py-2">
        <h2 className="shrink-0 text-sm font-semibold">Ferramentas</h2>
        <span className="text-xs text-muted">
          Produtos, arquivos e publicação
        </span>
      </div>
      <motion.div
        layoutScroll
        className="max-w-full overflow-x-auto p-2"
        role="tablist"
        aria-label="Ferramentas de criação"
      >
        <AnimatedSelection value={tab}>
          {(indicator) => (
            <div className="flex w-max min-w-full gap-2">
              {tabs.map((t, index) => (
                <button
                  type="button"
                  key={t}
                  id={`${tabsId}-tab-${index}`}
                  role="tab"
                  aria-selected={tab === t}
                  aria-controls={`${tabsId}-panel`}
                  tabIndex={tab === t || (!tab && index === 0) ? 0 : -1}
                  ref={(element) => {
                    tabButtons.current[index] = element;
                  }}
                  disabled={locked}
                  onClick={() => openTab(t)}
                  onKeyDown={(event) => {
                    const next =
                      event.key === "ArrowRight"
                        ? (index + 1) % tabs.length
                        : event.key === "ArrowLeft"
                          ? (index + tabs.length - 1) % tabs.length
                          : event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? tabs.length - 1
                              : null;
                    if (next === null) return;
                    event.preventDefault();
                    openTab(tabs[next]);
                    tabButtons.current[next]?.focus();
                    tabButtons.current[next]?.scrollIntoView({
                      block: "nearest",
                      inline: "nearest",
                    });
                  }}
                  className={`relative isolate min-h-11 shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold disabled:cursor-wait disabled:opacity-60 ${tab === t ? "text-accent" : "text-muted hover:bg-surface-muted"}`}
                >
                  {indicator(t)}
                  <span className="relative z-10">{t}</span>
                </button>
              ))}
            </div>
          )}
        </AnimatedSelection>
      </motion.div>
      <div
        hidden={!tab}
        id={`${tabsId}-panel`}
        role="tabpanel"
        aria-labelledby={tab ? `${tabsId}-tab-${tabs.indexOf(tab)}` : undefined}
        className="min-w-0 border-t border-line p-3 sm:p-4"
        tabIndex={0}
        aria-busy={busy || loading}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">{tab}</h3>
          <Button
            variant="ghost"
            disabled={locked}
            onClick={() => {
              const index = tab ? tabs.indexOf(tab) : 0;
              setTab(null);
              tabButtons.current[index]?.focus();
            }}
          >
            Fechar ferramenta
          </Button>
        </div>
        {notice ? (
          <p
            role="status"
            className="mt-3 whitespace-pre-wrap text-xs text-success"
          >
            {notice}
          </p>
        ) : null}
        {queryError ? (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
          >
            <p>
              Não foi possível carregar {tab?.toLocaleLowerCase()}.{" "}
              {apiErrorMessage(queryError)}
            </p>
            <Button
              variant="secondary"
              className="mt-2"
              onClick={() => {
                void Promise.all(failedQueries.map((query) => query.refetch()));
              }}
            >
              Tentar novamente
            </Button>
          </div>
        ) : null}
        {actionError ? (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-danger-soft p-3 text-sm text-danger"
          >
            {actionError}
          </p>
        ) : null}
        {busy ? (
          <p role="status" className="mt-3 text-sm text-muted">
            Processando solicitação…
          </p>
        ) : null}
        {loading ? (
          <p role="status" className="mt-3 text-sm text-muted">
            Carregando {tab?.toLocaleLowerCase()}…
          </p>
        ) : null}
        <div hidden={tab !== "Layouts e arquivos"}>
          <CreativeWorkbench
            project={project}
            config={config}
            onChange={onChange}
            disabled={locked}
            onError={onError}
          />
        </div>
        {tab === "Produtos" ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-muted">
              Importe imagens e fatos dos produtos salvos. Preços e cupons
              continuam editáveis no criativo.
            </p>
            <label className="block text-sm font-medium">
              Buscar produtos salvos
              <input
                className={field}
                aria-label="Buscar produtos salvos"
                placeholder="Buscar produtos salvos"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="text-muted">
                {chosen.length} de 20 produtos selecionados
                {hiddenSelected
                  ? ` (${hiddenSelected} fora da busca atual)`
                  : ""}
              </p>
              {chosen.length ? (
                <Button
                  variant="ghost"
                  disabled={locked}
                  onClick={() => setChosen([])}
                >
                  Limpar seleção
                </Button>
              ) : null}
            </div>
            {!products.isPending &&
            !products.isError &&
            !filteredProducts.length ? (
              <p className="rounded-lg bg-surface-muted p-3 text-sm text-muted">
                {search
                  ? "Nenhum produto corresponde à busca. Tente outro nome."
                  : "Nenhum produto salvo. Adicione produtos no catálogo para criar um anúncio."}
              </p>
            ) : null}
            <div className="grid max-h-80 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
              {products.isLoading
                ? null
                : filteredProducts.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 rounded-lg border border-line p-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={chosen.includes(p.id)}
                        disabled={
                          locked ||
                          (!chosen.includes(p.id) && chosen.length >= 20)
                        }
                        onChange={() =>
                          setChosen((v) =>
                            v.includes(p.id)
                              ? v.filter((id) => id !== p.id)
                              : [...v, p.id],
                          )
                        }
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {p.offer.title}
                        </span>
                        <span className="mt-1 block tabular-nums text-muted">
                          {new Intl.NumberFormat("pt-BR", {
                            style: "currency",
                            currency: p.offer.currency || "BRL",
                          }).format(p.offer.discountedPrice)}
                        </span>
                      </span>
                    </label>
                  ))}
            </div>
            <Button
              disabled={locked || !chosen.length}
              onClick={() =>
                void run(async () => {
                  if (
                    config.kind === "carousel" &&
                    (config.carousel?.slides.length ?? 0) + chosen.length > 20
                  )
                    throw new Error(
                      "Remova slides ou selecione menos produtos. O limite é 20.",
                    );
                  const result = await studioApi.importProducts(
                    project.id,
                    chosen,
                  );
                  if (result.items.length) {
                    const next = addAssets(result.items.map((i) => i.asset));
                    next.productIds = [
                      ...new Set([
                        ...(config.productIds ?? []),
                        ...result.items.map((i) => i.product.id),
                      ]),
                    ];
                    const lines = result.items.map((i) => i.product.text);
                    next.texts = [
                      ...config.texts.filter((t) => t.trim()),
                      ...lines,
                    ].slice(-20);
                    next.carousel = {
                      caption: [
                        config.carousel?.caption,
                        ...result.items.map((i) => i.product.caption),
                      ]
                        .filter(Boolean)
                        .join("\n\n")
                        .slice(0, 2200),
                      slides: next.carousel!.slides.map((s) => ({
                        ...s,
                        text:
                          result.items.find((i) => i.asset.id === s.assetId)
                            ?.product.text ?? s.text,
                      })),
                    };
                    await persist(next);
                  }
                  setNotice(
                    `${result.items.length} produto(s) importado(s).${result.errors.length ? "\n" + result.errors.map((e) => `Produto ${e.productId}: ${e.message}`).join("\n") : ""}`,
                  );
                })
              }
            >
              Criar com {chosen.length} produto(s)
            </Button>
          </div>
        ) : null}
        <div hidden={tab !== "Mídias"} className="mt-4 space-y-4">
          <label className="block text-sm font-medium">
            Enviar imagens e vídeos juntos
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
              disabled={locked}
              className="mt-2 block w-full text-xs"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (!files.length) return;
                void run(async () => {
                  preflightMediaLibrary(
                    config,
                    files.map((file) => ({
                      kind: file.type.startsWith("image/") ? "image" : "clip",
                    })),
                  );
                  const assets: AdAsset[] = [];
                  try {
                    // Sequential uploads preserve mixed selection order across MIME types.
                    for (const f of files)
                      assets.push(
                        ...(await adProjectApi.uploadAssets(
                          project.id,
                          f.type.startsWith("image/") ? "image" : "clip",
                          [f],
                        )),
                      );
                    await persist(addAssets(assets));
                    setNotice(
                      `${assets.length} mídias adicionadas na ordem selecionada.`,
                    );
                  } catch (error) {
                    await Promise.allSettled(
                      assets.map((a) =>
                        adProjectApi.removeAsset(project.id, a.id),
                      ),
                    );
                    throw error;
                  }
                });
              }}
            />
          </label>
          <label className="block text-sm font-medium">
            Tags para guardar ou atualizar mídias
            <input
              className={field}
              aria-label="Tags de mídia"
              placeholder="Tags separadas por vírgula"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </label>
          {!project.assets.length ? (
            <p className="rounded-lg bg-surface-muted p-3 text-sm text-muted">
              Este projeto ainda não tem mídias. Envie arquivos ou adicione
              itens da biblioteca.
            </p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {project.assets.map((asset) => (
              <div
                key={asset.id}
                className="flex min-w-0 items-center gap-2 rounded-lg bg-surface-muted p-2"
              >
                <span className="min-w-0 flex-1 truncate text-xs">
                  {asset.originalName}
                </span>
                <Button
                  variant="secondary"
                  disabled={locked}
                  onClick={() =>
                    void run(async () => {
                      const result = await studioApi.saveMedia(
                        project.id,
                        asset,
                        tags
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                        config.productIds ?? [],
                      );
                      await client.invalidateQueries({
                        queryKey: ["studio", "library"],
                      });
                      markTagsClean(tags);
                      setNotice(
                        result.duplicate
                          ? "Esta mídia já está na biblioteca (mesmo conteúdo)."
                          : "Mídia salva na biblioteca compartilhada da sua conta.",
                      );
                    })
                  }
                >
                  Guardar
                </Button>
              </div>
            ))}
          </div>
          <MediaLibraryPicker
            records={library.data ?? []}
            loading={library.isFetching}
            search={search}
            onSearch={setSearch}
            project={project}
            config={config}
            name={name}
            disabled={locked}
            onBusy={onBusy}
            onChange={onChange}
            onProject={onProject}
            onError={onError}
            onEdit={(record) =>
              void run(async () => {
                await studioApi.editMedia(record.id, {
                  name: record.payload.name,
                  tags: tags
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                  productIds: config.productIds ?? [],
                });
                await client.invalidateQueries({
                  queryKey: ["studio", "library"],
                });
                markTagsClean(tags);
              })
            }
            onDelete={(record) =>
              setConfirmation({
                title: "Excluir mídia da biblioteca?",
                description: `“${record.payload.name}” deixará de aparecer na biblioteca da conta.`,
                action: async () => {
                  await studioApi.remove(record.id);
                  await client.invalidateQueries({
                    queryKey: ["studio", "library"],
                  });
                },
              })
            }
          />
        </div>
        {tab === "Marca e templates" ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-muted">
              Guarde as cores, estilo de texto e assinatura atuais como kit de
              marca. Templates também guardam formato, efeitos e ritmo, sem
              carregar mídias de outro projeto.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Nome da marca ou template
                <input
                  className={field}
                  placeholder="Ex.: Ofertas da semana"
                  aria-label="Nome da marca ou template"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
              <label className="block text-sm font-medium">
                Assinatura da marca
                <input
                  className={field}
                  placeholder="Texto incluído na legenda"
                  aria-label="Assinatura da marca"
                  maxLength={150}
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={locked || !label.trim()}
                onClick={() =>
                  void run(async () => {
                    await studioApi.save(
                      "brand",
                      {
                        name: label,
                        textStyle: config.textStyle,
                        backgroundColor: config.framing.backgroundColor,
                        signature,
                      },
                      brandEdit,
                    );
                    setBrandBaseline({ label, signature });
                    setBrandEdit(undefined);
                    await client.invalidateQueries({
                      queryKey: ["studio", "brand"],
                    });
                    setNotice("Kit de marca salvo.");
                  })
                }
              >
                {brandEdit ? "Atualizar marca" : "Salvar marca atual"}
              </Button>
              <Button
                disabled={locked || !label.trim()}
                variant="secondary"
                onClick={() => void run(saveTemplate)}
              >
                Salvar template atual
              </Button>
              {brandEdit ? (
                <Button
                  variant="ghost"
                  disabled={locked}
                  onClick={() => {
                    setBrandEdit(undefined);
                    setLabel("");
                    setSignature("");
                    setBrandBaseline({ label: "", signature: "" });
                  }}
                >
                  Cancelar edição da marca
                </Button>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {["Preço em destaque", "Produto em foco", "Guia de detalhes"].map(
                (t, index) => (
                  <Button
                    key={t}
                    variant="secondary"
                    disabled={locked}
                    onClick={() =>
                      onChange({
                        ...config,
                        textStyle: {
                          ...config.textStyle,
                          positionY: [72, 80, 25][index],
                          fontSize: [84, 64, 58][index],
                        },
                        framing: {
                          ...config.framing,
                          mode: index === 1 ? "contain-solid" : "cover",
                        },
                        carousel: {
                          caption: config.carousel?.caption ?? "",
                          slides: (config.carousel?.slides ?? []).map((s) => ({
                            ...s,
                            textStyle: undefined,
                          })),
                        },
                      })
                    }
                  >
                    {t}
                  </Button>
                ),
              )}
            </div>
            <h4 className="border-t border-line pt-4 text-sm font-semibold">
              Kits de marca
            </h4>
            {!brands.isPending && !brands.isError && !brands.data?.length ? (
              <p className="text-sm text-muted">
                Nenhum kit salvo. Salve o estilo atual para reutilizá-lo.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {brands.data?.map((r) => (
                <div key={r.id} className="rounded-lg border border-line p-3">
                  <p className="text-sm font-medium">{r.payload.name}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={locked}
                      onClick={() =>
                        onChange({
                          ...config,
                          textStyle: r.payload.textStyle,
                          framing: {
                            ...config.framing,
                            backgroundColor: r.payload.backgroundColor,
                          },
                          carousel: {
                            slides: (config.carousel?.slides ?? []).map(
                              (s) => ({
                                ...s,
                                textStyle: undefined,
                              }),
                            ),
                            caption: [
                              config.carousel?.caption,
                              r.payload.signature,
                            ]
                              .filter(Boolean)
                              .join("\n")
                              .slice(0, 2200),
                          },
                        })
                      }
                    >
                      Aplicar marca
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (!brandDirty) { loadBrand(r); return; }
                        setConfirmation({
                          title: "Trocar a marca em edição?",
                          description: "Os campos ainda não salvos desta marca serão descartados.",
                          confirmLabel: "Descartar e abrir",
                          action: async () => { loadBrand(r); },
                        });
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={locked}
                      onClick={() =>
                        setConfirmation({
                          title: "Excluir kit de marca?",
                          description:
                            "O kit deixará de estar disponível para novos usos. Os estilos já aplicados aos projetos serão preservados.",
                          action: async () => {
                            await studioApi.remove(r.id);
                            await client.invalidateQueries({
                              queryKey: ["studio", "brand"],
                            });
                          },
                        })
                      }
                    >
                      Excluir
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <h4 className="border-t border-line pt-4 text-sm font-semibold">
              Templates
            </h4>
            {!templates.isPending &&
            !templates.isError &&
            !templates.data?.length ? (
              <p className="text-sm text-muted">
                Nenhum template salvo. Salve formato, efeitos e ritmo do projeto
                atual.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {templates.data?.map((r) => (
                <div key={r.id} className="rounded-lg border border-line p-3">
                  <p className="text-sm font-medium">
                    Template: {r.payload.name}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={locked}
                      onClick={() => {
                        const c = r.payload.config;
                        onChange({
                          ...config,
                          texts: c.texts,
                          timing: c.timing,
                          transition: c.transition,
                          visualEffects: c.visualEffects,
                          colorPreset: c.colorPreset,
                          textStyle: c.textStyle,
                          framing: c.framing,
                          output: {
                            ...config.output,
                            width: c.output.width,
                            height:
                              config.kind === "carousel" &&
                              c.output.height === 1920
                                ? 1350
                                : c.output.height,
                          },
                          carousel: {
                            slides: (config.carousel?.slides ?? []).map(
                              (slide, index) => {
                                const layouts = r.payload.slideLayouts ?? [];
                                const layout = layouts.length
                                  ? layouts[index % layouts.length]
                                  : undefined;
                                return {
                                  ...slide,
                                  textStyle: undefined,
                                  ...layout,
                                };
                              },
                            ),
                            caption:
                              c.carousel?.caption ??
                              config.carousel?.caption ??
                              "",
                          },
                        });
                      }}
                    >
                      Aplicar template
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={locked}
                      onClick={() =>
                        setConfirmation({
                          title: "Excluir template?",
                          description:
                            "O template deixará de estar disponível para novos usos. Os projetos já criados serão preservados.",
                          action: async () => {
                            await studioApi.remove(r.id);
                            await client.invalidateQueries({
                              queryKey: ["studio", "template"],
                            });
                          },
                        })
                      }
                    >
                      Excluir
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {tab === "Formatos" ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-muted">
              Crie um projeto independente para cada formato e ajuste seu
              enquadramento. A cópia inclui as mídias e pode ser renderizada
              separadamente.
            </p>
            <div className="grid gap-2 sm:grid-cols-4">
              <label className="block text-sm font-medium">
                Formato da variante
                <select
                  aria-label="Formato da variante"
                  className={field}
                  value={variantFormat}
                  onChange={(e) =>
                    setVariantFormat(e.target.value as typeof variantFormat)
                  }
                >
                  <option value="feed">Feed 4:5</option>
                  <option value="carousel">Carrossel 4:5</option>
                  <option value="reels">Reels 9:16</option>
                  <option value="stories">Stories 9:16</option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                Enquadramento da variante
                <select
                  aria-label="Enquadramento da variante"
                  className={field}
                  value={variantFraming.mode}
                  onChange={(e) =>
                    setVariantFraming({
                      ...variantFraming,
                      mode: e.target.value as typeof variantFraming.mode,
                    })
                  }
                >
                  <option value="cover">Preencher</option>
                  <option value="contain-solid">Conter com fundo</option>
                  <option value="contain-blur">Conter com desfoque</option>
                </select>
              </label>
              {(["focusX", "focusY"] as const).map((key) => (
                <label key={key} className="block text-sm font-medium">
                  Foco {key === "focusX" ? "horizontal" : "vertical"}
                  <input
                    className={field}
                    type="number"
                    min={0}
                    max={100}
                    value={variantFraming[key]}
                    onChange={(e) =>
                      setVariantFraming({
                        ...variantFraming,
                        [key]: Number(e.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <Button
              disabled={locked}
              onClick={() =>
                void run(async () => {
                  await persist(config);
                  const clone = await studioApi.variant(
                    project.id,
                    variantFormat,
                    variantFraming,
                  );
                  await onProject(clone);
                  onSelect(clone.id);
                })
              }
            >
              Criar variante
            </Button>
          </div>
        ) : null}
        {tab === "Textos com IA" ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-muted">
              A IA escolhe chamadas; título, preço, cupom e link vêm dos
              produtos vinculados. Revise antes de aplicar.
            </p>
            <label className="block text-sm font-medium">
              Tom da sugestão
              <select
                className={field}
                aria-label="Tom da sugestão"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
              >
                <option value="direct">Direto</option>
                <option value="friendly">Amigável</option>
                <option value="educational">Informativo</option>
              </select>
            </label>
            <Button
              disabled={locked || !config.productIds?.length}
              onClick={() =>
                void run(async () =>
                  setSuggestion(
                    await studioApi.suggest(
                      config.productIds!.slice(0, 20),
                      tone,
                    ),
                  ),
                )
              }
            >
              Sugerir textos
            </Button>
            {!config.productIds?.length ? (
              <p className="text-xs text-muted">
                Importe produtos pela aba Produtos primeiro.
              </p>
            ) : null}
            {suggestion ? (
              <>
                <label className="block text-sm font-medium">
                  Textos (um por bloco, separados por linha em branco)
                  <textarea
                    className={field}
                    rows={5}
                    value={suggestion.texts.join("\n\n")}
                    onChange={(e) =>
                      setSuggestion({
                        ...suggestion,
                        texts: e.target.value
                          .split("\n\n")
                          .slice(0, 20)
                          .map((t) => t.slice(0, 280)),
                      })
                    }
                  />
                </label>
                <label className="block text-sm font-medium">
                  Legenda
                  <textarea
                    className={field}
                    maxLength={2200}
                    rows={5}
                    value={suggestion.caption}
                    onChange={(e) =>
                      setSuggestion({
                        ...suggestion,
                        caption: e.target.value,
                      })
                    }
                  />
                </label>
                <Button
                  disabled={locked}
                  onClick={() => {
                    onChange({
                      ...config,
                      texts: suggestion.texts.filter((t) => t.trim()).length
                        ? suggestion.texts.filter((t) => t.trim())
                        : config.texts,
                      carousel: {
                        caption: suggestion.caption,
                        slides: (config.carousel?.slides ?? []).map((s, i) => ({
                          ...s,
                          text: suggestion.texts[i] ?? s.text,
                        })),
                      },
                    });
                    setAppliedSuggestion(JSON.stringify(suggestion));
                    setNotice(
                      "Sugestão aplicada. Você pode continuar editando.",
                    );
                  }}
                >
                  Aplicar textos revisados
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
        {publications.data ? (
          <div hidden={tab !== "Calendário"}>
            <PublicationPlanner
              project={project}
              config={config}
              name={name}
              jobs={jobs}
              records={publications.data ?? []}
              disabled={locked}
              onDirtyChange={setPlannerDirty}
              run={run}
              onSaved={async () => {
                await client.invalidateQueries({
                  queryKey: ["studio", "publication"],
                });
                setNotice("Calendário atualizado.");
              }}
            />
          </div>
        ) : null}
        {publications.data ? (
          <div hidden={tab !== "Resultados"}>
            <PerformanceRecords
              records={publications.data ?? []}
              disabled={locked}
              onDirtyChange={setMetricsDirty}
              run={run}
              onSaved={async () => {
                await client.invalidateQueries({
                  queryKey: ["studio", "publication"],
                });
                setNotice("Medição salva.");
              }}
            />
          </div>
        ) : null}
      </div>
      {!tab ? (
        <p className="border-t border-line px-4 py-3 text-sm text-muted">
          Abra uma ferramenta para organizar o criativo ou planejar sua
          publicação manual.
        </p>
      ) : null}
      {confirmation ? (
        <StudioConfirmDialog
          title={confirmation.title}
          description={confirmation.description}
          confirmLabel={confirmation.confirmLabel}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation.action;
            setConfirmation(null);
            void run(action);
          }}
        />
      ) : null}
    </section>
  );
}
function PerformanceRecords({
  records,
  disabled,
  onDirtyChange,
  run,
  onSaved,
}: {
  records: StudioRecord<Publication>[];
  disabled: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  run: (action: () => Promise<void>) => Promise<void>;
  onSaved: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<CreativeMetrics>({
    impressions: 0,
    clicks: 0,
    saves: 0,
    likes: 0,
    comments: 0,
    sales: null,
    revenue: null,
    attribution: "",
    observedAt: new Date().toISOString(),
    source: "manual",
  });
  const row = records.find((r) => r.id === selected);
  const snapshot = JSON.stringify(metrics);
  const { dirty, markClean } = useDraftBaseline(snapshot, onDirtyChange);
  const [nextRecord, setNextRecord] = useState<number | null>(null);
  function selectRecord(id: number) {
    const record = records.find((r) => r.id === id);
    const next = record?.payload.metrics ?? {
      ...metrics, impressions: 0, clicks: 0, saves: 0, likes: 0,
      comments: 0, sales: null, revenue: null, attribution: "",
      observedAt: new Date().toISOString(),
    };
    setSelected(id || null);
    setMetrics(next);
    markClean(JSON.stringify(next));
    setNextRecord(null);
  }
  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs text-muted">
        Registre medições cumulativas com a fonte e data de observação. Vendas
        ficam sem atribuição até você informar sua fonte.
      </p>
      <p className="rounded-lg bg-info-soft p-3 text-sm text-info">
        Medições informadas manualmente. Estes dados não são sincronizados com o
        Instagram.
      </p>
      {!records.length ? (
        <p className="rounded-lg bg-surface-muted p-4 text-sm text-muted">
          Crie um registro no Calendário para vincular suas medições ao
          criativo.
        </p>
      ) : null}
      <label className="block text-sm font-medium">
        Registro do calendário
        <select
          className={field}
          aria-label="Criativo para medir"
          value={selected ?? ""}
          onChange={(e) => {
            const id = Number(e.target.value);
            if (dirty && id !== selected) setNextRecord(id);
            else selectRecord(id);
          }}
        >
          <option value="">Selecione um registro do calendário</option>
          {records.map((r) => (
            <option key={r.id} value={r.id}>
              {r.payload.name}
            </option>
          ))}
        </select>
      </label>
      {row ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {(
              [
                "impressions",
                "clicks",
                "saves",
                "likes",
                "comments",
                "sales",
                "revenue",
              ] as const
            ).map((key) => (
              <label className="block text-sm font-medium" key={key}>
                {
                  {
                    impressions: "Impressões",
                    clicks: "Cliques",
                    saves: "Salvamentos",
                    likes: "Curtidas",
                    comments: "Comentários",
                    sales: "Vendas atribuídas",
                    revenue: "Receita atribuída",
                  }[key]
                }
                <input
                  className={field}
                  type="number"
                  min={0}
                  step={key === "revenue" ? "0.01" : "1"}
                  value={metrics[key] ?? ""}
                  onChange={(e) =>
                    setMetrics({
                      ...metrics,
                      [key]:
                        e.target.value === "" &&
                        (key === "sales" || key === "revenue")
                          ? null
                          : Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
          </div>
          <label className="block text-sm font-medium">
            Data da observação
            <input
              type="datetime-local"
              className={field}
              value={localDate(metrics.observedAt)}
              onChange={(e) =>
                e.target.value &&
                setMetrics({
                  ...metrics,
                  observedAt: new Date(e.target.value).toISOString(),
                })
              }
            />
          </label>
          <label className="block text-sm font-medium">
            Fonte da medição e atribuição
            <input
              className={field}
              aria-label="Fonte da atribuição"
              placeholder="Fonte da medição / atribuição de vendas"
              maxLength={500}
              value={metrics.attribution}
              onChange={(e) =>
                setMetrics({ ...metrics, attribution: e.target.value })
              }
            />
          </label>
          <p className="text-xs text-muted">
            Deixe vendas e receita vazias quando não houver atribuição
            comprovada. Informe a fonte ao atribuir vendas.
          </p>
          <p className="text-xs">
            Produtos vinculados: {row.payload.productIds.join(", ") || "Nenhum"}
          </p>
          <Button
            disabled={disabled}
            onClick={() =>
              void run(async () => {
                await studioApi.save(
                  "publication",
                  { ...row.payload, metrics },
                  row,
                );
                markClean(snapshot);
                await onSaved();
              })
            }
          >
            Salvar medição
          </Button>
        </>
      ) : null}
      {nextRecord !== null ? <StudioConfirmDialog
        title="Trocar a medição em edição?"
        description="As alterações desta medição ainda não foram salvas."
        confirmLabel="Descartar e abrir"
        onCancel={() => setNextRecord(null)}
        onConfirm={() => selectRecord(nextRecord)}
      /> : null}
      <div
        className="max-w-full overflow-x-auto rounded-lg border border-line"
        role="region"
        aria-label="Medições dos criativos; role horizontalmente para ver todas as colunas"
        tabIndex={0}
      >
        <table className="w-full min-w-[680px] text-left text-sm tabular-nums">
          <caption className="p-3 text-left font-medium">
            Medições registradas
          </caption>
          <thead>
            <tr>
              <th scope="col" className="bg-surface-muted p-3">
                Criativo / produtos
              </th>
              <th scope="col" className="bg-surface-muted p-3">
                Cliques
              </th>
              <th scope="col" className="bg-surface-muted p-3">
                Salvos
              </th>
              <th scope="col" className="bg-surface-muted p-3">
                Engajamento por impressão
              </th>
              <th scope="col" className="bg-surface-muted p-3">
                Vendas
              </th>
              <th scope="col" className="bg-surface-muted p-3">
                Observado
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const m = r.payload.metrics;
              return (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="p-3">
                    {r.payload.name}
                    <br />
                    <span className="text-xs text-muted">
                      {r.payload.productIds.join(", ") ||
                        "Sem produtos vinculados"}
                    </span>
                  </td>
                  <td className="p-3">{m?.clicks ?? "—"}</td>
                  <td className="p-3">{m?.saves ?? "—"}</td>
                  <td className="p-3">
                    {m && m.impressions > 0
                      ? `${((100 * (m.likes + m.comments + m.saves)) / m.impressions).toFixed(2)}%`
                      : "—"}
                  </td>
                  <td className="p-3">{m?.sales ?? "Sem atribuição"}</td>
                  <td className="p-3">
                    {m
                      ? new Date(m.observedAt).toLocaleDateString("pt-BR")
                      : "Sem medição"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function localDate(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
