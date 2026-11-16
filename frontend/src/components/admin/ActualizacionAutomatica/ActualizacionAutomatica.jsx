import { useEffect, useRef } from "react";

import { useUnsavedChanges } from "../../../context/UnsavedChangesContext";

/*
 * La web se recarga sola cuando hay una versión nueva (16/11/2026).
 *
 * Una pestaña abierta sigue con el código que cargó al principio aunque el
 * servidor ya tenga otro: así un arreglo desplegado no llegaba a quien tenía la
 * intranet abierta (el «sin leer» del chat). Cada minuto, y al volver a la
 * pestaña, se compara el JavaScript principal de la página publicada con el
 * que está corriendo. Si cambió, se recarga **solo cuando no hay nada que
 * guardar**:
 *
 * - ningún formulario con cambios sin guardar (`UnsavedChangesContext`);
 * - nadie escribiendo (un campo de texto con el foco);
 * - ningún texto a medio escribir en un área de texto (el mensaje del chat);
 * - ninguna ventana abierta.
 *
 * Si hay algo, espera y lo vuelve a intentar. En desarrollo (Vite) no hace nada.
 */

const CADA_CUANTO_MS = 60 * 1000;
const REINTENTO_MS = 15 * 1000;
const PATRON = /\/assets\/index-[\w-]+\.js/;

/** El script principal de la página que está corriendo. */
function scriptActual() {
  const script = document.querySelector(
    'script[type="module"][src*="/assets/index-"]',
  );
  const coincidencia = script?.getAttribute("src")?.match(PATRON);
  return coincidencia ? coincidencia[0] : null;
}

/** El de la página publicada ahora en el servidor, o null si no se pudo ver. */
export async function scriptPublicado() {
  try {
    const respuesta = await fetch("/", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!respuesta.ok) return null;
    const coincidencia = (await respuesta.text()).match(PATRON);
    return coincidencia ? coincidencia[0] : null;
  } catch {
    return null;
  }
}

/** Si alguien está escribiendo o dejó algo a medio escribir. */
export function hayAlgoEscribiendose(documento = document) {
  const activo = documento.activeElement;
  if (
    activo &&
    (activo.isContentEditable ||
      (activo.tagName === "TEXTAREA" && !activo.readOnly) ||
      (activo.tagName === "INPUT" &&
        !activo.readOnly &&
        !["button", "submit", "checkbox", "radio", "reset"].includes(
          activo.type,
        )))
  ) {
    return true;
  }
  const textoPendiente = [...documento.querySelectorAll("textarea")].some(
    (area) => !area.readOnly && !area.disabled && area.value.trim() !== "",
  );
  if (textoPendiente) return true;
  return Boolean(
    documento.querySelector(".modal.show, [role='dialog'][aria-modal='true']"),
  );
}

export function ActualizacionAutomatica() {
  const { haySinGuardar } = useUnsavedChanges();
  const nueva = useRef(false);
  const actual = useRef(null);

  useEffect(() => {
    if (import.meta.env.DEV) return undefined;
    actual.current = scriptActual();
    if (!actual.current) return undefined;
    let vivo = true;
    let reintento = null;

    function intentarRecargar() {
      if (!vivo || !nueva.current) return;
      if (haySinGuardar?.() || hayAlgoEscribiendose()) {
        reintento = setTimeout(intentarRecargar, REINTENTO_MS);
        return;
      }
      window.location.reload();
    }

    async function revisar() {
      if (!vivo || nueva.current) return;
      const publicado = await scriptPublicado();
      if (publicado && publicado !== actual.current) {
        nueva.current = true;
        intentarRecargar();
      }
    }

    const intervalo = setInterval(revisar, CADA_CUANTO_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible") revisar();
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      vivo = false;
      clearInterval(intervalo);
      clearTimeout(reintento);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, [haySinGuardar]);

  return null;
}
