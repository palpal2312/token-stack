"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

type NavPendingContextValue = {
  /** Settled Next.js pathname (normalized, no trailing slash). */
  pathname: string;
  /** Target href while a soft nav is in flight; null when settled. */
  pendingHref: string | null;
  /** pendingHref ?? pathname — use for chrome, titles, sidebar active. */
  displayPath: string;
  /** True while displayPath is ahead of the settled route. */
  isPending: boolean;
  /** Call on sidebar/link click before Next navigates. */
  beginNav: (href: string) => void;
};

const NavPendingContext = createContext<NavPendingContextValue | null>(null);

function normalizePath(raw: string | null | undefined): string {
  if (!raw) return "/";
  const trimmed = raw.replace(/\/$/, "");
  return trimmed || "/";
}

export function NavPendingProvider({ children }: { children: ReactNode }) {
  const rawPath = usePathname();
  const pathname = normalizePath(rawPath);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref((pending) => {
      if (!pending) return null;
      const target = normalizePath(pending);
      if (pathname === target) return null;
      if (target !== "/" && pathname.startsWith(`${target}/`)) return null;
      // Sen aliases
      if (target === "/sen" && (pathname.startsWith("/sen") || pathname.startsWith("/firstmate"))) {
        return null;
      }
      return pending;
    });
  }, [pathname]);

  const beginNav = useCallback((href: string) => {
    const target = normalizePath(href);
    if (
      target === pathname
      || (target === "/sen" && (pathname.startsWith("/sen") || pathname.startsWith("/firstmate")))
    ) {
      return;
    }
    setPendingHref(target);
  }, [pathname]);

  const value = useMemo<NavPendingContextValue>(() => ({
    pathname,
    pendingHref,
    displayPath: pendingHref ?? pathname,
    isPending: pendingHref !== null && normalizePath(pendingHref) !== pathname,
    beginNav,
  }), [pathname, pendingHref, beginNav]);

  return (
    <NavPendingContext.Provider value={value}>
      {children}
    </NavPendingContext.Provider>
  );
}

export function useNavPending(): NavPendingContextValue {
  const ctx = useContext(NavPendingContext);
  if (!ctx) {
    throw new Error("useNavPending must be used within NavPendingProvider");
  }
  return ctx;
}

/** Safe for components that may render outside the provider (tests). */
export function useNavPendingOptional(): NavPendingContextValue | null {
  return useContext(NavPendingContext);
}
