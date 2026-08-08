import { redirect } from "next/navigation";

// Legacy compatibility: FirstMate Agent tab merged into main Sen chat.
export default function FirstMateAgentRoute() {
  redirect("/sen");
}
