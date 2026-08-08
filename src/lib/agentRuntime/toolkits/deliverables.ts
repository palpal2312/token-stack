// The deliverables toolkit: "finished work, not chat".
//
// Three makers, each writing real files into the run's own artifacts/ folder
// and nothing else. The jail is the same jailPath the files/git/shell
// toolkits use, rooted at the run directory — a title like "../../evil"
// becomes a slug, and the slug is all the model controls, so there is no
// path to escape through.
//
// Deliberately no document libraries. A real .docx or .xlsx is a zip of XML
// parts; writing one honestly without a dependency is not a small toolkit
// anymore, and v1 takes no new dependencies. Instead:
//   - documents are markdown + a print-ready HTML rendering (File → Print
//     is the "export to PDF/Word" path);
//   - spreadsheets are CSV (the data, opened by everything) + an HTML table
//     (the instant preview). If a real XLSX writer is ever worth its
//     dependency cost, that is a separate decision — see the phase file's
//     risk note.
//
// The markdown→HTML renderer below covers headings, bold, italic, inline
// and fenced code, lists, links, and hr — the shapes an agent actually
// writes. Everything the model supplies is HTML-escaped first; the markup
// in the output is the renderer's own.

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { RuntimeTool, ToolContext } from "../agent";
import { jailPath } from "./files";

// ---------------------------------------------------------------- escaping

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline markdown on already-escaped text: code, bold, italic, links. */
function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/** Basic markdown → HTML. Input is untrusted; every line is escaped first. */
function markdownToHtml(md: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let inCode = false;
  let codeBuf: string[] = [];
  const closeList = () => {
    if (list) { out.push(`</${list}>`); list = null; }
  };

  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    if (raw.trim().startsWith("```")) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }

    const line = raw.trim();
    if (!line) { closeList(); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) { closeList(); out.push("<hr>"); continue; }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${inline(escapeHtml(bullet[1]))}</li>`);
      continue;
    }
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${inline(escapeHtml(numbered[1]))}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(escapeHtml(line))}</p>`);
  }

  if (inCode) out.push(`<pre><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  closeList();
  return out.join("\n");
}

/** RFC 4180: quote a cell when it holds a comma, quote, or line break; double the quotes inside. */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function tableToHtml(rows: unknown[][]): string {
  const [head, ...body] = rows;
  const cell = (v: unknown) => escapeHtml(v === null || v === undefined ? "" : String(v));
  const parts: string[] = ["<table>"];
  if (head) {
    parts.push(`<thead><tr>${head.map((v) => `<th>${cell(v)}</th>`).join("")}</tr></thead>`);
  }
  parts.push(`<tbody>${body.map((r) => `<tr>${r.map((v) => `<td>${cell(v)}</td>`).join("")}</tr>`).join("")}</tbody>`);
  parts.push("</table>");
  return parts.join("\n");
}

// ---------------------------------------------------------------- html shell

const PAGE_CSS = [
  "body{max-width:46rem;margin:2.5rem auto;padding:0 1.25rem;",
  "font-family:Georgia,'Times New Roman',serif;line-height:1.65;color:#1a1a1a}",
  "h1,h2,h3{line-height:1.25}",
  "code,pre{font-family:ui-monospace,Consolas,monospace;background:#f4f4f4;border-radius:4px}",
  "code{padding:.1em .3em} pre{padding:.75rem 1rem;overflow-x:auto}",
  "table{border-collapse:collapse;width:100%}",
  "th,td{border:1px solid #ccc;padding:.4rem .65rem;text-align:left}",
  "th{background:#f4f4f4}",
  "@media print{body{margin:0;max-width:none}}",
].join("\n");

function htmlShell(title: string, body: string): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${PAGE_CSS}</style>`,
    "</head>",
    "<body>",
    body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- helpers

function str(v: unknown, name: string): string {
  if (typeof v !== "string" || !v) throw new Error(`Give ${name} as a string.`);
  return v;
}

/** The model names the deliverable; the slug is the only filename it gets. */
function slugify(title: string): string {
  return (
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)
    || "artifact"
  );
}

/** Second deliverable with the same title gets a -2, never an overwrite. */
function uniqueSlug(artifactsDir: string, base: string): string {
  let slug = base;
  let n = 2;
  while (
    existsSync(path.join(artifactsDir, `${slug}.md`))
    || existsSync(path.join(artifactsDir, `${slug}.html`))
    || existsSync(path.join(artifactsDir, `${slug}.csv`))
  ) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

/** Resolve this run's artifacts/ inside the jail, creating what is missing. */
async function artifactsDir(ctx: ToolContext): Promise<string> {
  if (!ctx.runDir) {
    throw new Error(
      "Deliverables need a file-backed run directory and this run has none "
      + "(the state store is memory-only). Give the agent a FileStateStore to produce files.",
    );
  }
  // jailPath realpaths the root, so the run directory must exist before the jail opens.
  await mkdir(ctx.runDir, { recursive: true });
  const abs = await jailPath(ctx.runDir, "artifacts");
  await mkdir(abs, { recursive: true });
  return abs;
}

async function writeArtifact(
  ctx: ToolContext,
  filename: string,
  content: string,
): Promise<string> {
  const abs = await jailPath(ctx.runDir as string, path.join("artifacts", filename));
  await writeFile(abs, content, "utf8");
  return path.join("artifacts", filename);
}

// ---------------------------------------------------------------- the tools

export function deliverablesToolkit(): RuntimeTool[] {
  return [
    {
      name: "make_document",
      description:
        "Write a document deliverable: <title>.md with the markdown, plus a print-ready "
        + "<title>.html rendering (headings, bold/italic, code, lists, links) in the run's "
        + "artifacts folder. Returns { path, kind, files }.",
      schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Document title; becomes the filename slug." },
          markdown: { type: "string", description: "The document body in markdown." },
        },
        required: ["title", "markdown"],
      },
      metadata: { riskLevel: "write", producesArtifacts: true },
      async execute(args, ctx) {
        const a = args as Record<string, unknown>;
        const title = str(a?.title, "title");
        const markdown = str(a?.markdown, "markdown");
        const slug = uniqueSlug(await artifactsDir(ctx), slugify(title));

        const md = `# ${title}\n\n${markdown}\n`;
        const html = htmlShell(title, `<h1>${escapeHtml(title)}</h1>\n${markdownToHtml(markdown)}`);

        const mdPath = await writeArtifact(ctx, `${slug}.md`, md);
        const htmlPath = await writeArtifact(ctx, `${slug}.html`, html);
        return { path: htmlPath, kind: "document", files: [mdPath, htmlPath] };
      },
    },
    {
      name: "make_spreadsheet",
      description:
        "Write a spreadsheet deliverable: <name>.csv (RFC 4180, opens in Excel/Sheets) plus a "
        + "<name>.html table preview in the run's artifacts folder. First row is treated as the "
        + "header in the preview. No XLSX — CSV is the data. Returns { path, kind, files }.",
      schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Spreadsheet name; becomes the filename slug." },
          rows: {
            type: "array",
            items: { type: "array", items: {} },
            description: "Rows of cells; cells are stringified.",
          },
        },
        required: ["name", "rows"],
      },
      metadata: { riskLevel: "write", producesArtifacts: true },
      async execute(args, ctx) {
        const a = args as Record<string, unknown>;
        const name = str(a?.name, "name");
        if (!Array.isArray(a?.rows) || !a.rows.every(Array.isArray)) {
          throw new Error("Give rows as an array of arrays.");
        }
        const rows = a.rows as unknown[][];
        const slug = uniqueSlug(await artifactsDir(ctx), slugify(name));

        const csvPath = await writeArtifact(ctx, `${slug}.csv`, toCsv(rows));
        const htmlPath = await writeArtifact(ctx, `${slug}.html`, htmlShell(name, tableToHtml(rows)));
        return { path: csvPath, kind: "spreadsheet", files: [csvPath, htmlPath] };
      },
    },
    {
      name: "make_web_page",
      description:
        "Write a self-contained HTML page deliverable into the run's artifacts folder. The html "
        + "you give becomes the page body inside a minimal styled shell. "
        + "Returns { path, kind, files }.",
      schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Page title; becomes the filename slug." },
          html: { type: "string", description: "Body HTML for the page." },
        },
        required: ["title", "html"],
      },
      metadata: { riskLevel: "write", producesArtifacts: true },
      async execute(args, ctx) {
        const a = args as Record<string, unknown>;
        const title = str(a?.title, "title");
        const html = str(a?.html, "html");
        const slug = uniqueSlug(await artifactsDir(ctx), slugify(title));

        // The body is the model's own markup and stays as-is by design — this
        // is an agent-authored page, not user input. The one structural hole
        // is a literal "</title" breaking the head, so that goes.
        const body = html.replace(/<\/title[^>]*>/gi, "");

        const htmlPath = await writeArtifact(ctx, `${slug}.html`, htmlShell(title, body));
        return { path: htmlPath, kind: "webpage", files: [htmlPath] };
      },
    },
  ];
}
