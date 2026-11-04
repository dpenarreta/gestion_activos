/*
 * Importación desde Excel en dos pasos: primero la vista previa (el servidor
 * lee el archivo y dice qué haría, sin guardar nada) y después la
 * confirmación, con qué hacer con lo que ya existe. Cerrar la ventana en la
 * vista previa cancela la importación.
 */
import { useRef, useState } from "react";

import { errorDeNovedades, novedadesService } from "../../api/novedadesService";
import { Campo } from "../../components/common/Campo/Campo";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import { ErrorEnLinea, fecha } from "./comunes";

const TITULO = {
  WORKED_DAYS: "Importar Días laborados",
  OVERTIME: "Importar Horas extras",
  COLLABORATORS: "Importar base de colaboradores",
};

const COLUMNAS = {
  OVERTIME:
    "FECHA | CEDULA | NOMBRE DEL COLABORADOR | REGIONAL | ÁREA | CARGO | # HORAS EXTRAS | # HORAS SABADO | SABADO | DOMINGO | FERIADO | TRABAJO REALIZADO | OBSERVACIONES",
  COLLABORATORS:
    "CEDULA | NOMBRES COMPLETOS | REGIONAL | ÁREA | CARGO | NUEVO INGRESO (X si es un nuevo ingreso) | CODIGO EMPLEADO",
};

const RESULTADO_FILA = {
  NEW: ["Nuevo", "mz-pill--info"],
  EXISTING: ["Existente · se actualizaría", "mz-pill--warn"],
  UNCHANGED: ["Existente · sin cambios", "mz-pill--neutral"],
};

const CAMPO = {
  full_name: "Nombre",
  regional: "Regional",
  area: "Área",
  cargo: "Cargo",
  codigo_empleado: "Código de empleado",
};

export function ImportarExcel({
  tipo,
  periodo,
  rango,
  supervisorId,
  supervisorNombre,
  onCerrar,
  onImportado,
}) {
  const [archivo, setArchivo] = useState(null);
  const [lote, setLote] = useState(null);
  const [estrategia, setEstrategia] = useState("skip");
  const [errorArchivo, setErrorArchivo] = useState(null);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const entrada = useRef(null);
  const esBase = tipo === "COLLABORATORS";

  async function previsualizar() {
    if (!archivo) {
      setErrorArchivo("Elija el archivo de Excel (.xlsx).");
      entrada.current?.focus();
      return;
    }
    if (!/\.xlsx$/i.test(archivo.name)) {
      setErrorArchivo("El archivo debe ser de Excel con extensión .xlsx.");
      entrada.current?.focus();
      return;
    }
    setOcupado(true);
    setError(null);
    try {
      setLote(
        await novedadesService.vistaPrevia({
          kind: tipo,
          period: esBase ? "" : periodo,
          supervisorId: esBase ? supervisorId : undefined,
          archivo,
        }),
      );
    } catch (err) {
      setError(errorDeNovedades(err, "No se pudo leer el archivo.").mensaje);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarLote() {
    setOcupado(true);
    setError(null);
    try {
      const hecho = await novedadesService.confirmarImportacion(
        lote.id,
        estrategia,
      );
      const s = hecho.summary ?? {};
      onImportado(
        esBase
          ? `Base importada: ${s.created ?? 0} creados, ${s.updated ?? 0} actualizados, ${s.skipped ?? 0} sin cambios${s.rejected ? `, ${s.rejected} rechazados` : ""}.`
          : `Importación aplicada: ${s.applied ?? 0} aplicados, ${s.skipped ?? 0} omitidos${hecho.errors?.length ? `, ${hecho.errors.length} con error` : ""}.`,
        s.rejected || hecho.errors?.length ? "warn" : "ok",
      );
    } catch (err) {
      setError(
        errorDeNovedades(err, "No se pudo confirmar la importación.").mensaje,
      );
      setOcupado(false);
    }
  }

  async function cerrar() {
    if (lote?.status === "PREVIEW") {
      // Sin esperar respuesta: si falla, el lote queda en vista previa y no
      // aplica nada; el servidor lo informa en la revisión antes de cerrar.
      novedadesService.cancelarImportacion(lote.id).catch(() => {});
    }
    onCerrar();
  }

  const s = lote?.summary ?? {};
  const indicadores = lote
    ? esBase
      ? [
          ["Filas procesadas", s.total_rows],
          ["Nuevos", s.new_items],
          ["Existentes", s.existing_items],
          ["Se actualizarían", s.to_update],
          ["Nuevos ingresos (X)", s.new_hires],
          ["Duplicados en el archivo", s.duplicates_in_file],
          ["Filas inválidas", s.invalid_rows],
        ]
      : [
          ["Filas válidas", s.valid_rows],
          ["Filas con error", s.invalid_rows],
          ["Nuevos", s.new_items],
          ["Ya existentes", s.existing_items],
        ]
    : [];
  const hayExistentes = esBase
    ? (s.to_update ?? 0) > 0
    : (s.existing_items ?? 0) > 0;

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo={TITULO[tipo]}
      subtitulo={
        lote
          ? "Paso 2 de 2 · Revise y confirme"
          : "Paso 1 de 2 · Elija el archivo"
      }
      onCerrar={cerrar}
      onSubmit={(e) => {
        e.preventDefault();
        if (ocupado) return;
        if (lote) confirmarLote();
        else previsualizar();
      }}
      textoConfirmar={lote ? "Confirmar importación" : "Ver vista previa"}
      isSaving={ocupado}
      puedeConfirmar={lote ? (s.valid_rows ?? 0) > 0 : true}
      anchoMaximo="760px"
    >
      {!lote ? (
        <>
          {esBase ? (
            <p>
              Carga inicial o actualización de la base del equipo
              {supervisorNombre ? (
                <>
                  {" "}
                  de <strong>{supervisorNombre}</strong>
                </>
              ) : null}
              . Las cédulas nuevas se crean; las que ya están en esta base se
              informan como existentes.
            </p>
          ) : (
            <p>
              {tipo === "OVERTIME" ? "Mes" : "Período"}{" "}
              <strong>{rango?.label ?? periodo}</strong>
              {rango
                ? ` (del ${fecha(rango.start_date)} al ${fecha(rango.end_date)})`
                : ""}
              .
            </p>
          )}
          {tipo === "WORKED_DAYS" ? (
            <ul className="mz-small">
              <li>
                Columnas: Supervisor | Cargo | Cédula | Empleado | una columna
                por cada día del período, con la fecha en el encabezado.
              </li>
              <li>
                En cada celda, las horas laboradas de ese día: de 0 a 24, hasta
                2 decimales (8 o 7.5).
              </li>
              <li>
                Vacío = no reportado; 0 = cero horas. Sábados y domingos,
                vacíos.
              </li>
              {supervisorId ? (
                <li>
                  <button
                    type="button"
                    className="btn btn-link btn-sm p-0"
                    onClick={() =>
                      novedadesService
                        .plantillaDias(periodo, supervisorId)
                        .catch((err) => setError(errorDeNovedades(err).mensaje))
                    }
                  >
                    Descargar la plantilla de este período (con su equipo y las
                    fechas exactas)
                  </button>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="mz-small">
              Columnas del archivo:{" "}
              <span className="gh-mono">{COLUMNAS[tipo]}</span>
            </p>
          )}
          <Campo
            id="gh-importar-archivo"
            etiqueta="Archivo de Excel (.xlsx)"
            obligatorio
            error={errorArchivo}
            ayuda="Primero se muestra una vista previa: no se guarda nada hasta que confirme."
          >
            <input
              ref={entrada}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="form-control"
              onChange={(e) => {
                setArchivo(e.target.files?.[0] ?? null);
                setErrorArchivo(null);
              }}
            />
          </Campo>
        </>
      ) : (
        <>
          <div
            className="mz-kpi-grid mb-3"
            aria-label="Resumen de la vista previa"
          >
            {indicadores.map(([etiqueta, valor]) => (
              <div key={etiqueta} className="mz-kpi">
                <div className="mz-kpi-value">{valor ?? 0}</div>
                <div className="mz-kpi-label">{etiqueta}</div>
              </div>
            ))}
          </div>
          {s.already_imported && (
            <div className="mz-alert mz-alert--info mb-3" role="status">
              <span>
                Este mismo archivo ya se importó en este período. Si continúa,
                no se duplicarán registros.
              </span>
            </div>
          )}
          {s.ignored_columns?.length > 0 && (
            <p className="mz-small mz-faint">
              Columnas ignoradas: {s.ignored_columns.join(", ")}
            </p>
          )}
          {s.warnings?.length > 0 && (
            <div className="mz-alert mz-alert--warn mb-3" role="status">
              <div>
                <strong>Avisos (no impiden importar)</strong>
                <ul className="gh-lista-errores">
                  {s.warnings.slice(0, 50).map((w, i) => (
                    <li key={i}>
                      {w.row > 1 ? `Fila ${w.row} · ` : ""}
                      {w.column ? `${w.column}: ` : ""}
                      {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {esBase && lote.rows?.length > 0 && (
            <div className="mz-table-wrap mb-3 gh-desplazable">
              <table className="mz-table">
                <caption className="visually-hidden">Filas del archivo</caption>
                <thead>
                  <tr>
                    <th scope="col">Fila</th>
                    <th scope="col">Cédula</th>
                    <th scope="col">Nombre</th>
                    <th scope="col">Resultado</th>
                    <th scope="col">Cambios</th>
                  </tr>
                </thead>
                <tbody>
                  {lote.rows.slice(0, 500).map((r) => (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td className="gh-mono">{r.cedula}</td>
                      <td>{r.full_name}</td>
                      <td>
                        <span
                          className={`mz-pill ${RESULTADO_FILA[r.status]?.[1] ?? "mz-pill--neutral"}`}
                        >
                          {RESULTADO_FILA[r.status]?.[0] ?? r.status}
                        </span>
                      </td>
                      <td className="mz-small">
                        {Object.entries(r.changes ?? {})
                          .map(
                            ([campo, [antes, despues]]) =>
                              `${CAMPO[campo] ?? campo}: ${antes || "—"} → ${despues}`,
                          )
                          .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {lote.errors?.length > 0 && (
            <div className="mz-alert mz-alert--bad mb-3" role="alert">
              <div className="flex-grow-1">
                <strong>
                  Filas con error ({lote.errors.length}): no se guardarán.
                </strong>
                <ul className="gh-lista-errores">
                  {lote.errors.slice(0, 200).map((e, i) => (
                    <li key={i}>
                      Fila {e.row}
                      {e.column ? ` · ${e.column}` : ""}: {e.message}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm mt-2"
                  onClick={() =>
                    novedadesService
                      .erroresDeImportacion(lote.id)
                      .catch((err) => setError(errorDeNovedades(err).mensaje))
                  }
                >
                  Descargar el reporte de errores (Excel)
                </button>
              </div>
            </div>
          )}
          {hayExistentes && (
            <Campo
              id="gh-importar-estrategia"
              etiqueta={
                esBase
                  ? "Colaboradores que ya existen"
                  : "Registros que ya existen"
              }
              ayuda={
                esBase
                  ? "Nunca se modifican por importación: la cédula, el estado operativo ni el supervisor asignado."
                  : undefined
              }
              className="mb-3"
            >
              <select
                className="form-select"
                value={estrategia}
                onChange={(e) => setEstrategia(e.target.value)}
              >
                <option value="skip">
                  {esBase
                    ? "Solo crear los nuevos (no modificar los existentes)"
                    : "Omitirlos (no modificar lo existente)"}
                </option>
                <option value="update">
                  {esBase
                    ? "Crear los nuevos y actualizar nombre, regional, área y cargo de los existentes"
                    : "Actualizarlos con el valor del archivo"}
                </option>
              </select>
            </Campo>
          )}
          {(s.valid_rows ?? 0) === 0 && (
            <p className="mz-small">No hay filas válidas para importar.</p>
          )}
        </>
      )}
      <ErrorEnLinea mensaje={error} />
    </ModalDialog>
  );
}
