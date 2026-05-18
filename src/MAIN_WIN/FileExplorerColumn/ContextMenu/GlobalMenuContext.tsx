// context/GlobalMenuContext.tsx
import React, { createContext, useContext, useState, useCallback } from "react";

interface MenuContextType {
  activeMenuId: string | null;
  openMenu: (menuId: string) => void;
  closeMenu: () => void;
}

const GlobalMenuContext = createContext<MenuContextType | undefined>(undefined);

export const GlobalMenuProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const openMenu = useCallback((menuId: string) => {
    setActiveMenuId(menuId);
  }, []);

  const closeMenu = useCallback(() => {
    setActiveMenuId(null);
  }, []);

  return (
    <GlobalMenuContext.Provider value={{ activeMenuId, openMenu, closeMenu }}>
      {children}
    </GlobalMenuContext.Provider>
  );
};

export const useGlobalMenu = () => {
  const context = useContext(GlobalMenuContext);
  if (!context) {
    throw new Error("useGlobalMenu must be used within a GlobalMenuProvider");
  }
  return context;
};
