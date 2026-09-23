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
      const foundInChildren = findActivePathExpandIds(
        children,
        currentPath,
        nextPath,
      );
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

/**
 * De lo guardado, la rama que de verdad puede estar abierta a la vez.
 *
 * En modo exclusivo lo que se abre es **un camino**, no un solo grupo: con tres
 * niveles, «Configuración» y su «Organización» están abiertos los dos y eso es
 * correcto. Lo que no puede volver son dos hermanos —una sesión antigua pudo
 * guardarlos, porque el arranque los sumaba—, así que se conserva el primero de
 * cada nivel y se sigue bajando por él.
 */
function soloUnaRama(nodos, guardados) {
  for (const nodo of nodos) {
    const hijos = nodo.children || [];
    if (hijos.length === 0 || !guardados.includes(nodo.id)) {
      continue;
    }
    return [nodo.id, ...soloUnaRama(hijos, guardados)];
  }
  return [];
}

function readStoredExpandedIds(tree) {
  try {
    const raw = sessionStorage.getItem(ACCORDION_SESSION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return ACCORDION_MODE === "exclusive" ? soloUnaRama(tree, parsed) : parsed;
  } catch {
    return [];
  }
}

/** Motor de expandir/colapsar del Menú Administrativo — reutilizado en
 * cualquier nivel del árbol. No vive en Context: la profundidad acotada
 * (3 niveles) del menú de esta base no lo justifica. */
export function useMenuAccordion(tree, currentPath) {
  const [expandedIds, setExpandedIds] = useState(
    () => new Set(readStoredExpandedIds(tree)),
  );
  const previousActiveIdRef = useRef(null);

  const activeInfo = useMemo(
    () => findActivePathExpandIds(tree, currentPath),
    [tree, currentPath],
  );

  useEffect(() => {
    if (!activeInfo || previousActiveIdRef.current === activeInfo.activeId) {
      return;
    }
    previousActiveIdRef.current = activeInfo.activeId;
    setExpandedIds((current) => {
      if (ACCORDION_MODE === "exclusive" && activeInfo.expandIds.length > 0) {
        // Navegar a una sección abre la suya y cierra la que estuviera. Antes
        // se sumaba, así que bastaba con pasar por dos secciones para acabar
        // con medio menú desplegado sin haber pulsado ningún grupo: el
        // acordeón solo se cumplía al abrir a mano.
        //
        // El destino sin grupo —«Reportes», que cuelga de la raíz— se deja
        // pasar: no dice nada sobre qué grupo debería estar abierto, y cerrar
        // todo le quitaría el sitio a quien acabara de abrir uno.
        return new Set(activeInfo.expandIds);
      }
      const next = new Set(current);
      activeInfo.expandIds.forEach((id) => next.add(id));
      return next;
    });
  }, [activeInfo]);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        ACCORDION_SESSION_STORAGE_KEY,
        JSON.stringify(Array.from(expandedIds)),
      );
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
