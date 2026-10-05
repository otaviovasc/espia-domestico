import { useQuery } from "@tanstack/react-query";
import { adProjectApi } from "@/lib/api";
import { useState } from "react";
import { studioApi } from "@/lib/adStudioApi";
import type { Publication, StudioRecord } from "@/lib/adStudioApi";
import type { AdProject, AdProjectConfig, AdRenderJob } from "@/lib/api";
import { wallTime, wallTimeToUtc } from "@/lib/adCalendar";
import { Button } from "@/components/ui";
const field = "w-full rounded-lg border border-zinc-300 p-2 text-sm";
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
}: {
  project: AdProject;
  config: AdProjectConfig;
  name: string;
  jobs: AdRenderJob[];
  records: StudioRecord<Publication>[];
  disabled: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  onSaved: () => Promise<void>;
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
  const existing = records.find((r) => r.id === editing);
  const linkedProjectId = existing?.payload.projectId ?? project.id;
  const linkedJobs = useQuery({
    queryKey: ["ad-project-jobs", linkedProjectId],
    queryFn: () => adProjectApi.listJobs(linkedProjectId),
    enabled: linkedProjectId !== project.id,
  });
  const availableJobs =
    linkedProjectId === project.id ? jobs : (linkedJobs.data ?? []);
  function select(r: StudioRecord<Publication>) {
    const p = r.payload;
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
      <p className="text-xs text-zinc-500">
        Planeje datas, vincule arquivos exportados e registre o link depois de
        publicar no Instagram. As datas planejadas aparecem no calendário para
        publicação manual.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs">
          Nome
          <input
            className={field}
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="text-xs">
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
        <label className="text-xs">
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
        <label className="text-xs">
          Fuso horário
          <input
            className={field}
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            placeholder="America/Sao_Paulo"
          />
        </label>
        <label className="text-xs">
          Data planejada no fuso escolhido
          <input
            className={field}
            type="datetime-local"
            value={scheduled}
            onChange={(e) => setScheduled(e.target.value)}
          />
        </label>
        <label className="text-xs">
          Publicado em (no fuso escolhido)
          <input
            className={field}
            type="datetime-local"
            value={published}
            onChange={(e) => setPublished(e.target.value)}
          />
        </label>
      </div>
      <input
        className={field}
        aria-label="Link da publicação"
        placeholder="Link da publicação no Instagram"
        type="url"
        value={postUrl}
        onChange={(e) => setPostUrl(e.target.value)}
      />
      <label className="block text-xs">
        Legenda planejada
        <textarea
          rows={3}
          className={field}
          maxLength={2200}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <Button
          disabled={
            disabled ||
            !zoneValid ||
            !title.trim() ||
            (linkedProjectId !== project.id && linkedJobs.isPending)
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
              await onSaved();
              setEditing(null);
            })
          }
        >
          {editing ? "Atualizar registro" : "Adicionar ao calendário"}
        </Button>
        {editing ? (
          <Button variant="secondary" onClick={() => setEditing(null)}>
            Novo registro
          </Button>
        ) : null}
      </div>
      <label className="block text-xs">
        Mês do calendário
        <input
          type="month"
          className={`${field} max-w-52`}
          value={month}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
        />
      </label>
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] grid-cols-7 gap-1">
          {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day) => (
            <div key={day} className="p-2 text-xs font-semibold">
              {day}
            </div>
          ))}
          {cells.map((day) => (
            <div
              key={day}
              className={`min-h-20 rounded-lg border border-zinc-100 p-2 ${day.startsWith(month) ? "" : "bg-zinc-50 text-zinc-400"}`}
            >
              <span className="text-xs">{Number(day.slice(-2))}</span>
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
                        className="mt-1 block w-full truncate rounded bg-violet-50 p-1 text-left text-[10px] text-violet-800"
                      >
                        {r.payload.name}
                      </button>
                    ))
                : null}
            </div>
          ))}
        </div>
      </div>
      <ul className="max-h-64 space-y-2 overflow-auto">
        {records.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 p-3 text-xs"
          >
            <button
              type="button"
              className="flex-1 text-left"
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
                className="text-violet-700"
              >
                Ver post
              </a>
            ) : null}
            <Button
              disabled={disabled}
              variant="secondary"
              onClick={() =>
                void run(async () => {
                  await studioApi.remove(r.id);
                  if (editing === r.id) setEditing(null);
                  await onSaved();
                })
              }
            >
              Excluir
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
