"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen, FileText, FileSpreadsheet, File, Trash2, Upload, RefreshCw, TriangleAlert, FolderOpen,
} from "lucide-react";

type KnowledgeKind = "config" | "data";

interface Row {
  id: string;
  name: string;
  kind: KnowledgeKind;
  bytes: number;
  mtime: number;
  relPath: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function readJson(r: Response): Promise<Record<string, unknown>> {
  try { return await r.json(); }
  catch { return { error: `HTTP ${r.status}` }; }
}

function iconFor(row: Row) {
  const ext = row.name.split(".").pop()?.toLowerCase();
  if (ext === "md" || ext === "txt" || ext === "json" || ext === "yaml" || ext === "yml") {
    return <FileText size={14} style={{ color: "#7dd3fc" }} />;
  }
  if (ext === "xlsx" || ext === "xls" || ext === "csv" || ext === "tsv") {
    return <FileSpreadsheet size={14} style={{ color: "#86efac" }} />;
  }
  if (ext === "pdf") return <File size={14} style={{ color: "#fb7185" }} />;
  return <File size={14} style={{ color: "var(--cream-mute)" }} />;
}

export default function SenKnowledgeBase() {
  const [files, setFiles] = useState<Row[]>([]);
  const [root, setRoot] = useState("");
  const [home, setHome] = useState("");
  const [homeFound, setHomeFound] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<KnowledgeKind | undefined>(undefined);

  const load = useCallback(async () => {
    const j = await readJson(await fetch("/api/sen/knowledge-files", { cache: "no-store" }));
    if (j.error) { setErr(String(j.error)); return; }
    setErr(null);
    setFiles((j.files as Row[]) ?? []);
    setRoot(String(j.root ?? ""));
    setHome(String(j.home ?? ""));
    setHomeFound(Boolean(j.homeFound));
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function uploadList(list: FileList | File[], kind?: KnowledgeKind) {
    const arr = Array.from(list);
    if (!arr.length) return;
    setBusy(true);
    setErr(null);
    try {
      for (const file of arr) {
        const form = new FormData();
        form.append("file", file);
        if (kind) form.append("kind", kind);
        const r = await fetch("/api/sen/knowledge-files", { method: "POST", body: form });
        const j = await readJson(r);
        if (!r.ok || j.error) throw new Error(String(j.error ?? `Upload failed (${r.status})`));
      }
      await load();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
      kindRef.current = undefined;
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this file from the Knowledge Base?")) return;
    const r = await fetch(`/api/sen/knowledge-files?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const j = await readJson(r);
    if (j.error) { setErr(String(j.error)); return; }
    await load();
  }

  const configs = files.filter((f) => f.kind === "config");
  const dataFiles = files.filter((f) => f.kind === "data");

  return (
    <div className="space-y-4">
      <section className="aura-border aura-border--soft rounded-xl border p-4" style={{ borderColor: "var(--panel-border)", background: "var(--panel, rgba(255,255,255,0.02))" }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="flex items-center gap-2 text-[13px] font-medium tracking-wide uppercase" style={{ color: "var(--fg-dim)" }}>
              <BookOpen size={14} /> Knowledge Base
            </h2>
            <p className="mt-1 text-[12px]" style={{ color: "var(--cream-mute)" }}>
              Upload Sen config markdown and reference data (PDF, Excel, CSV) for the crew.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="grid place-items-center w-8 h-8 rounded-lg border shrink-0"
            style={{ borderColor: "var(--panel-border)", color: "var(--fg-dim)" }}
            title="Refresh"
          >
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="text-[11px] space-y-0.5 mb-3" style={{ color: "var(--fg-dim)" }}>
          <div className="flex items-center gap-1.5 min-w-0">
            <FolderOpen size={12} className="shrink-0" />
            <code className="truncate">{root || "…"}</code>
          </div>
          <div>
            Sen home: <code>{home || "—"}</code>
            {!homeFound && <span className="ml-1">(fallback store — clone firstmate for FM_HOME)</span>}
          </div>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) void uploadList(e.dataTransfer.files);
          }}
          className="rounded-xl border border-dashed px-4 py-6 text-center transition"
          style={{
            borderColor: dragOver ? "#7dd3fc" : "var(--panel-border)",
            background: dragOver ? "rgba(125,211,252,0.08)" : "rgba(0,0,0,0.15)",
          }}
        >
          <Upload size={22} className="mx-auto mb-2" style={{ color: "#7dd3fc" }} />
          <p className="text-[13px]" style={{ color: "var(--cream)" }}>
            Drop files here, or choose below
          </p>
          <p className="mt-1 text-[11px]" style={{ color: "var(--cream-mute)" }}>
            Config: .md .txt .json .yaml · Data: .pdf .xlsx .xls .csv .docx · max 25 MB
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => { kindRef.current = "config"; inputRef.current?.click(); }}
              className="px-3 py-1.5 rounded-lg border text-[12px] disabled:opacity-50"
              style={{ borderColor: "rgba(125,211,252,0.45)", color: "#7dd3fc" }}
            >
              Upload config (.md)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { kindRef.current = "data"; inputRef.current?.click(); }}
              className="px-3 py-1.5 rounded-lg border text-[12px] disabled:opacity-50"
              style={{ borderColor: "rgba(134,239,172,0.45)", color: "#86efac" }}
            >
              Upload data (PDF / Excel)
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".md,.txt,.json,.yaml,.yml,.toml,.pdf,.xlsx,.xls,.csv,.tsv,.docx"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void uploadList(e.target.files, kindRef.current);
            }}
          />
        </div>

        {err && (
          <div className="mt-3 flex items-start gap-2 text-[12px]" style={{ color: "#fca5a5" }}>
            <TriangleAlert size={14} className="shrink-0 mt-0.5" />
            <span>{err}</span>
          </div>
        )}
      </section>

      <FileGroup title="Config & guidelines" rows={configs} empty="No config markdown yet — upload AGENTS-style rules, captain notes, or SOPs." onRemove={remove} />
      <FileGroup title="Reference data" rows={dataFiles} empty="No PDF / Excel / CSV data yet." onRemove={remove} />
    </div>
  );
}

function FileGroup({
  title, rows, empty, onRemove,
}: {
  title: string;
  rows: Row[];
  empty: string;
  onRemove: (id: string) => void;
}) {
  return (
    <section className="aura-border aura-border--soft rounded-xl border p-4" style={{ borderColor: "var(--panel-border)", background: "var(--panel, rgba(255,255,255,0.02))" }}>
      <h2 className="text-[13px] font-medium tracking-wide uppercase mb-3" style={{ color: "var(--fg-dim)" }}>
        {title}{rows.length ? ` (${rows.length})` : ""}
      </h2>
      {rows.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--fg-dim)" }}>{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[12.5px]"
              style={{ borderColor: "var(--line-soft)" }}
            >
              {iconFor(row)}
              <span className="min-w-0 flex-1 truncate" style={{ color: "var(--cream)" }} title={row.name}>
                {row.name}
              </span>
              <span className="shrink-0 text-[10px]" style={{ color: "var(--cream-mute)" }}>
                {formatBytes(row.bytes)}
              </span>
              <span className="shrink-0 text-[10px]" style={{ color: "var(--cream-mute)" }}>
                {new Date(row.mtime).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
              <button
                type="button"
                onClick={() => onRemove(row.id)}
                className="shrink-0 p-1 rounded hover:text-rose-300 transition"
                style={{ color: "var(--cream-mute)" }}
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
