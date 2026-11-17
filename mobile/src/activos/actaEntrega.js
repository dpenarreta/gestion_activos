import { File } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  abrirConElSistema,
  borrarArchivo,
  carpetaDeDescargas,
  descargarConSesion,
} from "../adjuntos/descargas";
import { actasEntregaService } from "../api/servicios";
import { abrirEnNavegador, urlWeb } from "../navegador/enlaceWeb";
import { CARPETA_DE_ADJUNTOS } from "./adjuntos";
import { mensajeDeActivos } from "./formato";

/**
 * El acta de recepción de equipo AEE-LC-01 desde la ficha del activo (US-028,
 * CA-7, 17/11/2026), como `AccionesActa` de `ActivoDetalle.jsx` (commit
 * 1fa8531): la ve quien tiene `activos.acta_entrega`, en cada asignación a
 * una persona.
 *
 * - Si el acta ya se generó, se descarga el PDF con la sesión y se abre con
 *   el visor del sistema, igual que los adjuntos de los activos (Quick Look
 *   en iOS; en Android, la app de PDF). El Word editable es para corregirlo
 *   en el computador: queda en la web.
 * - Si todavía no se generó, hay que llenarla (equipos del día, prueba de
 *   funcionalidad y observaciones del técnico), y eso se hace en la ficha del
 *   activo de la web: se abre en el navegador, con la confirmación de salida.
 *   También si el teléfono no tiene con qué abrir el PDF.
 *
 * LOPDP: el PDF va a `cache/activos-adjuntos/` y se borra al salir de la
 * ficha y, con toda la carpeta, al cerrar sesión.
 */

export const PERMISO_ACTA_ENTREGA = "activos.acta_entrega";
export const TITULO_ACTA_ENTREGA = "Acta de recepción (AEE-LC-01)";
export const TEXTO_ABRIENDO_ACTA = "Abriendo el acta de recepción…";
export const TEXTO_ACTA_SIN_GENERAR =
  "El acta de esta entrega todavía no se ha generado. Se llena en la ficha del activo en la web, con la prueba de funcionalidad del equipo.";
export const TEXTO_ACTA_SIN_VISOR =
  "No hay una aplicación para abrir el PDF en este teléfono. Puede verla en la ficha del activo en la web.";
export const TEXTO_ACTA_FALLO = "No se pudo abrir el acta. Revise su conexión e intente de nuevo.";
export const TEXTO_ACTA_SIN_PERMISO = "No tiene permiso para ver el acta de entrega.";
export const TEXTO_ACTA_NO_DISPONIBLE = "Esta asignación ya no está disponible.";

/** Como la web: con el permiso, en una asignación a una persona. */
export function conActaDeEntrega(movimiento, permisos = []) {
  return (
    Array.isArray(permisos) &&
    permisos.includes(PERMISO_ACTA_ENTREGA) &&
    movimiento?.tipo === "asignacion" &&
    Boolean(movimiento?.custodio_nuevo_nombre)
  );
}

function errorParaLaPersona(error) {
  const estado = error?.status ?? error?.response?.status;
  if (estado === 403) return TEXTO_ACTA_SIN_PERMISO;
  if (estado === 404 || estado === 400) return TEXTO_ACTA_NO_DISPONIBLE;
  if (error?.response) return mensajeDeActivos(error, TEXTO_ACTA_FALLO);
  return TEXTO_ACTA_FALLO;
}

/** Descarga el PDF del acta `id` y devuelve el `File`. */
export async function descargarActaDeEntrega(id, { empresa } = {}) {
  const limpio = String(id ?? "");
  if (!/^\d{1,12}$/.test(limpio)) throw Object.assign(new Error(TEXTO_ACTA_NO_DISPONIBLE), { status: 404 });
  const destino = new File(carpetaDeDescargas(CARPETA_DE_ADJUNTOS), `acta-entrega-${limpio}.pdf`);
  return descargarConSesion(actasEntregaService.urlDocumento(limpio, "pdf"), destino, { empresa });
}

/**
 * `abrir(movimiento)`: pide el acta de esa asignación y la muestra, o lleva a
 * la web si falta generarla. Un toque más mientras trabaja no abre otra.
 * `aviso`: `{tipo, texto, clave}` para la `Alerta` de la ficha.
 */
export function useActaDeEntrega({ activoId, empresa } = {}) {
  const [abriendo, setAbriendo] = useState(null);
  const [aviso, setAviso] = useState(null);
  const enCurso = useRef(false);
  const montado = useRef(true);
  const descargados = useRef(new Set());

  useEffect(() => {
    montado.current = true;
    const lista = descargados.current;
    return () => {
      montado.current = false;
      for (const archivo of lista) borrarArchivo(archivo);
      lista.clear();
    };
  }, []);

  const abrirEnLaWeb = useCallback(
    () => abrirEnNavegador(urlWeb(`/admin/activos/${encodeURIComponent(String(activoId))}`, { empresa }), { avisarSiFalla: true }),
    [activoId, empresa],
  );

  const abrir = useCallback(
    async (movimiento) => {
      if (enCurso.current || !movimiento) return;
      enCurso.current = true;
      setAbriendo(movimiento.id);
      setAviso(null);
      let irALaWeb = false;
      try {
        const datos = await actasEntregaService.preparar(movimiento.id, { empresa });
        if (!montado.current) return;
        const acta = datos?.acta;
        if (!acta?.id) {
          setAviso({ tipo: "info", texto: TEXTO_ACTA_SIN_GENERAR, clave: Date.now() });
          irALaWeb = true;
        } else {
          const archivo = await descargarActaDeEntrega(acta.id, { empresa });
          if (!montado.current) {
            borrarArchivo(archivo);
            return;
          }
          descargados.current.add(archivo);
          try {
            await abrirConElSistema(archivo, {
              mimeType: "application/pdf",
              titulo: `Acta de recepción AEE-LC-01 N.º ${acta.id}`,
              textoSinVisor: TEXTO_ACTA_SIN_VISOR,
            });
          } catch {
            if (montado.current) setAviso({ tipo: "aviso", texto: TEXTO_ACTA_SIN_VISOR, clave: Date.now() });
            irALaWeb = true;
          }
        }
      } catch (error) {
        if (montado.current) setAviso({ tipo: "mal", texto: errorParaLaPersona(error), clave: Date.now() });
      } finally {
        if (montado.current) setAbriendo(null);
        // Sin ir a la web, el candado se suelta aquí.
        if (!irALaWeb || !montado.current) enCurso.current = false;
      }
      if (!enCurso.current) return;
      // La confirmación de salida espera a la persona: el botón ya no se ve
      // ocupado, pero el candado sigue hasta que responda (QA, 17/11/2026),
      // para que un doble toque no abra dos confirmaciones.
      try {
        await abrirEnLaWeb();
      } finally {
        enCurso.current = false;
      }
    },
    [empresa, abrirEnLaWeb],
  );

  return { abriendo, aviso, abrir };
}
