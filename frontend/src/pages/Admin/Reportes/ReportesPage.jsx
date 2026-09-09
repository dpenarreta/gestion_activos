import { useCallback, useEffect, useState } from "react";

import { tiposDispositivoService } from "../../../api/activosService";
import {
  departamentosService,
  empleadosService,
  ubicacionesService,
} from "../../../api/organizacionService";
import { reportesService } from "../../../api/reportesService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { usePermission } from "../../../hooks/usePermission";
import { descargarBlob } from "../../../utils/descargas";
import { mensajeDeError } from "../../../utils/errores";
import "./Reportes.css";

const BREADCRUMB_ITEMS = [{ label: "Administración" }, { label: "Reportes" }];

const FORMATOS = [
  { clave: "xlsx", etiqueta: "Excel", icono: "file-earmark-excel" },
  { clave: "csv", etiqueta: "CSV", icono: "filetype-csv" },
  { clave: "pdf", etiqueta: "PDF", icono: "file-earmark-pdf" },
];

const CRITICIDADES = [
  ["baja", "Baja"],
  ["media", "Media"],
  ["alta", "Alta"],
  ["critica", "Crítica"],
];

const USOS = [
  ["administrativo", "Administrativo"],
  ["operativo", "Operativo"],
  ["desarrollo", "Desarrollo"],
  ["diseno", "Diseño"],
  ["gerencial", "Gerencial"],
  ["atencion_cliente", "Atención al cliente"],
  ["bodega", "Bodega"],
  ["infraestructura", "Infraestructura"],
];

const TIPOS_MANTENIMIENTO = [
  ["preventivo", "Preventivo"],
  ["correctivo", "Correctivo"],
];

/**
 * Los trece reportes del §16 del documento funcional.
 *
 * Esta pantalla no sabe qué reportes existen: los pide al catálogo y dibuja
 * los filtros que cada uno declara. Un reporte nuevo se agrega en el backend
 * (`apps/reportes/catalogo.py`) y aparece aquí solo.
 */
export function ReportesPage() {
  const puedeExportar = usePermission("reportes.exportar");
  const [catalogo, setCatalogo] = useState([]);
  const [seleccionado, setSeleccionado] = useState(null);
  const [filtros, setFiltros] = useState({});
  const [vista, setVista] = useState(null);
  const [error, setError] = useState(null);
  const [isCargando, setIsCargando] = useState(false);
  const [descargando, setDescargando] = useState(null);

  const [opciones, setOpciones] = useState({
    departamento: [],
    ubicacion: [],
    tipo: [],
    custodio: [],
  });

  useEffect(() => {
    reportesService
      .catalogo()
      .then((datos) => {
        setCatalogo(datos.reportes);
        setSeleccionado(datos.reportes[0] ?? null);
      })
      .catch(() => setError("No se pudo cargar el catálogo de reportes."));

    // Los catálogos se cargan una vez y sirven a todos los reportes: pedirlos
    // cada vez que se cambia de reporte haría cuatro llamadas por clic.
    Promise.all([
      departamentosService.list({ activo: "true", page_size: 100 }),
      ubicacionesService.list({ activa: "true", page_size: 100 }),
      tiposDispositivoService.list({ page_size: 100 }),
      empleadosService.list({ activo: "true", page_size: 200 }),
    ])
      .then(([departamentos, ubicaciones, tipos, empleados]) =>
        setOpciones({
          departamento: (departamentos.results ?? departamentos).map((d) => [
            d.id,
            d.nombre,
          ]),
          ubicacion: (ubicaciones.results ?? ubicaciones).map((u) => [
            u.id,
            u.nombre_completo,
          ]),
          tipo: (tipos.results ?? tipos).map((t) => [t.id, t.nombre]),
          custodio: (empleados.results ?? empleados).map((e) => [
            e.id,
            e.nombre_completo,
          ]),
        }),
      )
      .catch(() => undefined);
  }, []);

  const cargarVista = useCallback((reporte, filtrosActuales) => {
    if (!reporte) return;
    setIsCargando(true);
    setError(null);
    reportesService
      .vistaPrevia(reporte.clave, filtrosActuales)
      .then(setVista)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo generar el reporte.")),
      )
      .finally(() => setIsCargando(false));
  }, []);

  useEffect(() => {
    setVista(null);
    setFiltros({});
    cargarVista(seleccionado, {});
  }, [seleccionado, cargarVista]);

  function actualizarFiltro(clave, valor) {
    const siguientes = { ...filtros, [clave]: valor };
    if (!valor) delete siguientes[clave];
    setFiltros(siguientes);
  }

  async function handleDescargar(formato) {
    setDescargando(formato);
    setError(null);
    try {
      const blob = await reportesService.descargar(
        seleccionado.clave,
        formato,
        filtros,
      );
      const fecha = new Date().toISOString().slice(0, 10);
      descargarBlob(blob, `${seleccionado.clave}-${fecha}.${formato}`);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo descargar el reporte."));
    } finally {
      setDescargando(null);
    }
  }

  return (
    <div className="reportes-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <h2>Reportes</h2>
      <p className="text-muted">
        Los trece reportes del documento funcional. Elija uno, acote el período
        o el alcance, y descárguelo en el formato que necesite.
      </p>

      {error && <div className="alert alert-danger">{error}</div>}

      <div className="row g-3">
        <div className="col-lg-4">
          <div className="list-group reportes-lista">
            {catalogo.map((reporte) => (
              <button
                key={reporte.clave}
                type="button"
                className={`list-group-item list-group-item-action ${
                  seleccionado?.clave === reporte.clave ? "active" : ""
                }`}
                onClick={() => setSeleccionado(reporte)}
              >
                <span className="fw-semibold d-block">{reporte.nombre}</span>
                <small
                  className={
                    seleccionado?.clave === reporte.clave ? "" : "text-muted"
                  }
                >
                  {reporte.descripcion}
                </small>
              </button>
            ))}
          </div>
        </div>

        <div className="col-lg-8">
          {seleccionado && (
            <section className="card">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
                  <div>
                    <h3 className="h5 mb-1">{seleccionado.nombre}</h3>
                    <p className="text-muted small mb-0">
                      {seleccionado.descripcion}
                    </p>
                  </div>
                  <div className="btn-group">
                    {FORMATOS.map((formato) => (
                      <button
                        key={formato.clave}
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        disabled={!puedeExportar || descargando !== null}
                        title={
                          puedeExportar
                            ? `Descargar en ${formato.etiqueta}`
                            : "Necesita el permiso de exportación"
                        }
                        onClick={() => handleDescargar(formato.clave)}
                      >
                        <i
                          className={`bi bi-${formato.icono} me-1`}
                          aria-hidden="true"
                        />
                        {descargando === formato.clave ? "…" : formato.etiqueta}
                      </button>
                    ))}
                  </div>
                </div>

                {seleccionado.parametros.length > 0 && (
                  <FiltrosReporte
                    parametros={seleccionado.parametros}
                    valores={filtros}
                    opciones={opciones}
                    onCambiar={actualizarFiltro}
                    onAplicar={() => cargarVista(seleccionado, filtros)}
                  />
                )}

                {isCargando && <p className="text-muted">Generando…</p>}

                {vista && !isCargando && (
                  <>
                    <p className="text-muted small">
                      {vista.total} fila(s)
                      {vista.total > vista.mostradas && (
                        <>
                          {" "}
                          · se muestran las primeras {vista.mostradas}
                          {/* La vista previa sirve para reconocer el reporte
                              antes de descargarlo, no para leerlo entero. */}
                        </>
                      )}
                      {vista.filtros && ` · ${vista.filtros}`}
                    </p>

                    <div className="table-responsive reportes-tabla">
                      <table className="table table-sm table-striped align-middle">
                        <thead>
                          <tr>
                            {vista.columnas.map((columna) => (
                              <th key={columna.clave}>{columna.etiqueta}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {vista.filas.map((fila, indice) => (
                            <tr key={indice}>
                              {fila.map((valor, columna) => (
                                <td key={columna}>{valor}</td>
                              ))}
                            </tr>
                          ))}
                          {vista.filas.length === 0 && (
                            <tr>
                              <td
                                colSpan={vista.columnas.length}
                                className="text-center text-muted"
                              >
                                Sin datos para este reporte con los filtros
                                actuales
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** Filtros dibujados a partir de los parámetros que declara cada reporte. */
function FiltrosReporte({
  parametros,
  valores,
  opciones,
  onCambiar,
  onAplicar,
}) {
  function campo(parametro) {
    switch (parametro) {
      case "desde":
      case "hasta":
        return (
          <input
            type="date"
            className="form-control form-control-sm"
            value={valores[parametro] || ""}
            onChange={(event) => onCambiar(parametro, event.target.value)}
          />
        );
      case "dias":
      case "antiguedad_min_meses":
      case "antiguedad_max_meses":
        return (
          <input
            type="number"
            min="0"
            className="form-control form-control-sm"
            value={valores[parametro] || ""}
            onChange={(event) => onCambiar(parametro, event.target.value)}
          />
        );
      case "criticidad":
      case "uso":
      case "tipo_mantenimiento": {
        const listas = {
          criticidad: CRITICIDADES,
          uso: USOS,
          tipo_mantenimiento: TIPOS_MANTENIMIENTO,
        };
        return (
          <select
            className="form-select form-select-sm"
            value={valores[parametro] || ""}
            onChange={(event) => onCambiar(parametro, event.target.value)}
          >
            <option value="">Todos</option>
            {listas[parametro].map(([clave, etiqueta]) => (
              <option key={clave} value={clave}>
                {etiqueta}
              </option>
            ))}
          </select>
        );
      }
      default: {
        const lista = opciones[parametro] ?? [];
        return (
          <select
            className="form-select form-select-sm"
            value={valores[parametro] || ""}
            onChange={(event) => onCambiar(parametro, event.target.value)}
          >
            <option value="">Todos</option>
            {lista.map(([clave, etiqueta]) => (
              <option key={clave} value={clave}>
                {etiqueta}
              </option>
            ))}
          </select>
        );
      }
    }
  }

  const ETIQUETAS = {
    desde: "Desde",
    hasta: "Hasta",
    dias: "Días de anticipación",
    departamento: "Área",
    ubicacion: "Ubicación",
    tipo: "Tipo de dispositivo",
    custodio: "Custodio",
    criticidad: "Criticidad",
    uso: "Uso",
    activo: "Activo",
    tipo_mantenimiento: "Tipo de intervención",
    antiguedad_min_meses: "Antigüedad mínima (meses)",
    antiguedad_max_meses: "Antigüedad máxima (meses)",
  };

  return (
    <form
      className="row g-2 align-items-end mb-3"
      onSubmit={(event) => {
        event.preventDefault();
        onAplicar();
      }}
    >
      {parametros
        // «activo» pide un id de equipo concreto: en la pantalla de reportes
        // no aporta —quien busca un equipo va a su ficha— y llenaría el
        // formulario con un desplegable de miles de opciones.
        .filter((parametro) => parametro !== "activo")
        .map((parametro) => (
          <div className="col-sm-6 col-md-4" key={parametro}>
            <label className="form-label small mb-1">
              {ETIQUETAS[parametro] || parametro}
            </label>
            {campo(parametro)}
          </div>
        ))}
      <div className="col-sm-6 col-md-3">
        <button type="submit" className="btn btn-secondary btn-sm w-100">
          Aplicar filtros
        </button>
      </div>
    </form>
  );
}
