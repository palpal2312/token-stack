"use client";

// Promo banner for the pack owner's OWN Agent OS only (their recordings / screenshots).
// Gated on NEXT_PUBLIC_AGENTIC_OS_OWNER, which lives in .env.local and is NOT shipped
// in the member zip exports — so members never see it.
export default function OwnerBanner() {
  if (process.env.NEXT_PUBLIC_AGENTIC_OS_OWNER !== "1") return null;
  return (
    <a
      href="https://www.skool.com/ai-profit-lab-7462/about"
      target="_blank"
      rel="noopener"
      className="owner-banner"
      style={{
        position: "sticky", top: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center", gap: "16px",
        padding: "16px 24px", marginBottom: "16px",
        background: "linear-gradient(90deg, #d9b36a, #e8c98a)",
        border: "1px solid rgba(0,0,0,.25)", borderRadius: "14px",
        boxShadow: "0 6px 22px rgba(0,0,0,.35)", textDecoration: "none",
        fontSize: "16.5px", fontWeight: 700, color: "#161018", textAlign: "center",
        flexWrap: "wrap", cursor: "pointer",
      }}
    >
      <span style={{ fontSize: "19px" }}>⭐</span>
      <span>Get the <strong style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}>Agent OS</strong> + join <strong>4,000+ founders</strong> inside the AI Profit Boardroom</span>
      <span style={{
        background: "#161018", color: "#e8c98a", fontWeight: 800,
        padding: "9px 24px", borderRadius: "999px", whiteSpace: "nowrap", fontSize: "15.5px",
      }}>Join AIPB →</span>
    </a>
  );
}
