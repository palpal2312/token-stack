import type { Metadata } from "next";
import DifyWorkflowView from "@/components/DifyWorkflowView";

export const metadata: Metadata = {
  title: "Dify Integrations - NEWS OS",
  description: "Manage and run Dify workflows",
};

export default function DifyPage() {
  return (
    <div className="h-full">
      <DifyWorkflowView />
    </div>
  );
}