import { NextResponse } from "next/server";
import { herdrStatus, herdrSnapshotRead } from "@/lib/herdr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // SEN_GO_HERDR_SNAPSHOT_CACHE=1: the daemon cache already carries all five
  // status fields, so this read is spawn-free. Flag off — or a daemon
  // failure, where read.status is null — keeps the legacy
  // `herdr --version` + `herdr api snapshot` double spawn.
  if (process.env.SEN_GO_HERDR_SNAPSHOT_CACHE === "1") {
    const status = (await herdrSnapshotRead()).status;
    if (status) return NextResponse.json(status);
  }
  return NextResponse.json(await herdrStatus());
}
