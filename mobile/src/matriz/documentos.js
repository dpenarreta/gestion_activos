import { File } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";

import { abrirConElSistema, borrarArchivo, carpetaDeDescargas, descargarConSesion } from "../adjuntos/descargas";
import { matrizService } from "../api/servicios";

/**
 * Las evidencias de un período de la Matriz (US-019, CA-4): solo se ven. El
 * servidor solo guarda PDF (`documentos/<id>/archivo/` responde
 * `application/pdf` y deja la traza `document.accessed`). Se descargan con la
 * sesión a `cache/matriz-documentos/` y se abren con el visor del sistema,
 * como los documentos de los permisos (US-010); se borran al salir del
 * detalle y, al cerrar sesión, con toda la carpeta (LOPDP). Nunca se abren en
 * el navegador ni con un enlace público.
 */
const CARPETA = "matriz-documentos";

export const TEXTO_EVIDENCIA_NO_DISPONIBLE = "El documento ya no está disponible.";
export const TEXTO_EVIDENCIA_FALLO = "No se pudo descargar el documento. Revise su conexión e intente de nuevo.";
export const TEXTO_EVIDENCIA_SIN_PERMISO = "No tiene permiso para ver este documento.";
export const TEXTO_EVIDENCIA_SIN_SESION = "Su sesión terminó; inicie sesión de nuevo para ver el documento.";
export const TEXTO_SIN_VISOR_PDF =
  "No hay una aplicación para abrir PDF en este teléfono. Instale un visor de PDF o ábralo desde la web.";

/** Descarga la evidencia y devuelve el `File`. Lanza un `Error` con un
 * mensaje para la persona. */
export async function descargarEvidencia(documento, { empresa } = {}) {
  const id = String(documento?.id ?? "");
  if (!/^\d{1,12}$/.test(id)) throw new Error(TEXTO_EVIDENCIA_NO_DISPONIBLE);
  // El nombre lo eligió quien subió el archivo: no decide cómo se guarda.
  const destino = new File(carpetaDeDescargas(CARPETA), `evidencia-${id}.pdf`);
  try {
    return await descargarConSesion(matrizService.urlArchivo(id), destino, { empresa });
  } catch (error) {
    const estado = error?.status ?? error?.response?.status;
    const texto =
      estado === 404
        ? TEXTO_EVIDENCIA_NO_DISPONIBLE
        : estado === 403
          ? TEXTO_EVIDENCIA_SIN_PERMISO
          : estado === 401
            ? TEXTO_EVIDENCIA_SIN_SESION
            : TEXTO_EVIDENCIA_FALLO;
    const paraLaPersona = new Error(texto);
    paraLaPersona.status = estado;
    throw paraLaPersona;
  }
}

/**
 * `abrir(documento)` lo descarga y lo abre con el visor del sistema. Un toque
 * más mientras descarga no abre otro. Al desmontar (salir del detalle) borra
 * todo lo descargado.
 */
export function useVisorDeEvidencias({ empresa } = {}) {
  const [abriendo, setAbriendo] = useState(null);
  const [error, setError] = useState(null);
  const enCurso = useRef(false);
  const descargados = useRef(new Set());
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    const lista = descargados.current;
    return () => {
      montado.current = false;
      for (const archivo of lista) borrarArchivo(archivo);
      lista.clear();
    };
  }, []);

  const abrir = useCallback(
    async (documento) => {
      if (enCurso.current || !documento) return;
      enCurso.current = true;
      setAbriendo(documento.id);
      setError(null);
      try {
        const archivo = await descargarEvidencia(documento, { empresa });
        if (!montado.current) {
          borrarArchivo(archivo);
          return;
        }
        descargados.current.add(archivo);
        await abrirConElSistema(archivo, {
          mimeType: "application/pdf",
          titulo: documento.nombre_original,
          textoSinVisor: TEXTO_SIN_VISOR_PDF,
        });
      } catch (e) {
        if (montado.current) setError({ texto: e?.message || TEXTO_EVIDENCIA_FALLO, clave: Date.now() });
      } finally {
        enCurso.current = false;
        if (montado.current) setAbriendo(null);
      }
    },
    [empresa],
  );

  return { abriendo, error, abrir };
}
