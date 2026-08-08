"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type SenPanelMode =
  | "closed"
  | "kanban"
  | "mission-control"
  | "memory"
  | "dify"
  | "cli-config"
  | "code-space";

interface SenPanelState {
  isOpen: boolean;
  mode: SenPanelMode;
  data: any;
  setPanel: (mode: SenPanelMode, data?: any) => void;
  closePanel: () => void;
  togglePanel: (mode?: SenPanelMode) => void;
}

const SenPanelContext = createContext<SenPanelState | undefined>(undefined);

export function SenPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<SenPanelMode>("closed");
  const [data, setData] = useState<any>(null);

  const setPanel = useCallback((newMode: SenPanelMode, newData?: any) => {
    setMode(newMode);
    if (newMode === "closed") {
      setIsOpen(false);
      setData(null);
    } else {
      setIsOpen(true);
      if (newData !== undefined) setData(newData);
    }
  }, []);

  const closePanel = useCallback(() => {
    setIsOpen(false);
    setMode("closed");
    setData(null);
  }, []);

  const togglePanel = useCallback((toggleMode?: SenPanelMode) => {
    setIsOpen((prev) => {
      if (prev && (!toggleMode || toggleMode === mode)) {
        setMode("closed");
        setData(null);
        return false;
      }
      if (toggleMode) setMode(toggleMode);
      return true;
    });
  }, [mode]);

  return (
    <SenPanelContext.Provider value={{ isOpen, mode, data, setPanel, closePanel, togglePanel }}>
      {children}
    </SenPanelContext.Provider>
  );
}

export function useAukerPanel() {
  const context = useContext(SenPanelContext);
  if (context === undefined) {
    throw new Error("useAukerPanel must be used within an SenPanelProvider");
  }
  return context;
}
