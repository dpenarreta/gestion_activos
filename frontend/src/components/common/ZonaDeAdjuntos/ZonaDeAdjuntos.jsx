import { useEffect, useRef, useState } from "react";

import { Icon } from "../Icon/Icon";
import "./ZonaDeAdjuntos.css";

export const EXTENSIONES = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".docx",
  ".xlsx",
];
export const MAX_BYTES = 10 * 1024 * 1024;

const dos = (n) => String(n).padStart(2, "0");

/** «captura-2026-11-18-104512.png»: el nombre de una imagen pegada. */
export function nombreDeCaptura(tipo, ahora = new Date()) {
  const ext =
    (tipo || "image/png").split("/")[1]?.replace("jpeg", "jpg") || "png";
  return `captura-${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(
    ahora.getDate(),
  )}-${dos(ahora.getHours())}${dos(ahora.getMinutes())}${dos(ahora.getSeconds())}.${ext}`;
}

function extension(nombre) {
  const punto = String(nombre).lastIndexOf(".");
  return punto >= 0 ? String(nombre).slice(punto).toLowerCase() : "";
}

function tamano(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Los archivos del portapapeles; una imagen pegada sin nombre propio
 * (una captura) recibe uno con la fecha y la hora. */
export function archivosDelPortapapeles(datos) {
  const items = Array.from(datos?.items ?? []);
  const desdeItems = items
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(Boolean);
  const lista = desdeItems.length ? desdeItems : Array.from(datos?.files ?? []);
  return lista.map((archivo, i) => {
    const sinNombre = !archivo.name || /^image\.\w+$/i.test(archivo.name);
    if (!sinNombre || !String(archivo.type).startsWith("image/"))
      return archivo;
    const ahora = new Date(Date.now() + i * 1000);
    return new File([archivo], nombreDeCaptura(archivo.type, ahora), {
      type: archivo.type,
    });
  });
}

/**
 * La zona para las evidencias (18/11/2026, pedido del usuario): pegar una
 * captura de pantalla con Ctrl+V —sobre la zona o en cualquier parte de la
 * pantalla mientras está abierta—, arrastrar y soltar, o elegir archivos.
 * Muestra lo agregado con su tamaño y un botón para quitar cada uno, y avisa
 * lo que no se pudo agregar (tipo, tamaño o cantidad). El servidor vuelve a
 * validar todo.
 *
 * - `archivos` / `onCambio(archivos)`: la lista, controlada por el padre.
 * - `etiqueta`: texto o JSX; la zona toma su nombre del `<label>` visible.
 * - `pegarEnTodaLaPantalla`: Ctrl+V con una imagen en el portapapeles la
 *   agrega aunque el foco esté en otro campo (el texto se pega como siempre).
 */
export function ZonaDeAdjuntos({
  id,
  etiqueta,
  ayuda,
  archivos,
  onCambio,
  max = 3,
  maxBytes = MAX_BYTES,
  extensiones = EXTENSIONES,
  pegarEnTodaLaPantalla = true,
  deshabilitado = false,
}) {
  const entrada = useRef(null);
  const zona = useRef(null);
  const quitarRefs = useRef([]);
  const [exito, setExito] = useState("");
  const [problema, setProblema] = useState("");
  // Cambia con cada aviso: el texto se vuelve a montar y el lector de
  // pantalla lo anuncia aunque repita el anterior.
  const [vez, setVez] = useState(0);
  const [encima, setEncima] = useState(false);
  // Tras quitar un archivo, a qué «Quitar» va el foco (o a la zona).
  const [enfocar, setEnfocar] = useState(null);
  // Lo último, para los escuchadores de toda la pantalla.
  const estado = useRef({ archivos, onCambio, deshabilitado });
  estado.current = { archivos, onCambio, deshabilitado };

  const lleno = archivos.length >= max;
  const idEtiqueta = `${id}-etiqueta`;
  const idInstruccion = `${id}-instruccion`;
  const idAyuda = `${id}-ayuda`;

  function avisar(textoExito, textoProblema) {
    setExito(textoExito);
    setProblema(textoProblema);
    setVez((n) => n + 1);
  }

  function agregar(nuevos) {
    if (estado.current.deshabilitado || nuevos.length === 0) return;
    const actuales = estado.current.archivos;
    const aceptados = [];
    const problemas = [];
    for (const archivo of nuevos) {
      if (!extensiones.includes(extension(archivo.name))) {
        problemas.push(`«${archivo.name}» no es un tipo permitido`);
      } else if (archivo.size > maxBytes) {
        problemas.push(`«${archivo.name}» pesa más de ${tamano(maxBytes)}`);
      } else if (actuales.length + aceptados.length >= max) {
        problemas.push(`solo se aceptan ${max} archivos`);
        break;
      } else {
        aceptados.push(archivo);
      }
    }
    if (aceptados.length) {
      estado.current.onCambio([...actuales, ...aceptados]);
      // Al llenarse, el foco queda en la zona (el botón se deshabilita).
      if (actuales.length + aceptados.length >= max) setEnfocar("zona");
    }
    avisar(
      aceptados.length === 1
        ? `Se agregó «${aceptados[0].name}».`
        : aceptados.length > 1
          ? `Se agregaron ${aceptados.length} archivos.`
          : "",
      problemas.length ? `No se agregó: ${problemas.join("; ")}.` : "",
    );
  }
  const agregarRef = useRef(agregar);
  agregarRef.current = agregar;

  useEffect(() => {
    if (!pegarEnTodaLaPantalla) return undefined;
    function alPegar(evento) {
      if (estado.current.deshabilitado) return; // se pega como siempre
      const pegados = archivosDelPortapapeles(evento.clipboardData);
      if (pegados.length === 0) return; // texto: se pega como siempre
      evento.preventDefault();
      agregarRef.current(pegados);
    }
    document.addEventListener("paste", alPegar);
    return () => document.removeEventListener("paste", alPegar);
  }, [pegarEnTodaLaPantalla]);

  // Un archivo soltado fuera de la zona no debe abrirse en la pestaña (se
  // perdería lo escrito en el formulario).
  useEffect(() => {
    const evitar = (evento) => {
      if (evento.dataTransfer?.types?.includes?.("Files"))
        evento.preventDefault();
    };
    document.addEventListener("dragover", evitar);
    document.addEventListener("drop", evitar);
    return () => {
      document.removeEventListener("dragover", evitar);
      document.removeEventListener("drop", evitar);
    };
  }, []);

  useEffect(() => {
    if (enfocar === null) return;
    if (enfocar === "zona") zona.current?.focus();
    else quitarRefs.current[enfocar]?.focus();
    setEnfocar(null);
  }, [enfocar, archivos]);

  function quitar(indice) {
    const quitado = archivos[indice];
    const quedan = archivos.length - 1;
    onCambio(archivos.filter((_, i) => i !== indice));
    setEnfocar(quedan === 0 ? "zona" : Math.min(indice, quedan - 1));
    avisar(`Se quitó «${quitado.name}».`, "");
  }

  const acepta = !deshabilitado && !lleno;

  return (
    <div className="zona-adjuntos">
      <label id={idEtiqueta} className="form-label" htmlFor={id}>
        {etiqueta}
      </label>
      {/* La zona recibe el foco para pegar con Ctrl+V; con el ratón, un
          clic en ella y pegar. */}
      {}
      <div
        ref={zona}
        className={[
          "zona-adjuntos__zona",
          encima && acepta && "zona-adjuntos__zona--encima",
          lleno && "zona-adjuntos__zona--llena",
          deshabilitado && "zona-adjuntos__zona--deshabilitada",
        ]
          .filter(Boolean)
          .join(" ")}
        tabIndex={deshabilitado ? -1 : 0}
        role="group"
        aria-labelledby={`${idEtiqueta} ${idInstruccion}`}
        aria-describedby={ayuda ? idAyuda : undefined}
        aria-disabled={deshabilitado || undefined}
        onPaste={(e) => {
          if (pegarEnTodaLaPantalla || deshabilitado) return; // ya lo atiende la pantalla
          const pegados = archivosDelPortapapeles(e.clipboardData);
          if (pegados.length) {
            e.preventDefault();
            agregar(pegados);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (acepta) setEncima(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget)) return;
          setEncima(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setEncima(false);
          agregar(Array.from(e.dataTransfer?.files ?? []));
        }}
      >
        <Icon name="clipboard-plus" className="zona-adjuntos__icono" />
        <span id={idInstruccion} className="zona-adjuntos__texto">
          {lleno ? (
            `Ya agregó ${max} archivos (el máximo). Quite uno para cambiarlo.`
          ) : (
            <>
              <span className="zona-adjuntos__escritorio">
                <strong>Pegue aquí su captura (Ctrl+V)</strong>, arrástrela o
                use el botón.
              </span>
              <span className="zona-adjuntos__tactil">
                Toque el botón para elegir una foto o un archivo.
              </span>
            </>
          )}
        </span>
        <button
          type="button"
          className="btn btn-outline-primary btn-sm zona-adjuntos__elegir"
          disabled={!acepta}
          onClick={() => entrada.current?.click()}
        >
          <Icon name="paperclip" /> Elegir archivos
        </button>
        <input
          ref={entrada}
          id={id}
          type="file"
          className="visually-hidden"
          tabIndex={-1}
          multiple
          accept={extensiones.join(",")}
          disabled={!acepta}
          onChange={(e) => {
            agregar(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      {ayuda && (
        <div id={idAyuda} className="form-text">
          {ayuda}
        </div>
      )}
      {archivos.length > 0 && (
        <ul className="zona-adjuntos__lista" aria-label="Archivos por adjuntar">
          {archivos.map((archivo, i) => (
            <li key={`${archivo.name}-${i}`}>
              <Icon
                name={
                  String(archivo.type).startsWith("image/")
                    ? "image"
                    : "file-earmark"
                }
              />
              <span className="zona-adjuntos__nombre">{archivo.name}</span>
              <span className="mz-faint">{tamano(archivo.size)}</span>
              <button
                ref={(nodo) => {
                  quitarRefs.current[i] = nodo;
                }}
                type="button"
                className="btn btn-link btn-sm ms-auto"
                aria-label={`Quitar ${archivo.name}`}
                disabled={deshabilitado}
                onClick={() => quitar(i)}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mz-small mz-faint mt-1" role="status">
        <span key={vez}>{exito}</span>
      </div>
      {problema && (
        <div
          key={vez}
          className="mz-small zona-adjuntos__problema"
          role="alert"
        >
          <Icon name="exclamation-circle" /> {problema}
        </div>
      )}
    </div>
  );
}
