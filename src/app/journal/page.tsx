import JournalView from "@/components/JournalView";

export const metadata = { title: "Journal" };

export default function JournalRoute() {
  return (
    <div className="h-full min-h-0">
      <JournalView />
    </div>
  );
}
