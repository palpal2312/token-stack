#!/usr/bin/env node
import { fireAutomation } from "./src/lib/automations.ts";

const automationId = process.argv[2] || "phase-1-firstmate-live-test";
console.log(`Firing automation: ${automationId}`);

try {
  const run = await fireAutomation(automationId, "manual");
  console.log("Run completed:");
  console.log(JSON.stringify(run, null, 2));
} catch (err) {
  console.error("Run failed:", err.message);
  process.exit(1);
}
