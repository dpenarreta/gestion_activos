import { File } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  abrirConElSistema,
  borrarArchivo,
  carpetaDeDescargas,
  descargarConSesion,
  extensionDe,
} from "../adjuntos/descargas";
import { crearSelector, descartarTemporal } from "../adjuntos/seleccion";
import { adjuntosService } from "../api/servicios";

/**
 * Los adjuntos de un mantenimiento (US-022, CA-17, 16/11/2026), con los
 * límites de `backend/apps/adjuntos/models.py` (`EXTENSIONES_PERMITIDAS` y
 * `TAMANO_MAXIMO_BYTES`): PDF, imágenes (JPG, PNG, WEBP), Word (DOCX) o Excel
 * (XLSX), de hasta 10 MB. Se validan en la app antes de enviar; lo que el
 * servidor rechace (la firma del contenido, por ejemplo) se muestra tal cual.
 *
 * LOPDP, como en el chat y la Mesa de ayuda: lo elegido y no enviado se
 * borra de la caché al cerrar el formulario; lo descargado para verlo va a
 * `cache/activos-adjuntos/` y se borra al cerrar el visor, al salir del
 * detalle y, con toda la carpeta, al cerrar sesión (`CARPETAS_DE_DESCARGAS`).
 */
export const LIMITE_MB = 10;
export const TAMANO_MAXIMO_ADJUNTO = LIMITE_MB * 1024 * 1024;

export const TIPOS_DE_ARCHIVO = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const CARPETA_DE_ADJUNTOS = "activos-adjuntos";

export const TEXTO_ARCHIVO_GRANDE = `El archivo pesa más de ${LIMITE_MB} MB. Elija uno más liviano o tome la foto de nuevo.`;
export const TEXTO_ARCHIVO_NO_PERMITIDO =
  "Ese tipo de archivo no se puede adjuntar. Use un PDF, una imagen (JPG, PNG o WEBP) o un documento de Word o Excel (DOCX o XLSX).";
export const TEXTO_AYUDA_ARCHIVO = `Una foto, un PDF, un Word o un Excel de hasta ${LIMITE_MB} MB.`;
export const TEXTO_ADJUNTO_NO_DISPONIBLE = "El archivo ya no está disponible.";
export const TEXTO_ADJUNTO_FALLO = "No se pudo descargar el archivo. Revise su conexión e intente de nuevo.";
export const TEXTO_ADJUNTO_SIN_PERMISO = "No tiene permiso para ver este archivo.";
export const TEXTO_ADJUNTO_SIN_SESION = "Su sesión terminó; inicie sesión de nuevo para ver el archivo.";
export const TEXTO_SIN_APP_PARA_ABRIR =
  "No hay una aplicación para abrir este archivo en este teléfono. Ábralo desde la web.";

const IMAGENES = new Set(["jpg", "jpeg", "png", "webp"]);

const selector = crearSelector({
  tipos: TIPOS_DE_ARCHIVO,
  tamanoMaximo: TAMANO_MAXIMO_ADJUNTO,
  textos: { demasiadoGrande: TEXTO_ARCHIVO_GRANDE, tipoNoPermitido: TEXTO_ARCHIVO_NO_PERMITIDO },
  nombrePorDefecto: "adjunto",
});

export const validarArchivoDeActivo = selector.validarArchivo;
export const tomarFotoDelEquipo = selector.tomarFoto;
export const elegirImagenDelEquipo = selector.elegirImagen;
export const elegirArchivoDelEquipo = selector.elegirDocumento;

export function esImagen(nombre) {
  return IMAGENES.has(extensionDe(nombre));
}

export function tipoDeArchivo(nombre) {
  return TIPOS_DE_ARCHIVO[extensionDe(nombre)] ?? "application/octet-stream";
}

/** Descarga un adjunto (`{id, nombre_original}`) y devuelve el `File`. Lanza
 * un `Error` con un mensaje para la persona. */
export async function descargarAdjuntoDeActivo(adjunto, { empresa } = {}) {
  const id = String(adjunto?.id ?? "");
  if (!/^\d{1,12}$/.test(id)) throw new Error(TEXTO_ADJUNTO_NO_DISPONIBLE);
  // El nombre lo eligió quien subió el archivo: solo decide la extensión, y
  // solo si es del contrato.
  const propia = extensionDe(adjunto.nombre_original);
  const extension = TIPOS_DE_ARCHIVO[propia] ? propia : "bin";
  const destino = new File(carpetaDeDescargas(CARPETA_DE_ADJUNTOS), `adjunto-${id}.${extension}`);
  try {
    return await descargarConSesion(adjuntosService.urlDescarga(id), destino, { empresa });
  } catch (error) {
    const estado = error?.status ?? error?.response?.status;
    const texto =
      estado === 404 || estado === 400
        ? TEXTO_ADJUNTO_NO_DISPONIBLE
        : estado === 403
          ? TEXTO_ADJUNTO_SIN_PERMISO
          : estado === 401
            ? TEXTO_ADJUNTO_SIN_SESION
            : TEXTO_ADJUNTO_FALLO;
    const paraLaPersona = new Error(texto);
    paraLaPersona.status = estado;
    throw paraLaPersona;
  }
}

/**
 * Ver los adjuntos: `abrir(adjunto)` lo descarga y lo muestra (la imagen con
 * el visor de la app, lo demás con el del sistema). Un toque más mientras
 * descarga no abre otro. Al desmontar borra todo lo descargado. `visor` son
 * las props de `VisorDeImagen`.
 */
export function useVisorDeAdjuntosDeActivo({ empresa } = {}) {
  const [abriendo, setAbriendo] = useState(null);
  const [error, setError] = useState(null);
  const [imagen, setImagen] = useState(null);
  const imagenRef = useRef(null);
  imagenRef.current = imagen;
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
    async (adjunto) => {
      if (enCurso.current || !adjunto) return;
      enCurso.current = true;
      setAbriendo(adjunto.id);
      setError(null);
      try {
        const archivo = await descargarAdjuntoDeActivo(adjunto, { empresa });
        if (!montado.current) {
          borrarArchivo(archivo);
          return;
        }
        descargados.current.add(archivo);
        if (esImagen(adjunto.nombre_original)) {
          setImagen({ uri: archivo.uri, archivo, nombre: adjunto.nombre_original });
          return;
        }
        // Lo abre otra app: se borra al salir del detalle, no antes.
        await abrirConElSistema(archivo, {
          mimeType: tipoDeArchivo(adjunto.nombre_original),
          titulo: adjunto.nombre_original,
          textoSinVisor: TEXTO_SIN_APP_PARA_ABRIR,
        });
      } catch (e) {
        if (montado.current) setError({ texto: e?.message || TEXTO_ADJUNTO_FALLO, clave: Date.now() });
      } finally {
        enCurso.current = false;
        if (montado.current) setAbriendo(null);
      }
    },
    [empresa],
  );

  // QA-TECH P3: el borrado va fuera del actualizador de estado (React puede
  // llamarlo dos veces).
  const cerrar = useCallback(() => {
    const actual = imagenRef.current;
    if (actual?.archivo) {
      borrarArchivo(actual.archivo);
      descargados.current.delete(actual.archivo);
    }
    setImagen(null);
  }, []);

  return {
    abriendo,
    error,
    abrir,
    visor: {
      uri: imagen?.uri ?? null,
      archivo: imagen?.archivo ?? null,
      titulo: imagen?.nombre ?? "",
      tituloPorDefecto: "Adjunto del mantenimiento",
      etiquetaImagen: `Adjunto del mantenimiento: ${imagen?.nombre || "imagen"}`,
      onCerrar: cerrar,
      testIDCerrar: "cerrar-adjunto",
      testIDImagen: "imagen-adjunto",
    },
  };
}

/**
 * El archivo por enviar de «Adjuntar» (uno a la vez, con su tipo). `elegir(como)`
 * recibe una de las funciones de selección. Lo elegido y no enviado se borra
 * de la caché al reemplazarlo, al quitarlo y al desmontar; `soltar()`, tras un
 * envío que salió bien, también borra la copia (el servidor ya la tiene).
 */
export function useArchivoPorEnviar() {
  const [archivo, setArchivo] = useState(null);
  const [error, setError] = useState(null);
  const archivoRef = useRef(null);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      if (archivoRef.current) descartarTemporal(archivoRef.current.uri);
    };
  }, []);

  const fijar = useCallback((nuevo) => {
    if (archivoRef.current && archivoRef.current.uri !== nuevo?.uri) descartarTemporal(archivoRef.current.uri);
    archivoRef.current = nuevo;
    setArchivo(nuevo);
  }, []);

  const elegir = useCallback(
    async (como) => {
      setError(null);
      let resultado;
      try {
        resultado = await como();
      } catch {
        resultado = { error: "No se pudo abrir el selector. Intente de nuevo." };
      }
      if (!resultado) return false;
      if (!montado.current) {
        if (resultado.archivo) descartarTemporal(resultado.archivo.uri);
        return false;
      }
      if (resultado.error) {
        setError({ texto: resultado.error, clave: Date.now() });
        return false;
      }
      fijar(resultado.archivo);
      return true;
    },
    [fijar],
  );

  const quitar = useCallback(() => {
    fijar(null);
    setError(null);
  }, [fijar]);

  return { archivo, error, elegir, quitar, soltar: quitar };
}
