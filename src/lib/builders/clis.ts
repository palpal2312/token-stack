// The CLI catalog: what Agent OS knows about each coding CLI a Builder can wrap.
//
// The catalog now lives in `clis/` — one module per CLI (base.ts holds the
// CliSpec shape, index.ts the registry) so adding a CLI is adding one file.
// This file is only a facade: it re-exports the registry's public API so the
// many existing `import ... from "./clis"` / "@/lib/builders/clis" call sites
// keep working byte-for-byte. Import from here, not from `clis/` directly,
// unless you are the registry itself.

export type { Protocol, AuthKind, CliSpec, ExecOpts } from "./clis/base";
export { allClis, cliSpec, registerCliSpec, unregisterCliSpec, defaultBinFor } from "./clis/index";
