import { notFound } from "next/navigation";
import LongListFixture from "@/components/qa/LongListFixture";

export const dynamic = "force-dynamic";

// Phase 19a U0 — QA-only long-list fixture (10k-row MEMORY/ACTIVITY analytics
// timeline with variable-height rows). Reachable only when
// AGENTIC_OS_ALLOW_TEST_FIXTURE=1 (set by qa/playwright.config.ts); otherwise
// 404. Never part of canonical product navigation and never a memory/runtime
// authority — pure presentation fixture.
export default async function QaActivityListPage() {
  if (process.env.AGENTIC_OS_ALLOW_TEST_FIXTURE !== "1") notFound();
  return <LongListFixture kind="activity" />;
}