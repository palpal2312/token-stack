import { redirect } from "next/navigation";

export default function SenAgentRoute() {
  // Agent UI now lives on the main /sen surface (sessions / chat / MCP).
  redirect("/sen");
}
