import { useEffect, useMemo, useRef, useState } from "react";

import {
  ACCORDION_MODE,
  ACCORDION_SESSION_STORAGE_KEY,
} from "../components/admin/AdminSidebar/adminMenuAccordionConfig";
import { matchesPath } from "../components/admin/AdminSidebar/adminMenuTree";

function findActivePathExpandIds(nodes, currentPath, pathSoFar = []) {
  for (const node of nodes) {
    const nextPath = [...pathSoFar, node];
    const children = node.children || [];
    if (children.length > 0) {
      const foundInChildren = findActivePathExpandIds(children, currentPath, nextPath);
      if (foundInChildren) {
        return foundInChildren;
      }
    }
    if (matchesPath(node.path, currentPath)) {
      return {
        activeId: node.id,
        expandIds: nextPath
          .filter((candidate) => (candidate.children || []).length > 0)
          .map((candidate) => candidate.id),
      };
    }
  }
  return null;
}

function readStoredExpandedIds() {
  try {
    const raw = sessionStorage.getItem(ACCORDION_SESSION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Motor de expandir/colapsar del Menú Administrativo — reutilizado en
 * cualquier nivel del árbol. No vive en Context: la profundidad acotada
 * (2 niveles) del menú de este template no lo justifica. */
export function useMenuAccordion(tree, currentPath) {
  const [expandedIds, setExpandedIds] = useState(() => new Set(readStoredExpandedIds()));
  const previousActiveIdRef = useRef(null);

  const activeInfo = useMemo(() => findActivePathExpandIds(tree, currentPath), [tree, currentPath]);

  useEffect(() => {
    if (!activeInfo || previousActiveIdRef.current === activeInfo.activeId) {
      return;
    }
    previousActiveIdRef.current = activeInfo.activeId;
    setExpandedIds((current) => {
      const next = new Set(current);
      activeInfo.expandIds.forEach((id) => next.add(id));
      return next;
    });
  }, [activeInfo]);

  useEffect(() => {
    try {
      sessionStorage.setItem(ACCORDION_SESSION_STORAGE_KEY, JSON.stringify(Array.from(expandedIds)));
    } catch {
      // Fallo silencioso — estado no crítico.
    }
  }, [expandedIds]);

  function isExpanded(id) {
    return expandedIds.has(id);
  }

  function toggle(id, siblingIds = []) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (ACCORDION_MODE === "exclusive") {
        siblingIds.forEach((siblingId) => next.delete(siblingId));
      }
      next.add(id);
      return next;
    });
  }

  return { isExpanded, toggle, activeId: activeInfo?.activeId ?? null };
}
