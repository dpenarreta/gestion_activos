import { useCallback, useEffect, useState } from "react";

import { tiposDispositivoService } from "../../../api/activosService";
import {
  departamentosService,
  empleadosService,
  sedesService,
} from "../../../api/organizacionService";
import { reportesService } from "../../../api/reportesService";
import { Icon } from "../../../components/common/Icon/Icon";
import { usePermission } from "../../../hooks/usePermission";
import { descargarBlob } from "../../../utils/descargas";
import { mensajeDeError } from "../../../utils/errores";
import "./Reportes.css";

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
    sede: [],
    tipo: [],
    custodio: [],
  });
  const [errorOpciones, setErrorOpciones] = useState(null);

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
      sedesService.list({ activa: "true", page_size: 100 }),
      tiposDispositivoService.list({ page_size: 100 }),
      empleadosService.list({ activo: "true", page_size: 200 }),
    ])
      .then(([departamentos, sedes, tipos, empleados]) =>
        setOpciones({
          departamento: (departamentos.results ?? departamentos).map((d) => [
            d.id,
            d.nombre,
          ]),
          sede: (sedes.results ?? sedes).map((s) => [s.id, s.nombre]),
          tipo: (tipos.results ?? tipos).map((t) => [t.id, t.nombre]),
          custodio: (empleados.results ?? empleados).map((e) => [
            e.id,
            e.nombre_completo,
          ]),
        }),
      )
      // Antes fallaba en silencio y los filtros quedaban con solo «Todos»:
      // ahora se dice junto a ellos (revisión final UX/UI, 28/10/2026).
      .catch((err) =>
        setErrorOpciones(
          mensajeDeError(
            err,
            "No se pudieron cargar las áreas, sedes, tipos y custodios.",
          ),
        ),
      );
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
      <p className="mz-desc">
        Los trece reportes del inventario. Elija uno, acote el período o el
        alcance, y descárguelo en el formato que necesite.
      </p>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <div className="reportes-layout">
        <section className="mz-card reportes-lista">
          <div className="mz-card-head">
            <h3>Catálogo</h3>
          </div>
          {catalogo.map((reporte) => {
            const activo = seleccionado?.clave === reporte.clave;
            return (
              <button
                key={reporte.clave}
                type="button"
                className={`mz-row${activo ? " is-active" : ""}`}
                aria-pressed={activo}
                onClick={() => setSeleccionado(reporte)}
              >
                <span className="mz-row-ic">
                  <Icon name="file-earmark-text" />
                </span>
                <span className="mz-row-info">
                  <strong>{reporte.nombre}</strong>
                  <span>{reporte.descripcion}</span>
                </span>
              </button>
            );
          })}
        </section>

        {seleccionado && (
          <section className="mz-card reportes-detalle">
            <div className="mz-card-head reportes-detalle__cabecera">
              <div className="min-w-0">
                <h3>{seleccionado.nombre}</h3>
                <p className="mz-desc">{seleccionado.descripcion}</p>
              </div>
              {/* Descargar saca datos del sistema a un archivo que después
                  circula: va en el botón de exportar, que se distingue de las
                  acciones que se quedan dentro. */}
              <div className="mz-view-actions">
                {FORMATOS.map((formato) => (
                  <button
                    key={formato.clave}
                    type="button"
                    className="btn btn-exportar btn-sm"
                    disabled={!puedeExportar || descargando !== null}
                    title={
                      puedeExportar
                        ? `Descargar en ${formato.etiqueta}`
                        : "Necesita el permiso de exportación"
                    }
                    onClick={() => handleDescargar(formato.clave)}
                  >
                    <Icon name={formato.icono} />{" "}
                    {descargando === formato.clave ? "…" : formato.etiqueta}
                  </button>
                ))}
              </div>
            </div>

            <div className="mz-card-body">
              {seleccionado.parametros.length > 0 && (
                <FiltrosReporte
                  parametros={seleccionado.parametros}
                  valores={filtros}
                  opciones={opciones}
                  errorOpciones={errorOpciones}
                  onCambiar={actualizarFiltro}
                  onAplicar={() => cargarVista(seleccionado, filtros)}
                />
              )}

              {isCargando && <div className="mz-empty">Generando…</div>}

              {vista && !isCargando && (
                <>
                  <p className="mz-faint mz-small">
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

                  <div className="mz-table-wrap reportes-tabla">
                    <table className="mz-table">
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
                          <tr className="mz-empty-row">
                            <td colSpan={vista.columnas.length}>
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
  );
}

/** Filtros dibujados a partir de los parámetros que declara cada reporte. */
function FiltrosReporte({
  parametros,
  valores,
  opciones,
  errorOpciones,
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
    sede: "Sede",
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
      className="mz-filter-bar reportes-filtros"
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
          // El rótulo envuelve al campo: así queda asociado sin inventar un
          // id por parámetro, y se lee junto a él en la barra.
          <label className="reportes-filtro" key={parametro}>
            <span className="reportes-filtro__rotulo">
              {ETIQUETAS[parametro] || parametro}
            </span>
            {campo(parametro)}
          </label>
        ))}
      <button type="submit" className="btn btn-outline-secondary btn-sm">
        Aplicar filtros
      </button>
      {/* Solo si el reporte usa alguno de esos desplegables. */}
      {errorOpciones &&
        parametros.some((parametro) => parametro in opciones) && (
          <p className="mz-field-error w-100 mb-0" role="alert">
            {errorOpciones} Esos filtros quedan sin opciones; recargue la página
            para volver a intentarlo.
          </p>
        )}
    </form>
  );
}
