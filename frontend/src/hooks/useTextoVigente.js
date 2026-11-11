import { useCallback, useContext, useEffect, useState } from "react";

import { privacidadService } from "../api/privacidadService";
import { AuthContext } from "../context/AuthContext";

/*
 * El texto vigente de un texto de protección de datos (US-004, 11/11/2026):
 * los que antes estaban fijos en la pantalla (cumpleaños, aniversario,
 * derechos, avisos de Nova) se leen de `GET privacidad/textos/<clave>/vigente/`
 * y se editan en «Protección de datos» → «Textos».
 *
 * Mientras llega, o si no llega, se muestra el `respaldo` (el texto que la
 * pantalla tenía fijo): nadie se queda sin leer qué pasa con sus datos. Pero
 * donde el texto se acepta, la pantalla no debe dejar aceptar el respaldo:
 * `delServidor` dice si lo que se muestra es el texto vigente de verdad.
 *
 * Se guarda un rato por empresa, persona y clave para no pedir el mismo
 * texto en cada apertura del chat de Nova o del perfil (cada empresa tiene sus
 * textos; cambiar de empresa o de sesión no reutiliza los de otra). Un fallo
 * no se guarda (se reintenta), y guardar un texto en «Textos» lo olvida.
 */

const DURACION_MS = 5 * 60 * 1000;
// En `globalThis` y no en el módulo: las pruebas lo vacían entre una y otra
// sin importar este archivo (importarlo antes que sus `vi.mock` lo ataría al
// servicio real).
const LLAVE = "__textosVigentesDeProteccion";
globalThis[LLAVE] = globalThis[LLAVE] ?? new Map();
const guardados = globalThis[LLAVE];

// La misma llave de `api/client.js` (`getEmpresaActiva`): se lee aquí sin
// importar el cliente, que varias pruebas simulan sin esa función.
const LLAVE_EMPRESA = "gestion_activos_empresa";

function empresaActiva() {
  try {
    return localStorage.getItem(LLAVE_EMPRESA) ?? "";
  } catch {
    return "";
  }
}

const llaveDe = (clave, usuario) =>
  `${empresaActiva()}|${usuario ?? ""}|${clave}`;

/** Olvida lo guardado de una clave (en toda empresa y persona) o todo. */
export function olvidarTextosVigentes(clave) {
  if (!clave) {
    guardados.clear();
    return;
  }
  [...guardados.keys()]
    .filter((llave) => llave.endsWith(`|${clave}`))
    .forEach((llave) => guardados.delete(llave));
}

function pedir(clave, usuario) {
  const llave = llaveDe(clave, usuario);
  const guardado = guardados.get(llave);
  if (guardado && Date.now() - guardado.en < DURACION_MS) {
    return guardado.promesa;
  }
  // `Promise.resolve().then`: si el servicio no estuviera (una prueba que lo
  // simula sin esta función), el error llega como rechazo y no rompe la
  // pantalla.
  const promesa = Promise.resolve()
    .then(() => privacidadService.textoVigente(clave))
    .then((datos) => {
      if (!datos || typeof datos.texto !== "string" || !datos.texto.trim()) {
        throw new Error("Texto vacío");
      }
      return datos;
    });
  guardados.set(llave, { promesa, en: Date.now() });
  promesa.catch(() => {
    if (guardados.get(llave)?.promesa === promesa) guardados.delete(llave);
  });
  return promesa;
}

/**
 * `{texto, titulo, version, cargando, error, delServidor, reintentar}`.
 * `variables` reemplaza los marcadores `{nombre}` del respaldo (el servidor ya
 * los manda reemplazados).
 */
export function useTextoVigente(clave, respaldo = "", variables = {}) {
  const [estado, setEstado] = useState({
    datos: null,
    cargando: Boolean(clave),
    error: false,
  });
  const [intento, setIntento] = useState(0);
  // Sin exigir el proveedor: los avisos se pintan también en pruebas sueltas.
  const usuario = useContext(AuthContext)?.user?.id ?? null;

  useEffect(() => {
    if (!clave) return undefined;
    let vigente = true;
    setEstado((e) => ({ ...e, cargando: true, error: false }));
    pedir(clave, usuario)
      .then((datos) => {
        if (vigente) setEstado({ datos, cargando: false, error: false });
      })
      .catch(() => {
        if (vigente) setEstado({ datos: null, cargando: false, error: true });
      });
    return () => {
      vigente = false;
    };
  }, [clave, usuario, intento]);

  const reintentar = useCallback(() => {
    olvidarTextosVigentes(clave);
    // Sin el texto anterior: mientras llega el nuevo se ve el esqueleto (y
    // no se puede aceptar el viejo).
    setEstado({ datos: null, cargando: true, error: false });
    setIntento((n) => n + 1);
  }, [clave]);

  const { datos } = estado;
  const conVariables = Object.entries(variables).reduce(
    (texto, [nombre, valor]) => texto.split(`{${nombre}}`).join(String(valor)),
    respaldo,
  );
  return {
    texto: datos ? datos.texto : conVariables,
    titulo: datos?.titulo ?? "",
    version: datos?.version ?? null,
    cargando: estado.cargando,
    error: estado.error,
    delServidor: Boolean(datos),
    reintentar,
  };
}
