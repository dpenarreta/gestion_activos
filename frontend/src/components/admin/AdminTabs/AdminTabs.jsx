import { useRef } from "react";
import { useLocation } from "react-router-dom";

import { useUnsavedChanges } from "../../../context/UnsavedChangesContext";
import "./AdminTabs.css";

/**
 * Pestañas horizontales genéricas, ligadas a rutas reales (cada pestaña
 * tiene su propia URL). Patrón ARIA Tabs con "roving tabindex".
 */
export function AdminTabs({ tabs }) {
  const location = useLocation();
  const { guardedNavigate } = useUnsavedChanges();
  const tabRefs = useRef([]);

  function activate(index) {
    const tab = tabs[index];
    if (!tab) {
      return;
    }
    guardedNavigate(tab.path);
    tabRefs.current[index]?.focus();
  }

  function handleKeyDown(event, index) {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        activate((index + 1) % tabs.length);
        break;
      case "ArrowLeft":
        event.preventDefault();
        activate((index - 1 + tabs.length) % tabs.length);
        break;
      case "Home":
        event.preventDefault();
        activate(0);
        break;
      case "End":
        event.preventDefault();
        activate(tabs.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div className="admin-tabs" role="tablist" aria-label="Secciones de la página">
      {tabs.map((tab, index) => {
        const isActive = location.pathname === tab.path;
        return (
          <button
            key={tab.key}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`admin-tab-${tab.key}`}
            aria-selected={isActive}
            aria-controls={`admin-tabpanel-${tab.key}`}
            tabIndex={isActive ? 0 : -1}
            className={`admin-tabs__tab ${isActive ? "admin-tabs__tab--active" : ""}`}
            onClick={() => guardedNavigate(tab.path)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
