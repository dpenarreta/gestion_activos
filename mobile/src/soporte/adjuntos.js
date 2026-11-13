import { File } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";

import { anunciar } from "../accesibilidad/anunciar";
import {
  abrirConElSistema,
  borrarArchivo,
  carpetaDeDescargas,
  descargarConSesion,
  extensionDe,
} from "../adjuntos/descargas";
import { crearSelector, descartarTemporal } from "../adjuntos/seleccion";
import { soporteService } from "../api/servicios";

/**
 * Los adjuntos de la Mesa de ayuda (US-014, CA-18, 13/11/2026), con los
 * límites del servidor (`validar_adjuntos` y `validar_archivo`, que además
 * comprueba la firma del contenido): hasta 3 por envío, de hasta 10 MB, y
 * solo PDF, imágenes (JPG, PNG, WEBP), Word (DOCX) o Excel (XLSX). Se validan
 * en la app antes de enviar; lo que el servidor rechace se muestra tal cual.
 *
 * Al verlos se descargan con la sesión a `cache/soporte-adjuntos/` y se
 * borran al cerrar el visor y al salir de la ficha (LOPDP, como en la US-010
 * y la US-011); al cerrar sesión se borra la carpeta entera.
 */
export const MAX_ADJUNTOS = 3;
export const LIMITE_MB = 10;
export const TAMANO_MAXIMO_SOPORTE = LIMITE_MB * 1024 * 1024;

export const TIPOS_DE_SOPORTE = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const TEXTO_ADJUNTO_GRANDE = `El archivo pesa más de ${LIMITE_MB} MB. Elija uno más liviano o tome la foto de nuevo.`;
export const TEXTO_TIPO_NO_PERMITIDO =
  "Ese tipo de archivo no se puede adjuntar. Use un PDF, una imagen (JPG, PNG o WEBP) o un documento de Word o Excel (DOCX o XLSX).";
export const TEXTO_MAXIMO_ADJUNTOS = `Puede adjuntar hasta ${MAX_ADJUNTOS} archivos por envío. Quite uno para agregar otro.`;
export const TEXTO_AYUDA_ADJUNTOS = `Opcional: hasta ${MAX_ADJUNTOS} archivos de ${LIMITE_MB} MB (foto, PDF, Word o Excel).`;

export const TEXTO_ADJUNTO_NO_DISPONIBLE = "El archivo ya no está disponible.";
export const TEXTO_ADJUNTO_FALLO = "No se pudo descargar el archivo. Revise su conexión e intente de nuevo.";
/** G-8: un 401 o 403 no es un problema de red. */
export const TEXTO_ADJUNTO_SIN_PERMISO = "No tiene permiso para ver este archivo.";
export const TEXTO_ADJUNTO_SIN_SESION = "Su sesión terminó; inicie sesión de nuevo para ver el archivo.";
export const TEXTO_SIN_APP_PARA_ABRIR =
  "No hay una aplicación para abrir este archivo en este teléfono. Ábralo desde la web.";

const CARPETA = "soporte-adjuntos";
const IMAGENES = new Set(["jpg", "jpeg", "png", "webp"]);

const selector = crearSelector({
  tipos: TIPOS_DE_SOPORTE,
  tamanoMaximo: TAMANO_MAXIMO_SOPORTE,
  textos: { demasiadoGrande: TEXTO_ADJUNTO_GRANDE, tipoNoPermitido: TEXTO_TIPO_NO_PERMITIDO },
  nombrePorDefecto: "adjunto",
});

export const validarAdjunto = selector.validarArchivo;
export const tomarFotoParaElTicket = selector.tomarFoto;
export const elegirImagenParaElTicket = selector.elegirImagen;
export const elegirArchivoParaElTicket = selector.elegirDocumento;

/** Si se puede sumar uno más a `lista` (antes de abrir el selector). */
export function cabeOtro(lista = []) {
  return lista.length < MAX_ADJUNTOS;
}

/** Valida la lista completa antes de enviar (por si algo la cambió). */
export function validarLista(lista = []) {
  if (lista.length > MAX_ADJUNTOS) return TEXTO_MAXIMO_ADJUNTOS;
  for (const archivo of lista) {
    const { error } = validarAdjunto({ uri: archivo.uri, nombre: archivo.name, tipo: archivo.type, tamano: archivo.size });
    if (error) return `${archivo.name}: ${error}`;
  }
  return null;
}

/** Solo las rutas del contrato: la app no descarga de otro lado. */
export function rutaDeAdjuntoValida(url) {
  return typeof url === "string" && /^\/soporte\/(tickets|mis-tickets)\/\d{1,12}\/adjuntos\/\d{1,12}\/$/.test(url);
}

export function esImagen(nombre) {
  return IMAGENES.has(extensionDe(nombre));
}

export function tipoDeAdjunto(nombre) {
  return TIPOS_DE_SOPORTE[extensionDe(nombre)] ?? "application/octet-stream";
}

/** Descarga un adjunto (`{id, nombre, url}`) y devuelve el `File`. Lanza un
 * `Error` con un mensaje para la persona. */
export async function descargarAdjunto(adjunto, { empresa } = {}) {
  if (!adjunto || !rutaDeAdjuntoValida(adjunto.url)) throw new Error(TEXTO_ADJUNTO_NO_DISPONIBLE);
  // Solo las extensiones del contrato: el nombre lo eligió quien subió el
  // archivo y no debe decidir cómo se guarda en el teléfono (QA-TECH).
  const propia = extensionDe(adjunto.nombre);
  const extension = TIPOS_DE_SOPORTE[propia] ? propia : "bin";
  const destino = new File(carpetaDeDescargas(CARPETA), `adjunto-${String(adjunto.id).replace(/\D/g, "")}.${extension}`);
  try {
    return await descargarConSesion(soporteService.urlAdjunto(adjunto.url), destino, { empresa });
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
 * Ver los adjuntos de una ficha: `abrir(adjunto)` lo descarga y lo muestra
 * (imagen en el visor de la app, lo demás con el del sistema). Un toque más
 * mientras descarga no abre otro. Al desmontar, borra todo lo descargado.
 * `visor` son las props de `VisorDeImagen`.
 */
export function useVisorDeAdjuntos({ empresa } = {}) {
  const [abriendo, setAbriendo] = useState(null);
  const [error, setError] = useState(null);
  const [imagen, setImagen] = useState(null);
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
        const archivo = await descargarAdjunto(adjunto, { empresa });
        if (!montado.current) {
          borrarArchivo(archivo);
          return;
        }
        descargados.current.add(archivo);
        if (esImagen(adjunto.nombre)) {
          setImagen({ uri: archivo.uri, archivo, nombre: adjunto.nombre });
          return;
        }
        // Lo abre otra app: se borra al salir de la ficha, no antes.
        await abrirConElSistema(archivo, {
          mimeType: tipoDeAdjunto(adjunto.nombre),
          titulo: adjunto.nombre,
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

  const cerrar = useCallback(() => {
    setImagen((actual) => {
      if (actual?.archivo) {
        borrarArchivo(actual.archivo);
        descargados.current.delete(actual.archivo);
      }
      return null;
    });
  }, []);

  return {
    abriendo,
    error,
    abrir,
    visor: {
      uri: imagen?.uri ?? null,
      archivo: imagen?.archivo ?? null,
      titulo: imagen?.nombre ?? "",
      tituloPorDefecto: "Adjunto del ticket",
      etiquetaImagen: `Adjunto del ticket: ${imagen?.nombre || "imagen"}`,
      onCerrar: cerrar,
      testIDCerrar: "cerrar-adjunto",
      testIDImagen: "imagen-adjunto",
    },
  };
}

/**
 * Los archivos por enviar de un formulario: hasta 3, validados al elegirlos.
 * `agregar(como)` recibe una de las funciones de selección. Lo elegido y no
 * enviado se borra de la caché al salir; `vaciar()`, tras un envío que salió
 * bien, borra también las copias (el servidor ya las tiene). Tras un envío
 * fallido no se llama: los archivos se conservan para reintentar (CA-22).
 */
export function useAdjuntosPorEnviar() {
  const [lista, setLista] = useState([]);
  const [error, setError] = useState(null);
  const listaRef = useRef(lista);
  listaRef.current = lista;
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
      for (const archivo of listaRef.current) descartarTemporal(archivo.uri);
    };
  }, []);

  const agregar = useCallback(async (como) => {
    setError(null);
    if (!cabeOtro(listaRef.current)) {
      setError({ texto: TEXTO_MAXIMO_ADJUNTOS, clave: Date.now() });
      return false;
    }
    let resultado;
    try {
      resultado = await como();
    } catch {
      resultado = { error: "No se pudo abrir el selector. Intente de nuevo." };
    }
    if (!resultado || !montado.current) return false;
    if (resultado.error) {
      setError({ texto: resultado.error, clave: Date.now() });
      return false;
    }
    if (!cabeOtro(listaRef.current)) {
      descartarTemporal(resultado.archivo.uri);
      setError({ texto: TEXTO_MAXIMO_ADJUNTOS, clave: Date.now() });
      return false;
    }
    const nueva = [...listaRef.current, resultado.archivo];
    listaRef.current = nueva;
    setLista(nueva);
    anunciar(`Archivo listo para enviar: ${resultado.archivo.name}.`);
    return true;
  }, []);

  const quitar = useCallback((indice) => {
    const archivo = listaRef.current[indice];
    if (!archivo) return;
    descartarTemporal(archivo.uri);
    const nueva = listaRef.current.filter((_, i) => i !== indice);
    listaRef.current = nueva;
    setLista(nueva);
    setError(null);
    anunciar(`Archivo quitado: ${archivo.name}.`);
  }, []);

  const vaciar = useCallback(() => {
    for (const archivo of listaRef.current) descartarTemporal(archivo.uri);
    listaRef.current = [];
    setLista([]);
    setError(null);
  }, []);

  return { lista, error, agregar, quitar, vaciar };
}
