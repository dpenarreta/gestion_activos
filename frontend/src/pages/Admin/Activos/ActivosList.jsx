import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import {
  activosService,
  categoriasActivoService,
  exportacionService,
  tiposDispositivoService,
} from "../../../api/activosService";
import {
  departamentosService,
  sedesService,
} from "../../../api/organizacionService";
import { Icon } from "../../../components/common/Icon/Icon";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { EscanerInput } from "../../../components/activos/EscanerInput/EscanerInput";
import { EstadoActivo } from "../../../components/activos/EstadoActivo/EstadoActivo";
import { EstadoGarantia } from "../../../components/activos/EstadoGarantia/EstadoGarantia";
import { NivelRenovacion } from "../../../components/activos/NivelRenovacion/NivelRenovacion";
import { useListadoPaginado } from "../../../hooks/useListadoPaginado";
import { usePermission } from "../../../hooks/usePermission";
import { descargarBlob } from "../../../utils/descargas";
import { FilaDeEstado } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { mensajeDeError } from "../../../utils/errores";
import { describirFiltros } from "./filtrosAplicados";
import "./Activos.css";

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
  const puedeAsignar = usePermission("activos.asignar");
  const puedeCambiarEstado = usePermission("activos.dar_baja");
  const puedeImprimir = usePermission("activos.imprimir_etiqueta");
  const navigate = useNavigate();
  const [errorExportacion, setErrorExportacion] = useState(null);
  const [isExportando, setIsExportando] = useState(false);
  const [searchParams] = useSearchParams();
  const [busqueda, setBusqueda] = useState(() => searchParams.get("q") || "");
  /* Los nueve desplegables ocupaban dos filas enteras y empujaban la tabla
     —que es a lo que se viene— hacia abajo. Arrancan plegados, salvo que la
     pantalla se abra ya filtrada desde otro sitio: ahí hay que poder ver y
     corregir qué se aplicó. */
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(
    () => [...searchParams.keys()].length > 0,
  );
  const [categorias, setCategorias] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [departamentos, setDepartamentos] = useState([]);
  const [sedes, setSedes] = useState([]);

  // El listado se puede abrir preseleccionado desde otras pantallas (p. ej.
  // "activos a cargo" de un empleado, o "requieren renovación" del panel de
  // sugerencias), así que los filtros arrancan desde la URL.
  const [filtrosIniciales] = useState(() => ({
    // También `q`: la búsqueda de la cabecera trae aquí lo que no era la
    // etiqueta de ningún equipo, y llegar con el campo vacío haría parecer
    // que no se buscó nada.
    q: searchParams.get("q") || "",
    categoria: searchParams.get("categoria") || "",
    tipo: searchParams.get("tipo") || "",
    departamento: searchParams.get("departamento") || "",
    custodio: searchParams.get("custodio") || "",
    compartido: searchParams.get("compartido") || "",
    estado: searchParams.get("estado") || "",
    sede: searchParams.get("sede") || "",
    criticidad: searchParams.get("criticidad") || "",
    uso: searchParams.get("uso") || "",
    propiedad: searchParams.get("propiedad") || "",
    concesionario: searchParams.get("concesionario") || "",
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
    categoriasActivoService
      .list({ activa: "true", page_size: 100 })
      .then((datos) => setCategorias(datos.results ?? datos))
      .catch(() => setCategorias([]));
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
    sedesService
      .list({ activa: "true", page_size: 100 })
      .then((datos) => setSedes(datos.results ?? datos))
      .catch(() => setSedes([]));
  }, []);

  function handleBuscar(event) {
    event.preventDefault();
    listado.actualizarFiltros({ q: busqueda });
  }

  const chips = describirFiltros(listado.filtros, {
    categorias,
    tipos,
    departamentos,
    sedes,
  });

  function quitarFiltro(claves) {
    const vaciados = Object.fromEntries(claves.map((clave) => [clave, ""]));
    if (claves.includes("q")) setBusqueda("");
    listado.actualizarFiltros(vaciados);
  }

  function limpiarFiltros() {
    setBusqueda("");
    listado.actualizarFiltros(
      Object.fromEntries(
        Object.keys(listado.filtros).map((clave) => [clave, ""]),
      ),
    );
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
      <div className="mz-view-head">
        <div>
          <h2>Inventario de activos</h2>
          <p className="mz-desc">
            Cada equipo de la empresa, con quién responde por él, dónde está y
            en qué estado se encuentra.
          </p>
        </div>
        <div className="mz-view-actions">
          <Link
            to="/admin/activos/escaner"
            className="btn btn-outline-primary btn-sm"
          >
            <Icon name="upc-scan" /> Escanear
          </Link>
          {puedeExportar && (
            <button
              type="button"
              className="btn btn-exportar btn-sm"
              onClick={handleExportar}
              disabled={isExportando || listado.total === 0}
              title="Exporta los activos que coinciden con los filtros actuales"
            >
              <Icon name="file-earmark-excel" />{" "}
              {isExportando ? "Exportando…" : `Exportar (${listado.total})`}
            </button>
          )}
          {puedeCrear && (
            <Link
              to="/admin/activos/importar"
              className="btn btn-outline-primary btn-sm"
            >
              <Icon name="file-earmark-arrow-up" /> Carga masiva
            </Link>
          )}
          {puedeCrear && (
            <Link to="/admin/activos/new" className="btn btn-primary btn-sm">
              <Icon name="plus-lg" /> Nuevo activo
            </Link>
          )}
        </div>
      </div>

      <EscanerInput
        className="mb-3"
        placeholder="Escanee una etiqueta o escriba código, serie, marca o responsable"
        onEscanear={(valor) => {
          setBusqueda(valor);
          listado.actualizarFiltros({ q: valor });
        }}
      />

      <form
        className="mz-filter-bar"
        onSubmit={handleBuscar}
        role="search"
        aria-label="Filtrar el inventario"
      >
        <label className="mz-fb-search">
          <Icon name="search" />
          <span className="visually-hidden">Buscar activos</span>
          <input
            type="search"
            placeholder="Buscar"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-outline-secondary btn-sm">
          Buscar
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          aria-expanded={filtrosAbiertos}
          aria-controls="activos-filtros-panel"
          onClick={() => setFiltrosAbiertos((abiertos) => !abiertos)}
        >
          <Icon name="funnel" /> Filtros
          {chips.length > 0 ? ` (${chips.length})` : ""}
        </button>
      </form>

      {chips.length > 0 && (
        <div className="mz-chips activos-filtros__chips">
          {chips.map((chip) => (
            <button
              key={chip.claves.join("-")}
              type="button"
              className="activos-filtros__chip"
              title={`Quitar el filtro ${chip.titulo}`}
              onClick={() => quitarFiltro(chip.claves)}
            >
              <span className="activos-filtros__chip-titulo">
                {chip.titulo}:
              </span>{" "}
              {chip.texto}
              <Icon name="x-lg" className="ms-1" />
            </button>
          ))}
          <button
            type="button"
            className="btn btn-link btn-sm activos-filtros__limpiar"
            onClick={limpiarFiltros}
          >
            Limpiar todo
          </button>
        </div>
      )}

      {filtrosAbiertos && (
        <div className="mz-filter-bar" id="activos-filtros-panel">
          <select
            className="form-select form-select-sm"
            aria-label="Filtrar por categoría"
            value={listado.filtros.categoria}
            onChange={(event) =>
              listado.actualizarFiltros({ categoria: event.target.value })
            }
          >
            <option value="">Todas las categorías</option>
            {categorias.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {categoria.nombre}
              </option>
            ))}
          </select>
          <select
            className="form-select form-select-sm"
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
            className="form-select form-select-sm"
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
            className="form-select form-select-sm"
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
            className="form-select form-select-sm"
            aria-label="Filtrar por ubicación"
            value={listado.filtros.sede}
            onChange={(event) =>
              listado.actualizarFiltros({ sede: event.target.value })
            }
          >
            <option value="">Todas las sedes</option>
            {sedes.map((sede) => (
              <option key={sede.id} value={sede.id}>
                {sede.nombre}
              </option>
            ))}
          </select>
          <select
            className="form-select form-select-sm"
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
            className="form-select form-select-sm"
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
            className="form-select form-select-sm"
            aria-label="Filtrar por propiedad"
            value={listado.filtros.propiedad}
            onChange={(event) =>
              listado.actualizarFiltros({
                propiedad: event.target.value,
                // El partner solo acota dentro de lo que es suyo: dejarlo puesto
                // al volver a «de la empresa» daría una lista siempre vacía.
                concesionario:
                  event.target.value === "concesion"
                    ? listado.filtros.concesionario
                    : "",
              })
            }
          >
            {/* Qué equipos son nuestros y qué hay que devolverle al partner son
              las dos preguntas que se hacen al cerrar una concesión o al
              valorar el parque. */}
            <option value="">Propiedad: toda</option>
            <option value="propia">De la empresa</option>
            <option value="concesion">En concesión</option>
          </select>
          <select
            className="form-select form-select-sm"
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
            className="form-select form-select-sm"
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
            className="form-select form-select-sm"
            aria-label="Filtrar por sugerencia de renovación"
            value={listado.filtros.nivel_renovacion}
            onChange={(event) =>
              listado.actualizarFiltros({
                nivel_renovacion: event.target.value,
              })
            }
          >
            <option value="">Renovación: todos</option>
            <option value="recomendado">Reemplazo recomendado</option>
            <option value="evaluar">Evaluar reemplazo</option>
            <option value="ninguno">Sin sugerencia</option>
          </select>
        </div>
      )}

      {/* El backend repara el código que llega con la distribución de teclado
          cambiada —el guion como apóstrofe— y lo dice: arreglarlo en silencio
          dejaría la pistola mal configurada, y el mismo problema reaparecería
          en la carga masiva, donde no hay nadie que lo repare. */}
      {listado.respuesta?.advertencia_lector && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="info-circle" />
          <div>
            <strong>Revise la configuración del lector.</strong>{" "}
            {listado.respuesta.advertencia_lector.mensaje}
          </div>
        </div>
      )}
      {errorExportacion && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {errorExportacion}
        </div>
      )}

      <div className="mz-table-wrap">
        <table className="mz-table mz-table--ancha mz-table--clicable">
          <thead>
            <tr>
              <th>Código</th>
              <th>Activo</th>
              <th>Tipo</th>
              <th>Custodio</th>
              <th>Área</th>
              <th>Estado</th>
              <th>Garantía</th>
              <th className="num" title="Intervenciones acumuladas">
                Mant.
              </th>
              <th>Renovación</th>
              <th className="text-end">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {listado.resultados.map((activo) => (
              <tr
                key={activo.id}
                /* Atajo, no el único camino: el nombre sigue siendo un enlace
                   de verdad —con teclado y con «abrir en otra pestaña»—, y
                   esto solo evita tener que apuntar a él. */
                onClick={(evento) => {
                  if (evento.target.closest("a, button")) return;
                  navigate(`/admin/activos/${activo.id}`);
                }}
              >
                <td>
                  <code className="codigo-barras">{activo.codigo_barras}</code>
                </td>
                <td>
                  <Link
                    to={`/admin/activos/${activo.id}`}
                    className="activos-tabla__nombre"
                  >
                    {activo.nombre}
                  </Link>
                  <small className="mz-faint mz-small d-block">
                    {activo.marca} {activo.modelo} · {activo.numero_serie}
                  </small>
                </td>
                <td>{activo.tipo_nombre}</td>
                <td>
                  {/* Los nombres, no un conteo: «3 responsables» obligaría a
                      abrir la ficha para saber a quién llamar, que es lo que
                      se está preguntando al mirar la columna. */}
                  {activo.responsables_resumen || (
                    <span className="mz-faint">Sin asignar</span>
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
                <td className="num">{activo.total_mantenimientos}</td>
                <td>
                  {activo.requiere_renovacion ? (
                    <NivelRenovacion nivel={activo.nivel_renovacion} conIcono />
                  ) : (
                    <span className="mz-faint">—</span>
                  )}
                </td>
                <td className="acciones">
                  {/* Lo que se hace desde un listado de inventario: mover un
                      equipo, cambiarle el estado o reimprimir su etiqueta.
                      Llevan a la ficha con el diálogo ya abierto, así que es
                      un clic en vez de tres, y la acción se confirma donde
                      está todo el contexto del equipo. */}
                  <div className="activos-tabla__acciones">
                    {puedeAsignar && activo.esta_operativo && (
                      <Link
                        to={`/admin/activos/${activo.id}?accion=asignar`}
                        className="btn btn-outline-primary btn-sm"
                        title={`Asignar o trasladar ${activo.nombre}`}
                        aria-label={`Asignar o trasladar ${activo.nombre}`}
                      >
                        <Icon name="person-check" />
                      </Link>
                    )}
                    {puedeCambiarEstado && (
                      <Link
                        to={`/admin/activos/${activo.id}?accion=estado`}
                        className="btn btn-outline-warning btn-sm"
                        title={`Cambiar el estado de ${activo.nombre}`}
                        aria-label={`Cambiar el estado de ${activo.nombre}`}
                      >
                        <Icon name="arrow-repeat" />
                      </Link>
                    )}
                    {puedeImprimir && (
                      <Link
                        to={`/admin/activos/${activo.id}?accion=etiqueta`}
                        className="btn btn-outline-secondary btn-sm"
                        title={`Imprimir la etiqueta de ${activo.nombre}`}
                        aria-label={`Imprimir la etiqueta de ${activo.nombre}`}
                      >
                        <Icon name="printer" />
                      </Link>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {/* Error, carga y vacío dentro de la tabla, y el vacío distingue
                «no hay activos» de «los filtros no encuentran nada», con la
                salida a mano (auditoría UX/UI, fase 2, 28/10/2026). */}
            <FilaDeEstado
              columnas={10}
              error={listado.error}
              onReintentar={listado.refresh}
              cargando={listado.isLoading && listado.resultados.length === 0}
              vacio={listado.resultados.length === 0}
              textoVacio="Todavía no hay activos registrados."
              hayFiltros={chips.length > 0}
              onLimpiarFiltros={limpiarFiltros}
            />
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
