import { useEffect, useRef, useState } from "react";

import { nominaService } from "../../api/nominaService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { descargarBlob } from "../../utils/descargas";
import { mensajeDeError } from "../../utils/errores";

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

/** El error de una descarga llega como blob: se lee para mostrar el mensaje
 * del servidor. */
export async function mensajeDeDescarga(err) {
  const datos = err?.response?.data;
  if (datos instanceof Blob) {
    try {
      const leido = JSON.parse(await datos.text());
      return mensajeDeError(
        { response: { ...err.response, data: leido } },
        "No se pudo descargar.",
      );
    } catch {
      return "No se pudo descargar.";
    }
  }
  return mensajeDeError(err, "No se pudo descargar.");
}

/**
 * Rol de pagos → Descarga masiva (`roles_pago.descarga_masiva`, 22/10/2026):
 * un área del organigrama y un mes; baja un archivo comprimido (sin clave)
 * con un PDF por persona. El área incluye las unidades que dependen de ella.
 */
export function DescargaMasivaRolPagos({ onCerrar }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
    // Ventana de consulta y descarga: buscar no es un cambio que se pierda.
    confirmarAlDescartar: false,
  });
  const hoy = new Date();
  const [areas, setAreas] = useState(null);
  const [unidad, setUnidad] = useState("");
  const [anio, setAnio] = useState(
    hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear(),
  );
  const [mes, setMes] = useState(hoy.getMonth() === 0 ? 12 : hoy.getMonth());
  const [clave, setClave] = useState("");
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState(null);
  const [listo, setListo] = useState(null);
  const formulario = useRef(null);

  useEffect(() => {
    nominaService
      .areasDescargaMasiva()
      .then(setAreas)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar las áreas.")),
      );
  }, []);

  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i);
  const mesesDelAnio = anio === hoy.getFullYear() ? hoy.getMonth() + 1 : 12;
  const elegida = (areas ?? []).find((a) => String(a.id) === String(unidad));

  async function descargar(evento) {
    evento.preventDefault();
    setDescargando(true);
    setError(null);
    setListo(null);
    try {
      const { blob, incluidos, omitidos } = await nominaService.descargaMasiva({
        unidad: Number(unidad),
        anio,
        mes,
        password: clave,
      });
      descargarBlob(
        blob,
        `Roles de pago - ${elegida?.nombre ?? "Área"} - ${MESES[mes - 1]} ${anio}.zip`,
      );
      setListo({ incluidos, omitidos });
      setClave("");
    } catch (err) {
      setError(await mensajeDeDescarga(err));
      if (err?.response?.status === 403) setClave("");
      // El foco va al aviso, para que se lea qué falló (auditoría UX/UI,
      // fase 2, 28/10/2026).
      enfocarPrimerError(formulario.current);
    } finally {
      setDescargando(false);
    }
  }

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Descarga masiva"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>Descarga masiva por área</h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <form
          ref={formulario}
          className="mz-panel-body mz-stack"
          onSubmit={descargar}
        >
          <p className="mz-small mz-faint mb-0">
            Descarga un archivo comprimido (sin clave) con el rol de pagos de
            cada persona del área en el mes elegido, un PDF por persona. Incluye
            las unidades que dependen del área. Quien no tenga código de
            empleado o rol ese mes aparece en «LEEME.txt» dentro del archivo.
          </p>
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {listo && (
            <div className="mz-alert mz-alert--ok" role="status">
              <Icon name="check-circle" />
              Se descargó el archivo
              {listo.incluidos != null &&
                ` con ${listo.incluidos} rol(es) de pagos`}
              {listo.omitidos ? ` · ${listo.omitidos} sin rol (ver LEEME)` : ""}
              .
            </div>
          )}
          <LeyendaObligatorios />
          {/* Obligatorios marcados; mientras llegan las áreas, el campo lo
              dice (antes la lista quedaba vacía sin explicación). */}
          <Campo id="masiva-area" etiqueta="Área" obligatorio>
            <select
              className="form-select form-select-sm"
              disabled={areas === null}
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
            >
              <option value="">
                {areas === null ? "Cargando áreas…" : "Elija un área…"}
              </option>
              {(areas ?? []).map((a) => (
                <option key={a.id} value={a.id} disabled={!a.con_codigo}>
                  {a.nombre} · {a.nivel} ({a.con_codigo} con código de{" "}
                  {a.personas})
                </option>
              ))}
            </select>
          </Campo>
          <div className="row g-2">
            <div className="col-6">
              <label className="form-label mz-small" htmlFor="masiva-anio">
                Año
              </label>
              <select
                id="masiva-anio"
                className="form-select form-select-sm"
                value={anio}
                onChange={(e) => {
                  const nuevo = Number(e.target.value);
                  setAnio(nuevo);
                  if (nuevo === hoy.getFullYear() && mes > hoy.getMonth() + 1)
                    setMes(hoy.getMonth() + 1);
                }}
              >
                {anios.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6">
              <label className="form-label mz-small" htmlFor="masiva-mes">
                Mes
              </label>
              <select
                id="masiva-mes"
                className="form-select form-select-sm"
                value={mes}
                onChange={(e) => setMes(Number(e.target.value))}
              >
                {MESES.slice(0, mesesDelAnio).map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Campo
            id="masiva-clave"
            etiqueta="Confirme su contraseña"
            obligatorio
          >
            <input
              type="password"
              autoComplete="current-password"
              className="form-control form-control-sm"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
            />
          </Campo>
          <div className="mz-actions justify-content-end">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onCerrar}
            >
              Cerrar
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!unidad || !clave || descargando}
            >
              <Icon name="file-earmark-zip" />{" "}
              {descargando ? "Preparando el archivo…" : "Descargar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
