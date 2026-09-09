import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import {
  activosService,
  exportacionService,
  tiposDispositivoService,
} from "../../../api/activosService";
import {
  departamentosService,
  ubicacionesService,
} from "../../../api/organizacionService";
import { Breadcrumbs } from "../../../components/common/Breadcrumbs/Breadcrumbs";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { EscanerInput } from "../../../components/activos/EscanerInput/EscanerInput";
import { EstadoActivo } from "../../../components/activos/EstadoActivo/EstadoActivo";
import { EstadoGarantia } from "../../../components/activos/EstadoGarantia/EstadoGarantia";
import { NivelRenovacion } from "../../../components/activos/NivelRenovacion/NivelRenovacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import { descargarBlob } from "../../../utils/descargas";
import { mensajeDeError } from "../../../utils/errores";
import "./Activos.css";

const BREADCRUMB_ITEMS = [{ label: "Administración" }, { label: "Activos" }];

// Los nueve estados del §12. Los tres últimos sacan al equipo del parque:
// aparecen al final porque son la excepción, no la operación diaria.
const ESTADOS = [
  { valor: "disponible", etiqueta: "Disponible" },
  { valor: "en_uso", etiqueta: "Asignado" },
  { valor: "en_bodega", etiqueta: "En bodega" },
  { valor: "en_mantenimiento", etiqueta: "En reparación" },
  { valor: "en_garantia", etiqueta: "En reclamación de garantía" },
  { valor: "en_transito", etiqueta: "En tránsito" },
  { valor: "dado_de_baja", etiqueta: "Dado de baja" },
  { valor: "perdido", etiqueta: "Perdido" },
  { valor: "robado", etiqueta: "Robado" },
];

const CRITICIDADES = [
  { valor: "critica", etiqueta: "Crítica" },
  { valor: "alta", etiqueta: "Alta" },
  { valor: "media", etiqueta: "Media" },
  { valor: "baja", etiqueta: "Baja" },
];

const USOS = [
  { valor: "administrativo", etiqueta: "Administrativo" },
  { valor: "operativo", etiqueta: "Operativo" },
  { valor: "desarrollo", etiqueta: "Desarrollo" },
  { valor: "diseno", etiqueta: "Diseño" },
  { valor: "gerencial", etiqueta: "Gerencial" },
  { valor: "atencion_cliente", etiqueta: "Atención al cliente" },
  { valor: "bodega", etiqueta: "Bodega" },
  { valor: "infraestructura", etiqueta: "Infraestructura" },
];

// Tramos de antigüedad en meses (§14). Se ofrecen tramos y no dos casillas
// numéricas porque la pregunta real es «cuáles son viejos», y quien la hace
// no tiene un número exacto en mente.
const ANTIGUEDADES = [
  { valor: "0-12", etiqueta: "Menos de 1 año" },
  { valor: "12-36", etiqueta: "Entre 1 y 3 años" },
  { valor: "36-60", etiqueta: "Entre 3 y 5 años" },
  { valor: "60-", etiqueta: "Más de 5 años" },
];

export function ActivosList() {
  const puedeCrear = usePermission("activos.crear");
  const puedeExportar = usePermission("activos.exportar");
  const [errorExportacion, setErrorExportacion] = useState(null);
  const [isExportando, setIsExportando] = useState(false);
  const [searchParams] = useSearchParams();
  const [busqueda, setBusqueda] = useState("");
  const [tipos, setTipos] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [ubicaciones, setUbicaciones] = useState([]);

  // El listado se puede abrir preseleccionado desde otras pantallas (p. ej.
  // "activos a cargo" de un empleado, o "requieren renovación" del panel de
  // sugerencias), así que los filtros arrancan desde la URL.
  const [filtrosIniciales] = useState(() => ({
    q: "",
    tipo: searchParams.get("tipo") || "",
    departamento: searchParams.get("departamento") || "",
    custodio: searchParams.get("custodio") || "",
    estado: searchParams.get("estado") || "",
    ubicacion: searchParams.get("ubicacion") || "",
    criticidad: searchParams.get("criticidad") || "",
    uso: searchParams.get("uso") || "",
    antiguedad_min_meses: searchParams.get("antiguedad_min_meses") || "",
    antiguedad_max_meses: searchParams.get("antiguedad_max_meses") || "",
    almacenados: searchParams.get("almacenados") || "",
    requiere_renovacion: searchParams.get("requiere_renovacion") || "",
    nivel_renovacion: searchParams.get("nivel_renovacion") || "",
    garantia: searchParams.get("garantia") || "",
  }));

  const cargar = useCallback((params) => activosService.list(params), []);
  const listado = useListadoPaginado(
    cargar,
    filtrosIniciales,
    "No se pudo cargar el inventario.",
  );

  useEffect(() => {
    tiposDispositivoService
      .list({ page_size: 100 })
      .then((datos) => setTipos(datos.results ?? datos))
      .catch(() => setTipos([]));
    departamentosService
      .list({ page_size: 100 })
      .then((datos) => setDepartamentos(datos.results ?? datos))
      .catch(() => setDepartamentos([]));
    // Solo las abiertas: filtrar por una bodega cerrada no devuelve nada útil
    // y alarga un desplegable que se consulta a diario.
    ubicacionesService
      .list({ activa: "true", page_size: 100 })
      .then((datos) => setUbicaciones(datos.results ?? datos))
      .catch(() => setUbicaciones([]));
  }, []);

  function handleBuscar(event) {
    event.preventDefault();
    listado.actualizarFiltros({ q: busqueda });
  }

  async function handleExportar() {
    setIsExportando(true);
    setErrorExportacion(null);
    try {
      // Se envían los filtros vigentes: el archivo trae lo que se está viendo.
      const activos = Object.fromEntries(
        Object.entries(listado.filtros).filter(([, valor]) => valor !== ""),
      );
      descargarBlob(
        await exportacionService.activos(activos),
        "inventario-activos.xlsx",
      );
    } catch (err) {
      setErrorExportacion(
        mensajeDeError(err, "No se pudo exportar el inventario."),
      );
    } finally {
      setIsExportando(false);
    }
  }

  return (
    <div className="activos-page">
      <Breadcrumbs items={BREADCRUMB_ITEMS} />
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h2>Inventario de activos</h2>
        <div className="d-flex gap-2">
          <Link
            to="/admin/activos/escaner"
            className="btn btn-outline-primary btn-sm"
          >
            <i className="bi bi-upc-scan me-1" aria-hidden="true" />
            Escanear
          </Link>
          {puedeExportar && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={handleExportar}
              disabled={isExportando || listado.total === 0}
              title="Exporta los activos que coinciden con los filtros actuales"
            >
              <i className="bi bi-file-earmark-excel me-1" aria-hidden="true" />
              {isExportando ? "Exportando…" : `Exportar (${listado.total})`}
            </button>
          )}
          {puedeCrear && (
            <Link
              to="/admin/activos/importar"
              className="btn btn-outline-primary btn-sm"
            >
              <i className="bi bi-file-earmark-excel me-1" aria-hidden="true" />
              Carga masiva
            </Link>
          )}
          {puedeCrear && (
            <Link to="/admin/activos/new" className="btn btn-primary btn-sm">
              Nuevo activo
            </Link>
          )}
        </div>
      </div>

      <EscanerInput
        className="mb-3"
        placeholder="Escanee una etiqueta o escriba código, serie, marca o custodio"
        onEscanear={(valor) => {
          setBusqueda(valor);
          listado.actualizarFiltros({ q: valor });
        }}
      />

      <form className="d-flex gap-2 mb-3 flex-wrap" onSubmit={handleBuscar}>
        <input
          type="search"
          className="form-control form-control-sm w-auto"
          placeholder="Buscar"
          aria-label="Buscar activos"
          value={busqueda}
          onChange={(event) => setBusqueda(event.target.value)}
        />
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por tipo"
          value={listado.filtros.tipo}
          onChange={(event) =>
            listado.actualizarFiltros({ tipo: event.target.value })
          }
        >
          <option value="">Todos los tipos</option>
          {tipos.map((tipo) => (
            <option key={tipo.id} value={tipo.id}>
              {tipo.nombre}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por departamento"
          value={listado.filtros.departamento}
          onChange={(event) =>
            listado.actualizarFiltros({ departamento: event.target.value })
          }
        >
          <option value="">Todas las áreas</option>
          {departamentos.map((departamento) => (
            <option key={departamento.id} value={departamento.id}>
              {departamento.nombre}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por estado"
          value={listado.filtros.estado}
          onChange={(event) =>
            listado.actualizarFiltros({ estado: event.target.value })
          }
        >
          <option value="">Todos los estados</option>
          {ESTADOS.map((estado) => (
            <option key={estado.valor} value={estado.valor}>
              {estado.etiqueta}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por ubicación"
          value={listado.filtros.ubicacion}
          onChange={(event) =>
            listado.actualizarFiltros({ ubicacion: event.target.value })
          }
        >
          <option value="">Todas las ubicaciones</option>
          {ubicaciones.map((ubicacion) => (
            <option key={ubicacion.id} value={ubicacion.id}>
              {ubicacion.nombre_completo}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por criticidad"
          value={listado.filtros.criticidad}
          onChange={(event) =>
            listado.actualizarFiltros({ criticidad: event.target.value })
          }
        >
          <option value="">Criticidad: toda</option>
          {CRITICIDADES.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.etiqueta}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por uso"
          value={listado.filtros.uso}
          onChange={(event) =>
            listado.actualizarFiltros({ uso: event.target.value })
          }
        >
          <option value="">Uso: todos</option>
          {USOS.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.etiqueta}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por antigüedad"
          value={`${listado.filtros.antiguedad_min_meses}-${listado.filtros.antiguedad_max_meses}`}
          onChange={(event) => {
            const [minimo, maximo] = event.target.value.split("-");
            listado.actualizarFiltros({
              antiguedad_min_meses: minimo || "",
              antiguedad_max_meses: maximo || "",
            });
          }}
        >
          <option value="-">Antigüedad: toda</option>
          {ANTIGUEDADES.map((opcion) => (
            <option key={opcion.valor} value={opcion.valor}>
              {opcion.etiqueta}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por garantía"
          value={listado.filtros.garantia}
          onChange={(event) =>
            listado.actualizarFiltros({ garantia: event.target.value })
          }
        >
          <option value="">Garantía: todas</option>
          <option value="vigente">En garantía</option>
          <option value="por_vencer">Por vencer</option>
          <option value="vencida">Vencida</option>
          <option value="sin_registrar">Sin registrar</option>
        </select>
        <select
          className="form-select form-select-sm w-auto"
          aria-label="Filtrar por sugerencia de renovación"
          value={listado.filtros.nivel_renovacion}
          onChange={(event) =>
            listado.actualizarFiltros({ nivel_renovacion: event.target.value })
          }
        >
          <option value="">Renovación: todos</option>
          <option value="recomendado">Reemplazo recomendado</option>
          <option value="evaluar">Evaluar reemplazo</option>
          <option value="ninguno">Sin sugerencia</option>
        </select>
        <button type="submit" className="btn btn-outline-secondary btn-sm">
          Buscar
        </button>
      </form>

      {listado.error && (
        <div className="alert alert-danger">{listado.error}</div>
      )}
      {errorExportacion && (
        <div className="alert alert-danger">{errorExportacion}</div>
      )}

      <div className="table-responsive">
        <table className="table table-sm table-striped align-middle">
          <thead>
            <tr>
              <th>Código</th>
              <th>Activo</th>
              <th>Tipo</th>
              <th>Custodio</th>
              <th>Área</th>
              <th>Estado</th>
              <th>Garantía</th>
              <th className="text-end" title="Intervenciones acumuladas">
                Mant.
              </th>
              <th>Renovación</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((activo) => (
              <tr key={activo.id}>
                <td>
                  <code className="codigo-barras">{activo.codigo_barras}</code>
                </td>
                <td>
                  <div>{activo.nombre}</div>
                  <small className="text-muted">
                    {activo.marca} {activo.modelo} · {activo.numero_serie}
                  </small>
                </td>
                <td>{activo.tipo_nombre}</td>
                <td>
                  {activo.custodio_nombre || (
                    <span className="text-muted">Sin asignar</span>
                  )}
                </td>
                <td>{activo.departamento_nombre}</td>
                <td>
                  <EstadoActivo
                    estado={activo.estado}
                    etiqueta={activo.estado_display}
                  />
                </td>
                <td>
                  <EstadoGarantia estado={activo.estado_garantia} compacto />
                </td>
                <td className="text-end">{activo.total_mantenimientos}</td>
                <td>
                  {activo.requiere_renovacion ? (
                    <NivelRenovacion nivel={activo.nivel_renovacion} conIcono />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td>
                  <Link
                    to={`/admin/activos/${activo.id}`}
                    className="btn btn-outline-secondary btn-sm"
                  >
                    Ver ficha
                  </Link>
                </td>
              </tr>
            ))}
            {!listado.isLoading && listado.resultados.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center text-muted">
                  Sin activos que coincidan con los filtros
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Paginacion
        total={listado.total}
        pagina={listado.pagina}
        hasNext={listado.hasNext}
        hasPrevious={listado.hasPrevious}
        onCambiarPagina={listado.setPagina}
        etiqueta="activos"
      />
    </div>
  );
}
