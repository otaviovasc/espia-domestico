import { useState } from "react";
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
import { PublicationPlanner } from "./PublicationPlanner";
const tabs = [
  "Produtos",
  "Mídias",
  "Marca e templates",
  "Formatos",
  "Textos com IA",
  "Calendário",
  "Resultados",
] as const;
const field = "rounded-lg border border-zinc-300 p-2 text-sm w-full";
export function StudioTools({
  project,
  config,
  name,
  jobs,
  disabled,
  onBusy,
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
  const [brandEdit, setBrandEdit] = useState<
    StudioRecord<BrandKit> | undefined
  >();
  const [tone, setTone] = useState("direct");
  const [suggestion, setSuggestion] = useState<{
    texts: string[];
    caption: string;
  } | null>(null);
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
    queryFn: () => studioApi.all<LibraryMedia>("library", search),
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
    setNotice("");
    try {
      await action();
    } catch (error) {
      onError(apiErrorMessage(error));
    } finally {
      onBusy(false);
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
    setNotice("Template salvo na sua conta.");
  }
  const queryError = [products, library, brands, templates, publications].find(
    (q) => q.isError,
  )?.error;
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap gap-2" aria-label="Ferramentas de criação">
        {tabs.map((t) => (
          <button
            type="button"
            key={t}
            onClick={() => {
              setTab(tab === t ? null : t);
              setSearch("");
            }}
            className={`rounded-lg px-3 py-2 text-xs font-semibold ${tab === t ? "bg-violet-100 text-violet-800" : "text-zinc-600 hover:bg-zinc-100"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {notice ? (
        <p
          role="status"
          className="mt-3 whitespace-pre-wrap text-xs text-emerald-700"
        >
          {notice}
        </p>
      ) : null}
      {queryError ? (
        <p role="alert" className="mt-3 text-xs text-red-700">
          {apiErrorMessage(queryError)}
        </p>
      ) : null}
      {tab === "Produtos" ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-zinc-500">
            Importe imagens e fatos dos produtos salvos. Preços e cupons
            continuam editáveis no criativo.
          </p>
          <input
            className={field}
            aria-label="Buscar produtos salvos"
            placeholder="Buscar produtos salvos"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="grid max-h-64 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
            {products.isLoading ? (
              <p>Carregando produtos...</p>
            ) : (
              (products.data ?? [])
                .filter((p) =>
                  p.offer.title
                    .toLocaleLowerCase()
                    .includes(search.toLocaleLowerCase()),
                )
                .map((p) => (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 rounded-lg border border-zinc-200 p-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={chosen.includes(p.id)}
                      disabled={
                        disabled ||
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
                    <span>{p.offer.title}</span>
                  </label>
                ))
            )}
          </div>
          <Button
            disabled={disabled || !chosen.length}
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
      {tab === "Mídias" ? (
        <div className="mt-4 space-y-4">
          <label className="block text-sm font-medium">
            Enviar imagens e vídeos juntos
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
              disabled={disabled}
              className="mt-2 block w-full text-xs"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (!files.length) return;
                void run(async () => {
                  if (
                    files.length > 50 ||
                    (config.kind === "carousel" &&
                      (config.carousel?.slides.length ?? 0) + files.length > 20)
                  )
                    throw new Error(
                      "Selecione arquivos dentro do limite do projeto",
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
          <input
            className={field}
            aria-label="Tags de mídia"
            placeholder="Tags separadas por vírgula"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            {project.assets.map((asset) => (
              <div
                key={asset.id}
                className="flex min-w-0 items-center gap-2 rounded-lg bg-zinc-50 p-2"
              >
                <span className="min-w-0 flex-1 truncate text-xs">
                  {asset.originalName}
                </span>
                <Button
                  variant="secondary"
                  disabled={disabled}
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
          <input
            className={field}
            aria-label="Buscar biblioteca de mídias"
            placeholder="Buscar por nome, tag ou ID do produto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="grid max-h-64 gap-2 overflow-auto sm:grid-cols-2">
            {library.data?.map((r) => (
              <div
                key={r.id}
                className="space-y-2 rounded-lg border border-zinc-200 p-3 text-xs"
              >
                <p className="font-medium">{r.payload.name}</p>
                <p>
                  {r.payload.kind} ·{" "}
                  {(r.payload.sizeBytes / 1024 / 1024).toFixed(1)} MB ·{" "}
                  {r.payload.tags.join(", ")}
                </p>
                <p>Produtos: {r.payload.productIds.join(", ") || "Nenhum"}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    onClick={() =>
                      void run(async () => {
                        const asset = await studioApi.attach(project.id, r.id);
                        try {
                          await persist(addAssets([asset]));
                        } catch (error) {
                          await adProjectApi.removeAsset(project.id, asset.id);
                          throw error;
                        }
                      })
                    }
                  >
                    Usar neste projeto
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    onClick={() =>
                      void run(async () => {
                        await studioApi.editMedia(r.id, {
                          name: r.payload.name,
                          tags: tags
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean),
                          productIds: config.productIds ?? [],
                        });
                        await client.invalidateQueries({
                          queryKey: ["studio", "library"],
                        });
                      })
                    }
                  >
                    Aplicar tags e produtos
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    onClick={() =>
                      void run(async () => {
                        await studioApi.remove(r.id);
                        await client.invalidateQueries({
                          queryKey: ["studio", "library"],
                        });
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
      {tab === "Marca e templates" ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-zinc-500">
            Guarde as cores, estilo de texto e assinatura atuais como kit de
            marca. Templates também guardam formato, efeitos e ritmo, sem
            carregar mídias de outro projeto.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className={field}
              placeholder="Nome da marca ou template"
              aria-label="Nome da marca ou template"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <input
              className={field}
              placeholder="Assinatura da marca"
              aria-label="Assinatura da marca"
              maxLength={150}
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={disabled || !label.trim()}
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
              disabled={disabled || !label.trim()}
              variant="secondary"
              onClick={() => void run(saveTemplate)}
            >
              Salvar template atual
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {["Preço em destaque", "Produto em foco", "Guia de detalhes"].map(
              (t, index) => (
                <Button
                  key={t}
                  variant="secondary"
                  disabled={disabled}
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
          <div className="grid gap-3 sm:grid-cols-2">
            {brands.data?.map((r) => (
              <div key={r.id} className="rounded-lg border border-zinc-200 p-3">
                <p className="text-sm font-medium">{r.payload.name}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    onClick={() =>
                      onChange({
                        ...config,
                        textStyle: r.payload.textStyle,
                        framing: {
                          ...config.framing,
                          backgroundColor: r.payload.backgroundColor,
                        },
                        carousel: {
                          slides: (config.carousel?.slides ?? []).map((s) => ({
                            ...s,
                            textStyle: undefined,
                          })),
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
                      setLabel(r.payload.name);
                      setSignature(r.payload.signature);
                      setBrandEdit(r);
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    onClick={() =>
                      void run(async () => {
                        await studioApi.remove(r.id);
                        await client.invalidateQueries({
                          queryKey: ["studio", "brand"],
                        });
                      })
                    }
                  >
                    Excluir
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.data?.map((r) => (
              <div key={r.id} className="rounded-lg border border-zinc-200 p-3">
                <p className="text-sm font-medium">
                  Template: {r.payload.name}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="secondary"
                    disabled={disabled}
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
                    disabled={disabled}
                    onClick={() =>
                      void run(async () => {
                        await studioApi.remove(r.id);
                        await client.invalidateQueries({
                          queryKey: ["studio", "template"],
                        });
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
          <p className="text-xs text-zinc-500">
            Crie um projeto independente para cada formato e ajuste seu
            enquadramento. A cópia inclui as mídias e pode ser renderizada
            separadamente.
          </p>
          <div className="grid gap-2 sm:grid-cols-4">
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
            {(["focusX", "focusY"] as const).map((key) => (
              <label key={key} className="text-xs">
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
            disabled={disabled}
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
          <p className="text-xs text-zinc-500">
            A IA escolhe chamadas; título, preço, cupom e link vêm dos produtos
            vinculados. Revise antes de aplicar.
          </p>
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
          <Button
            disabled={disabled || !config.productIds?.length}
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
            <p className="text-xs text-zinc-500">
              Importe produtos pela aba Produtos primeiro.
            </p>
          ) : null}
          {suggestion ? (
            <>
              <label className="block text-xs">
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
              <label className="block text-xs">
                Legenda
                <textarea
                  className={field}
                  maxLength={2200}
                  rows={5}
                  value={suggestion.caption}
                  onChange={(e) =>
                    setSuggestion({ ...suggestion, caption: e.target.value })
                  }
                />
              </label>
              <Button
                disabled={disabled}
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
                  setNotice("Sugestão aplicada. Você pode continuar editando.");
                }}
              >
                Aplicar textos revisados
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {tab === "Calendário" ? (
        <PublicationPlanner
          project={project}
          config={config}
          name={name}
          jobs={jobs}
          records={publications.data ?? []}
          disabled={disabled}
          run={run}
          onSaved={async () => {
            await client.invalidateQueries({
              queryKey: ["studio", "publication"],
            });
          }}
        />
      ) : null}
      {tab === "Resultados" ? (
        <PerformanceRecords
          records={publications.data ?? []}
          disabled={disabled}
          run={run}
          onSaved={async () => {
            await client.invalidateQueries({
              queryKey: ["studio", "publication"],
            });
          }}
        />
      ) : null}
    </section>
  );
}
function PerformanceRecords({
  records,
  disabled,
  run,
  onSaved,
}: {
  records: StudioRecord<Publication>[];
  disabled: boolean;
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
  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs text-zinc-500">
        Registre medições cumulativas com a fonte e data de observação. Vendas
        ficam sem atribuição até você informar sua fonte.
      </p>
      <select
        className={field}
        aria-label="Criativo para medir"
        value={selected ?? ""}
        onChange={(e) => {
          const id = Number(e.target.value);
          setSelected(id || null);
          const record = records.find((r) => r.id === id);
          setMetrics(
            record?.payload.metrics ?? {
              ...metrics,
              impressions: 0,
              clicks: 0,
              saves: 0,
              likes: 0,
              comments: 0,
              sales: null,
              revenue: null,
              attribution: "",
              observedAt: new Date().toISOString(),
            },
          );
        }}
      >
        <option value="">Selecione um registro do calendário</option>
        {records.map((r) => (
          <option key={r.id} value={r.id}>
            {r.payload.name}
          </option>
        ))}
      </select>
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
              <label className="text-xs" key={key}>
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
          <label className="block text-xs">
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
                await onSaved();
              })
            }
          >
            Salvar medição
          </Button>
        </>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr>
              <th className="p-2">Criativo / produtos</th>
              <th>Cliques</th>
              <th>Salvos</th>
              <th>Engajamento por impressão</th>
              <th>Vendas</th>
              <th>Observado</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const m = r.payload.metrics;
              return (
                <tr key={r.id} className="border-t border-zinc-100">
                  <td className="p-2">
                    {r.payload.name}
                    <br />
                    {r.payload.productIds.join(", ")}
                  </td>
                  <td>{m?.clicks ?? "—"}</td>
                  <td>{m?.saves ?? "—"}</td>
                  <td>
                    {m && m.impressions > 0
                      ? `${((100 * (m.likes + m.comments + m.saves)) / m.impressions).toFixed(2)}%`
                      : "—"}
                  </td>
                  <td>{m?.sales ?? "Sem atribuição"}</td>
                  <td>
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
