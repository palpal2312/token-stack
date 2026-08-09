"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import Sidebar, { MobileNav } from "./Sidebar";
import InstantPageFrame from "./InstantPageFrame";
import { SenPanelProvider } from "../context/sen-panel-context";
import { NavPendingProvider, useNavPending } from "../context/nav-pending-context";
import CommandPalette from "./CommandPalette";
import OwnerBanner from "./OwnerBanner";

const FULL_WIDTH = new Set([
  "/sen",
  "/firstmate",
  "/code-space",
  "/agent-kanban",
  "/memory",
  "/builders",
  "/routers",
  "/integrations",
  "/goals",
  "/automations",
  "/loop",
]);

function ShellBody({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const path = (pathname ?? "/").replace(/\/$/, "") || "/";
  const { isPending, displayPath } = useNavPending();
  const framePath = isPending ? displayPath : path;
  const isFullWidth = FULL_WIDTH.has(framePath) || FULL_WIDTH.has(path);

  return (
    <div className="h-screen flex overflow-hidden">
      <Sidebar />
      <main className={`flex-1 min-w-0 ${isFullWidth ? "overflow-hidden" : "overflow-y-auto"}`}>
        <div className={isFullWidth ? "h-full min-h-0" : "max-w-[1500px] mx-auto px-6 md:px-10 py-8"}>
          {!isFullWidth && <OwnerBanner />}
          <CommandPalette showTrigger={false} />
          {isPending ? <InstantPageFrame path={displayPath} /> : children}
        </div>
      </main>
      <MobileNav />
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  return (
    <SenPanelProvider>
      <NavPendingProvider>
        <ShellBody>{children}</ShellBody>
      </NavPendingProvider>
    </SenPanelProvider>
  );
}
