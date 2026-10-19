import { useEffect, useRef } from "react";

/**
 * Cambios de configuración que se ven en todo el sistema, sin recargar la
 * página (pedido del 19/10/2026).
 *
 * Lo que se guarda en Configuración vive en contextos que se cargan una vez al
 * entrar: el tema (logo, nombre, colores), los permisos de la sesión y las
 * empresas. El cliente HTTP avisa con un evento cada vez que una escritura en
 * esas secciones sale bien, y cada contexto vuelve a pedir lo suyo. Así el
 * cambio se ve al momento, sin perder lo que se tiene abierto.
 */
export const EVENTO_CONFIGURACION = "sistema:configuracion-cambiada";

/** Las secciones de Configuración cuyo cambio se nota fuera de su pantalla. */
const SECCIONES = {
  tema: /^\/?admin\/theme\b/,
  permisos: /^\/?admin\/(roles|users)\b/,
  empresas: /^\/?empresas\b/,
};

const ESCRITURAS = new Set(["post", "put", "patch", "delete"]);

function ruta(config) {
  const url = config?.url ?? "";
  const base = config?.baseURL ?? "";
  return url.startsWith(base) ? url.slice(base.length) : url;
}

/** Lo llama el cliente HTTP tras cada respuesta correcta. */
export function avisarCambio(config) {
  if (!ESCRITURAS.has(String(config?.method).toLowerCase())) return;
  const camino = ruta(config);
  const secciones = Object.entries(SECCIONES)
    .filter(([, patron]) => patron.test(camino))
    .map(([nombre]) => nombre);
  if (secciones.length === 0 || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(EVENTO_CONFIGURACION, { detail: { secciones } }),
  );
}

/** Ejecuta `alCambiar` cuando cambia alguna de las `secciones` dadas. */
export function useAlCambiarConfiguracion(secciones, alCambiar) {
  const ultimo = useRef(alCambiar);
  ultimo.current = alCambiar;
  const clave = secciones.join(",");

  useEffect(() => {
    const interesan = new Set(clave.split(","));
    function escuchar(evento) {
      if (evento.detail?.secciones?.some((s) => interesan.has(s))) {
        ultimo.current();
      }
    }
    window.addEventListener(EVENTO_CONFIGURACION, escuchar);
    return () => window.removeEventListener(EVENTO_CONFIGURACION, escuchar);
  }, [clave]);
}
