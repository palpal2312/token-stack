import SenView from "@/components/SenView";

// Legacy compatibility route: /firstmate renders the same Sen homepage as
// /sen. Kept so existing bookmarks and QA history keep working.
export default function FirstmateRoute() {
  return <SenView />;
}
