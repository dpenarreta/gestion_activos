import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";

import { UnsavedChangesProvider } from "../../../context/UnsavedChangesContext";
import { useBreakpoint } from "../../../hooks/useBreakpoint";
import { AdminSidebar } from "../AdminSidebar/AdminSidebar";
import "./AdminLayout.css";

const COLLAPSE_STORAGE_KEY = "admin.sidebar.collapsed";

function hasStoredPreference() {
  return localStorage.getItem(COLLAPSE_STORAGE_KEY) !== null;
}

function getInitialCollapsed(breakpoint) {
  const stored = localStorage.getItem(COLLAPSE_STORAGE_KEY);
  if (stored !== null) {
    return stored === "true";
  }
  return breakpoint === "md" || breakpoint === "lg";
}

/**
 * Shell de dos columnas para todo `/admin/*`: sidebar izquierdo +
 * `<Outlet/>`. Provee `UnsavedChangesContext` una única vez para todo el
 * árbol admin.
 */
export function AdminLayout() {
  const breakpoint = useBreakpoint();
  const [isCollapsed, setIsCollapsed] = useState(() => getInitialCollapsed(breakpoint));
  const hadStoredPreference = useRef(hasStoredPreference());

  useEffect(() => {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    if (!hadStoredPreference.current) {
      setIsCollapsed(breakpoint === "md" || breakpoint === "lg");
    }
  }, [breakpoint]);

  function handleToggleCollapse() {
    hadStoredPreference.current = true;
    setIsCollapsed((value) => !value);
  }

  return (
    <UnsavedChangesProvider>
      <div className={`admin-layout ${isCollapsed ? "admin-layout--collapsed" : ""}`}>
        <AdminSidebar isCollapsed={isCollapsed} onToggleCollapse={handleToggleCollapse} />
        <main className="admin-layout__content">
          <Outlet />
        </main>
      </div>
    </UnsavedChangesProvider>
  );
}
