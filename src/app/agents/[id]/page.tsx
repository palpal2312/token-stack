import AgentInstanceView from "@/components/AgentInstanceView";

export default async function AgentRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentInstanceView agentId={id} />;
}
