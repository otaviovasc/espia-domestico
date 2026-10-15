import { useQuery } from "@tanstack/react-query";
import { adProjectApi, apiErrorMessage } from "@/lib/api";
import { useEffect, useId, useRef, useState } from "react";
import { studioApi } from "@/lib/adStudioApi";
import type { Publication, StudioRecord } from "@/lib/adStudioApi";
import type { AdProject, AdProjectConfig, AdRenderJob } from "@/lib/api";
import { wallTime, wallTimeToUtc } from "@/lib/adCalendar";
import { Button } from "@/components/ui";
import { useDraftBaseline } from "@/hooks/useDraftBaseline";
const field =
  "field-control w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink";
const statuses = {
  draft: "Rascunho",
  scheduled: "Agendado para publicação manual",
  exported: "Exportado",
  published: "Publicado manualmente",
};
export function PublicationPlanner({
  project,
  config,
  name,
  jobs,
  records,
  disabled,
  run,
  onSaved,
  onDirtyChange,
}: {
  project: AdProject;
  config: AdProjectConfig;
  name: string;
  jobs: AdRenderJob[];
  records: StudioRecord<Publication>[];
  disabled: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onSaved: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [title, setTitle] = useState(name);
  const [status, setStatus] = useState<Publication["status"]>("draft");
  const [timeZone, setTimeZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [scheduled, setScheduled] = useState("");
  const [published, setPublished] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [caption, setCaption] = useState(config.carousel?.caption ?? "");
  const [jobId, setJobId] = useState<number | null>(
    jobs.find((j) => j.status === "completed")?.id ?? null,
  );
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [removing, setRemoving] = useState<StudioRecord<Publication> | null>(
    null,
  );
  const snapshot = JSON.stringify({ title, status, timeZone, scheduled, published, postUrl, caption, jobId });
  const { dirty, markClean } = useDraftBaseline(snapshot, onDirtyChange);
  const [pendingChange, setPendingChange] = useState<StudioRecord<Publication> | "new" | null>(null);
  const existing = records.find((r) => r.id === editing);
  const linkedProjectId = existing?.payload.projectId ?? project.id;
  const linkedJobs = useQuery({
    queryKey: ["ad-project-jobs", linkedProjectId],
    queryFn: () => adProjectApi.listJobs(linkedProjectId),
    enabled: linkedProjectId !== project.id,
  });
  const availableJobs =
    linkedProjectId === project.id ? jobs : (linkedJobs.data ?? []);
  function loadRecord(r: StudioRecord<Publication>) {
    const p = r.payload;
    markClean(JSON.stringify({
      title: p.name, status: p.status, timeZone: p.timeZone,
      scheduled: p.scheduledAt ? wallTime(p.scheduledAt, p.timeZone) : "",
      published: p.publishedAt ? wallTime(p.publishedAt, p.timeZone) : "",
      postUrl: p.postUrl ?? "", caption: p.caption, jobId: p.jobId,
    }));
    setEditing(r.id);
    setTitle(p.name);
    setStatus(p.status);
    setTimeZone(p.timeZone);
    setScheduled(p.scheduledAt ? wallTime(p.scheduledAt, p.timeZone) : "");
    setPublished(p.publishedAt ? wallTime(p.publishedAt, p.timeZone) : "");
    setPostUrl(p.postUrl ?? "");
    setCaption(p.caption);
    setJobId(p.jobId);
  }
  function select(r: StudioRecord<Publication>) {
    if (dirty) setPendingChange(r);
    else loadRecord(r);
  }
  function newRecord() {
    markClean(JSON.stringify({ title: name, status: "draft", timeZone, scheduled: "", published: "", postUrl: "", caption: config.carousel?.caption ?? "", jobId: jobs.find((job) => job.status === "completed")?.id ?? null }));
    setEditing(null);
    setTitle(name);
    setStatus("draft");
    setScheduled("");
    setPublished("");
    setPostUrl("");
    setCaption(config.carousel?.caption ?? "");
    setJobId(jobs.find((job) => job.status === "completed")?.id ?? null);
  }
  const first = new Date(`${month}-01T12:00:00Z`);
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  let zoneValid = true;
  try {
    wallTime(new Date().toISOString(), timeZone);
  } catch {
    zoneValid = false;
  }
  return (
    <div className="mt-4 space-y-4">
      <p className="max-w-prose text-sm text-muted">
        Planeje datas, vincule arquivos exportados e registre o link depois de
        publicar no Instagram. As datas planejadas aparecem no calendário para
        publicação manual.
      </p>
      <p className="rounded-lg bg-info-soft p-3 text-sm text-info">
        Este calendário não publica no Instagram. Exporte os arquivos, publique
        manualmente e atualize o registro aqui.
      </p>
      {editing ? (
        <p className="text-sm font-medium">
          Editando: {existing?.payload.name}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm font-medium">
          Nome
          <input
            className={field}
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          Estado
          <select
            className={field}
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            {Object.entries(statuses).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Renderização
          <select
            className={field}
            value={jobId ?? ""}
            onChange={(e) => setJobId(Number(e.target.value) || null)}
          >
            <option value="">Sem exportação</option>
            {availableJobs
              .filter((j) => j.status === "completed")
              .map((j) => (
                <option key={j.id} value={j.id}>
                  #{j.id} · {j.outputs.length} arquivo(s)
                </option>
              ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Fuso horário
          <input
            className={field}
            value={timeZone}
            aria-invalid={!zoneValid}
            aria-describedby={
              !zoneValid ? "publication-timezone-error" : undefined
            }
            onChange={(e) => setTimeZone(e.target.value)}
            placeholder="America/Sao_Paulo"
          />
        </label>
        <label className="block text-sm font-medium">
          Data planejada no fuso escolhido
          <input
            className={field}
            type="datetime-local"
            value={scheduled}
            onChange={(e) => setScheduled(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          Publicado em (no fuso escolhido)
          <input
            className={field}
            type="datetime-local"
            value={published}
            onChange={(e) => setPublished(e.target.value)}
          />
        </label>
      </div>
      {!zoneValid ? (
        <p
          id="publication-timezone-error"
          role="alert"
          className="text-sm text-danger"
        >
          Informe um fuso válido, como America/Sao_Paulo, para salvar e ver as
          datas.
        </p>
      ) : null}
      {linkedProjectId !== project.id && linkedJobs.isPending ? (
        <p role="status" className="text-sm text-muted">
          Carregando exportações do projeto vinculado…
        </p>
      ) : null}
      {linkedJobs.isError ? (
        <div
          role="alert"
          className="rounded-lg bg-danger-soft p-3 text-sm text-danger"
        >
          <p>
            Não foi possível carregar as exportações.{" "}
            {apiErrorMessage(linkedJobs.error)}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              void linkedJobs.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </div>
      ) : null}
      <label className="block text-sm font-medium">
        Link da publicação no Instagram
        <input
          className={field}
          aria-label="Link da publicação"
          placeholder="Link da publicação no Instagram"
          type="url"
          value={postUrl}
          onChange={(e) => setPostUrl(e.target.value)}
        />
      </label>
      <label className="block text-sm font-medium">
        Legenda planejada
        <textarea
          rows={3}
          className={field}
          maxLength={2200}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={
            disabled ||
            !zoneValid ||
            !title.trim() ||
            (linkedProjectId !== project.id &&
              (linkedJobs.isPending || linkedJobs.isError))
          }
          onClick={() =>
            void run(async () => {
              await studioApi.save(
                "publication",
                {
                  name: title,
                  projectId: existing?.payload.projectId ?? project.id,
                  jobId,
                  status,
                  scheduledAt: scheduled
                    ? wallTimeToUtc(scheduled, timeZone)
                    : null,
                  timeZone,
                  caption,
                  productIds:
                    existing?.payload.productIds ?? config.productIds ?? [],
                  postUrl: postUrl || null,
                  publishedAt: published
                    ? wallTimeToUtc(published, timeZone)
                    : null,
                  metrics: existing?.payload.metrics ?? null,
                },
                existing,
              );
              newRecord();
              await onSaved();
            })
          }
        >
          {editing ? "Atualizar registro" : "Adicionar ao calendário"}
        </Button>
        {editing ? (
          <Button variant="secondary" disabled={disabled} onClick={() => { if (dirty) setPendingChange("new"); else newRecord(); }}>
            Novo registro
          </Button>
        ) : null}
      </div>
      <label className="block text-sm font-medium">
        Mês do calendário
        <input
          type="month"
          className={`${field} max-w-52`}
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </label>
      <div
        className="max-w-full overflow-x-auto"
        role="region"
        aria-label="Calendário de publicações; role horizontalmente para ver todos os dias"
        tabIndex={0}
      >
        <div className="grid min-w-[560px] grid-cols-7 gap-1">
          {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day) => (
            <div key={day} className="p-2 text-xs font-semibold">
              {day}
            </div>
          ))}
          {cells.map((day) => (
            <div
              key={day}
              className={`min-h-20 rounded-lg border border-line p-2 ${day.startsWith(month) ? "" : "bg-surface-muted text-subtle"}`}
            >
              <span className="block text-sm font-medium">
                {Number(day.slice(-2))}
              </span>
              {zoneValid
                ? records
                    .filter(
                      (r) =>
                        (r.payload.scheduledAt || r.payload.publishedAt) &&
                        wallTime(
                          r.payload.scheduledAt ?? r.payload.publishedAt!,
                          timeZone,
                        ).startsWith(day),
                    )
                    .map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => select(r)}
                        title={`${r.payload.name}: ${statuses[r.payload.status]}`}
                        className="mt-1 block min-h-9 w-full truncate rounded bg-accent-soft p-1 text-left text-xs text-accent"
                      >
                        {r.payload.name}
                      </button>
                    ))
                : null}
            </div>
          ))}
        </div>
      </div>
      {!records.length ? (
        <p className="rounded-lg bg-surface-muted p-4 text-sm text-muted">
          Nenhuma publicação planejada. Preencha o formulário para criar o
          primeiro registro.
        </p>
      ) : null}
      <ul className="max-h-64 space-y-2 overflow-auto">
        {records.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-muted p-3 text-xs"
          >
            <button
              type="button"
              className="min-h-11 min-w-0 flex-1 text-left text-sm"
              onClick={() => select(r)}
            >
              <span className="font-semibold">{r.payload.name}</span> ·{" "}
              {statuses[r.payload.status]}
              <br />
              {r.payload.scheduledAt
                ? new Date(r.payload.scheduledAt).toLocaleString("pt-BR", {
                    timeZone: r.payload.timeZone,
                  }) +
                  " · " +
                  r.payload.timeZone
                : "Sem data planejada"}
              {r.payload.metrics ? " · Medição registrada" : ""}
            </button>
            {r.payload.postUrl ? (
              <a
                href={r.payload.postUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent"
              >
                Ver post
              </a>
            ) : null}
            <Button
              disabled={disabled}
              variant="secondary"
              onClick={() => setRemoving(r)}
            >
              Excluir
            </Button>
          </li>
        ))}
      </ul>
      {pendingChange ? <StudioConfirmDialog
        title="Sair deste registro sem salvar?"
        description="As alterações do planejamento atual ainda não foram salvas."
        confirmLabel="Descartar e abrir"
        onCancel={() => setPendingChange(null)}
        onConfirm={() => {
          if (pendingChange === "new") newRecord();
          else loadRecord(pendingChange);
          setPendingChange(null);
        }}
      /> : null}
      {removing ? (
        <StudioConfirmDialog
          title="Excluir registro do calendário?"
          description={`O planejamento e as medições de “${removing.payload.name}” serão excluídos. A publicação no Instagram e os arquivos exportados permanecem disponíveis.`}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const record = removing;
            setRemoving(null);
            void run(async () => {
              await studioApi.remove(record.id);
              if (editing === record.id) newRecord();
              await onSaved();
            });
          }}
        />
      ) : null}
    </div>
  );
}

export function StudioConfirmDialog({
  title,
  description,
  onCancel,
  onConfirm,
  confirmLabel = "Excluir",
  cancelLabel = "Voltar",
}: {
  title: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            onCancel();
        }
      }}
      className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-xl border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-black/55"
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {title}
      </h2>
      <p id={`${id}-description`} className="mt-3 text-sm text-muted">
        {description}
      </p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button autoFocus variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant="danger" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
