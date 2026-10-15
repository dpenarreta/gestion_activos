import { useRef, useState } from "react";

import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import { mensajeDeError } from "../../utils/errores";

/** El mismo tope que el servidor (`DOCUMENT_MAX_UPLOAD_MB`). */
export const MAXIMO_MB = 10;

/**
 * Lo que se puede decir antes de subir: extensión y tamaño. Es una comodidad
 * para no esperar una subida de 30 MB que va a fallar; lo que decide —y lo
 * único que mira la firma real del PDF— es el servidor.
 */
export function problemaDelArchivo(archivo) {
  if (!archivo.name.toLowerCase().endsWith(".pdf")) {
    return "Formato no permitido. Solo se aceptan archivos PDF.";
  }
  if (archivo.size > MAXIMO_MB * 1024 * 1024) {
    return `Supera el tamaño máximo permitido (${MAXIMO_MB} MB).`;
  }
  return null;
}

function textoDelBoton(pendientes) {
  if (pendientes === 0) return "Cargar";
  return pendientes === 1
    ? "Cargar 1 archivo"
    : `Cargar ${pendientes} archivos`;
}

function tamano(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Cargar evidencia (§15.5): arrastrar y soltar, o elegir varios PDF. Cada
 * archivo tiene su barra de progreso y su error: si uno falla, los demás
 * siguen, y se ve cuál y por qué.
 */
export function CargarEvidenciaModal({ periodo, onCerrar, onCargado }) {
  const [archivos, setArchivos] = useState([]);
  const [arrastrando, setArrastrando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const entrada = useRef(null);

  function agregar(lista) {
    const nuevos = Array.from(lista).map((archivo, i) => ({
      clave: `${archivo.name}-${archivo.size}-${Date.now()}-${i}`,
      archivo,
      progreso: 0,
      estado: problemaDelArchivo(archivo) ? "error" : "listo",
      error: problemaDelArchivo(archivo),
    }));
    setArchivos((actuales) => [...actuales, ...nuevos]);
  }

  function actualizar(clave, cambios) {
    setArchivos((actuales) =>
      actuales.map((a) => (a.clave === clave ? { ...a, ...cambios } : a)),
    );
  }

  async function subir(evento) {
    evento.preventDefault();
    setSubiendo(true);
    let alguno = false;
    // Uno tras otro: el servidor versiona por nombre, y subirlos a la vez
    // podría dar la misma versión a dos copias del mismo archivo.
    for (const item of archivos.filter((a) => a.estado === "listo")) {
      actualizar(item.clave, { estado: "subiendo" });
      try {
        await matrizService.cargarEvidencia(
          periodo.id,
          item.archivo,
          (progreso) => actualizar(item.clave, { progreso }),
        );
        actualizar(item.clave, { estado: "hecho", progreso: 100 });
        alguno = true;
      } catch (err) {
        actualizar(item.clave, {
          estado: "error",
          error: mensajeDeError(err, "No se pudo cargar el archivo."),
        });
      }
    }
    setSubiendo(false);
    if (alguno) onCargado();
  }

  const pendientes = archivos.filter((a) => a.estado === "listo").length;
  const terminado =
    archivos.length > 0 &&
    archivos.every((a) => ["hecho", "error"].includes(a.estado));
  // Todo subido (o descartado): el botón pasa a cerrar la ventana.
  const listo = terminado && pendientes === 0;

  function cerrarAlTerminar(evento) {
    evento.preventDefault();
    onCerrar();
  }

  return (
    <ModalDialog
      titulo="Cargar evidencia"
      subtitulo={`${periodo.obligacion.nombre} · ${periodo.etiqueta}`}
      onCerrar={onCerrar}
      onSubmit={listo ? cerrarAlTerminar : subir}
      textoConfirmar={listo ? "Listo" : textoDelBoton(pendientes)}
      isSaving={subiendo}
      puedeConfirmar={pendientes > 0 || listo}
    >
      <div className="mz-note mt-0 mb-3">
        <Icon name="info-circle" />
        <span>
          Evidencia esperada:{" "}
          <strong>{periodo.obligacion.evidencia_esperada}</strong>
        </span>
      </div>

      <div
        className={`mz-drop ${arrastrando ? "is-drag" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          agregar(e.dataTransfer.files);
        }}
      >
        <Icon name="cloud-arrow-up" />
        <div>Arrastre los PDF aquí, o</div>
        <button
          type="button"
          className="btn btn-outline-primary btn-sm mt-2"
          onClick={() => entrada.current?.click()}
        >
          Elegir archivos
        </button>
        <input
          ref={entrada}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          aria-label="Archivos PDF de evidencia"
          onChange={(e) => {
            agregar(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="mz-small mt-2">
          Solo PDF, hasta {MAXIMO_MB} MB cada uno.
        </div>
      </div>

      {archivos.map((item) => (
        <div
          key={item.clave}
          className={`mz-upload-item ${item.estado === "error" ? "is-error" : ""}`}
        >
          <Icon
            name={
              item.estado === "hecho"
                ? "check2-circle"
                : item.estado === "error"
                  ? "x-octagon"
                  : "file-earmark-pdf"
            }
          />
          <div className="flex-grow-1 min-w-0">
            <div className="mz-ellipsis mz-strong">{item.archivo.name}</div>
            <div className="mz-small mz-faint">
              {tamano(item.archivo.size)}
              {item.estado === "hecho" && " · cargado"}
            </div>
            {item.error && <div className="mz-field-error">{item.error}</div>}
            {["subiendo", "hecho"].includes(item.estado) && (
              <div
                className="mz-bar"
                role="progressbar"
                aria-valuenow={item.progreso}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Progreso de ${item.archivo.name}`}
              >
                <i style={{ width: `${item.progreso}%` }} />
              </div>
            )}
          </div>
        </div>
      ))}
    </ModalDialog>
  );
}
