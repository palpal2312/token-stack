import { NextResponse } from "next/server";
import { readRuntimeSlots } from "@/lib/agentRuntime/go-builder-exec-client";
import { ORCA_SLOT_DTO_VERSION, type OrcaRuntimeSlotsDTO } from "@/lib/agentRuntime/orca-slot-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISABLED_SLOTS: OrcaRuntimeSlotsDTO = {
  dto_version: ORCA_SLOT_DTO_VERSION,
  lab_enabled: false,
  slots: [],
};

function slotsResponse(dto: OrcaRuntimeSlotsDTO) {
  return NextResponse.json(dto, { headers: { "cache-control": "no-store" } });
}

export async function GET() {
  try {
    return slotsResponse(await readRuntimeSlots());
  } catch {
    return slotsResponse(DISABLED_SLOTS);
  }
}
