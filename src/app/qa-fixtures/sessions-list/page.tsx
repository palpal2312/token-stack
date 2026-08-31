import { notFound } from "next/navigation";
import LongListFixture from "@/components/qa/LongListFixture";

// Phase 19a U4 #2 — QA-only sessions-list fixture (10k-row session-history sidebar).
// Reachable only when AGENTIC_OS_ALLOW_TEST_FIXTURE=1 (set by qa/playwright.config.ts);
// otherwise 404 so it never appears in canonical navigation.
export default function SessionsListPage() {
  if (process.env.AGENTIC_OS_ALLOW_TEST_FIXTURE !== "1") notFound();
  return <LongListFixture kind="sessions" />;
}