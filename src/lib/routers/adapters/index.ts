// The adapter registry: id → adapter, written out by hand.
//
// aisuite discovers providers by naming convention — a file called
// <provider>_provider.py holding a class named <Provider>Provider — which makes
// "add a file" the whole registration, but also makes a rename a silent break
// of every stored config that names the old id. A string in this map shows up
// in a diff and fails loudly at lookup instead.
//
// registerAdapter exists for the two callers the shipped map cannot know
// about: QA, which must prove "a new provider is one file and one
// registration" without editing any shipped file, and future provider
// plugins. Registration is process-global, so tests that register are
// expected to unregister — and unregistering a built-in id restores the
// shipped adapter rather than deleting it, so a test cannot brick the
// registry for the tests that run after it.

import type { ChatAdapter } from "./base";
import { openaiCompatibleAdapter } from "./openaiCompatible";
import { anthropicAdapter } from "./anthropic";

const ADAPTERS: ChatAdapter[] = [openaiCompatibleAdapter, anthropicAdapter];
const BUILT_INS = new Map(ADAPTERS.map((a) => [a.id, a]));
const BY_ID = new Map(BUILT_INS);

/** Null rather than a throw, so the caller can word the failure for its user. */
export function getAdapter(id: string): ChatAdapter | null {
  return BY_ID.get(id) ?? null;
}

/** Registering over a live id replaces it until unregistered — that is how a
 *  fork would patch a shipped provider, and how a test shadows one. */
export function registerAdapter(adapter: ChatAdapter): void {
  BY_ID.set(adapter.id, adapter);
}

export function unregisterAdapter(id: string): void {
  const builtIn = BUILT_INS.get(id);
  if (builtIn) BY_ID.set(id, builtIn);
  else BY_ID.delete(id);
}
