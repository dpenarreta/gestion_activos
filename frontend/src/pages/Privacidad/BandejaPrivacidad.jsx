/*
 * Bandeja de solicitudes de derechos sobre datos personales
 * (`/admin/privacidad/solicitudes`), para quien tiene `privacidad.ver` o
 * `privacidad.atender`. Lo más urgente primero (las abiertas por fecha
 * límite: lo ordena el servidor), con filtros por estado, tipo y vencidas,
 * búsqueda en vivo por el número o el titular y paginación.
 *
 * Los filtros viven en la URL: al volver del detalle (o recargar) la bandeja
 * queda como se dejó, y el foco vuelve a la solicitud que se abrió.
 */
import { useCallback, useEffect, useRef } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import { privacidadService } from "../../api/privacidadService";
import { AnuncioDeResultados } from "../../components/common/AnuncioDeResultados/AnuncioDeResultados";
import {
  EstadoDeCarga,
  FilaDeEstado,
} from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { Paginacion } from "../../components/common/Paginacion/Paginacion";
import { useBusquedaEnVivo } from "../../hooks/useBusquedaEnVivo";
import { useListadoPaginado } from "../../hooks/useListadoPaginado";
import { useVistaDeTarjetas } from "../../hooks/useMediaQuery";
import { fecha } from "../GestionHumana/comunes";
import { PildoraEstado, PildoraTipo, Plazo } from "./Piezas";
import {
  ESTADOS,
  RUTA_CONSENTIMIENTO,
  TIPOS,
  idFilaSolicitud,
  rutaDeSolicitud,
} from "./privacidadComunes";
import "./Privacidad.css";

const VACIOS = { q: "", estado: "", tipo: "", vencidas: "" };

function filtrosDeLaUrl(parametros) {
  return {
    q: parametros.get("q") ?? "",
    estado: parametros.get("estado") ?? "",
    tipo: parametros.get("tipo") ?? "",
    vencidas: parametros.get("vencidas") === "1" ? "1" : "",
  };
}

export function BandejaPrivacidad() {
  const location = useLocation();
  const navigate = useNavigate();
  const [parametros, setParametros] = useSearchParams();
  const iniciales = useRef(filtrosDeLaUrl(parametros)).current;
  const enTarjetas = useVistaDeTarjetas();
  const campoBusqueda = useRef(null);
  // La solicitud de la que se vino (el «Volver» del detalle la manda).
  const desde = useRef(location.state?.desde ?? null);

  const cargar = useCallback((params) => privacidadService.bandeja(params), []);
  const listado = useListadoPaginado(
    cargar,
    iniciales,
    "No se pudieron cargar las solicitudes.",
  );
  const busqueda = useBusquedaEnVivo({
    inicial: iniciales.q,
    alBuscar: (q) => listado.actualizarFiltros({ q }),
  });

  // Los filtros a la URL (sin apilar historial): «Volver» y recargar los
  // conservan.
  const { filtros } = listado;
  useEffect(() => {
    const nuevos = new URLSearchParams();
    Object.entries(filtros).forEach(([clave, valor]) => {
      if (valor) nuevos.set(clave, valor);
    });
    if (nuevos.toString() !== parametros.toString())
      setParametros(nuevos, { replace: true, state: null });
    // Solo cuando cambian los filtros.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros]);

  // El «desde» llega en el estado de la navegación: se usa una vez y se
  // borra, si no el foco volvería ahí al recargar.
  useEffect(() => {
    if (location.state)
      navigate(
        { pathname: location.pathname, search: location.search },
        { replace: true, state: null },
      );
    // Solo al llegar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!desde.current || listado.isLoading) return;
    document.getElementById(idFilaSolicitud(desde.current))?.focus();
    desde.current = null;
  }, [listado.isLoading, listado.resultados]);

  const hayFiltros = Object.values(filtros).some(Boolean);
  function limpiarFiltros() {
    busqueda.fijar("");
    listado.actualizarFiltros(VACIOS);
  }

  const totales = listado.respuesta?.totales;
  const volverA = location.search;
  const solicitudes = listado.resultados;
  const estado = {
    error: listado.error,
    onReintentar: listado.refresh,
    cargando: listado.isLoading && solicitudes.length === 0,
    vacio: !listado.isLoading && solicitudes.length === 0,
    textoVacio: "Todavía no hay solicitudes de derechos sobre datos.",
    hayFiltros,
    onLimpiarFiltros: limpiarFiltros,
    termino: filtros.q,
    campoBusquedaRef: campoBusqueda,
  };

  return (
    <div className="mz-stack pv-bandeja">
      <div className="mz-view-head">
        <div>
          <h2>Protección de datos: solicitudes</h2>
          <p className="mz-desc">
            Lo que las personas piden sobre sus datos personales (LOPDP):
            acceso, corrección y eliminación. Las abiertas van primero, por
            fecha límite.{" "}
            <Link to={RUTA_CONSENTIMIENTO}>
              Ver el aviso y el consentimiento de datos
            </Link>
          </p>
        </div>
      </div>

      {/* Sin región viva: el resultado de cada filtro ya lo anuncia
          `AnuncioDeResultados`; estos totales no dependen de los filtros. */}
      <p className="pv-totales mb-0">
        {totales ? (
          <>
            <span>En total:</span>{" "}
            <span>
              <span className="mz-strong">{totales.abiertas}</span>{" "}
              {totales.abiertas === 1 ? "abierta" : "abiertas"}
            </span>
            <span aria-hidden="true"> · </span>
            <span className={totales.vencidas > 0 ? "pv-totales--mal" : ""}>
              {totales.vencidas > 0 && <Icon name="exclamation-octagon" />}{" "}
              <span className="mz-strong">{totales.vencidas}</span>{" "}
              {totales.vencidas === 1 ? "vencida" : "vencidas"}
            </span>
          </>
        ) : (
          ""
        )}
      </p>

      <form
        className="mz-filter-bar pv-filtros"
        role="search"
        aria-label="Filtrar solicitudes"
        onSubmit={(e) => {
          e.preventDefault();
          busqueda.buscarYa();
        }}
      >
        <label className="mz-fb-search" htmlFor="pv-buscar">
          <Icon name="search" />
          <span className="visually-hidden">Buscar solicitudes</span>
          <input
            id="pv-buscar"
            type="search"
            placeholder="Número, nombre, usuario o correo del titular"
            ref={campoBusqueda}
            {...busqueda.propsCampo}
          />
        </label>
        <div className="mz-inline-field">
          <label htmlFor="pv-estado">Estado</label>
          <select
            id="pv-estado"
            className="form-select form-select-sm"
            value={filtros.estado}
            onChange={(e) =>
              listado.actualizarFiltros({ estado: e.target.value })
            }
          >
            <option value="">Todos</option>
            {ESTADOS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.texto}
              </option>
            ))}
          </select>
        </div>
        <div className="mz-inline-field">
          <label htmlFor="pv-tipo">Tipo</label>
          <select
            id="pv-tipo"
            className="form-select form-select-sm"
            value={filtros.tipo}
            onChange={(e) =>
              listado.actualizarFiltros({ tipo: e.target.value })
            }
          >
            <option value="">Todos</option>
            {TIPOS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.texto}
              </option>
            ))}
          </select>
        </div>
        <label className="pv-casilla">
          <input
            type="checkbox"
            className="form-check-input"
            checked={filtros.vencidas === "1"}
            onChange={(e) =>
              listado.actualizarFiltros({
                vencidas: e.target.checked ? "1" : "",
              })
            }
          />
          Solo vencidas
        </label>
      </form>
      <AnuncioDeResultados
        termino={filtros.q}
        total={listado.total}
        sustantivo={["solicitud", "solicitudes"]}
        cargando={listado.isLoading}
      />

      {enTarjetas ? (
        <div className="pv-tarjetas" aria-busy={listado.isLoading}>
          <EstadoDeCarga {...estado} />
          {!listado.error && solicitudes.length > 0 && (
            <ul className="mz-cards-lista" aria-label="Solicitudes">
              {solicitudes.map((s) => (
                <li key={s.id} className="mz-card-row pv-fila-tarjeta">
                  <div className="mz-row-between">
                    <EnlaceSolicitud solicitud={s} volverA={volverA} />
                    <PildoraEstado estado={s.estado} texto={s.estado_label} />
                  </div>
                  <p className="mb-0 pv-titular">{s.titular?.nombre}</p>
                  <div className="mz-pill-row">
                    <PildoraTipo tipo={s.tipo} texto={s.tipo_label} />
                  </div>
                  <p className="mz-small mb-0">
                    <Plazo solicitud={s} />
                  </p>
                  <p className="mz-small mz-faint mb-0">
                    Recibida el {fecha(s.creada_en)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="mz-table-wrap" aria-busy={listado.isLoading}>
          <table className="mz-table pv-tabla">
            <thead>
              <tr>
                <th scope="col">Número</th>
                <th scope="col">Titular</th>
                <th scope="col">Tipo</th>
                <th scope="col">Estado</th>
                <th scope="col">Fecha límite</th>
                <th scope="col">Recibida</th>
              </tr>
            </thead>
            <tbody>
              {solicitudes.map((s) => (
                <tr key={s.id}>
                  <td>
                    <EnlaceSolicitud solicitud={s} volverA={volverA} />
                  </td>
                  <td>
                    <span className="pv-titular">{s.titular?.nombre}</span>
                    <div className="mz-small mz-faint pv-titular">
                      {s.titular?.correo || s.titular?.usuario}
                    </div>
                  </td>
                  <td>
                    <PildoraTipo tipo={s.tipo} texto={s.tipo_label} />
                  </td>
                  <td>
                    <PildoraEstado estado={s.estado} texto={s.estado_label} />
                  </td>
                  <td>
                    <Plazo solicitud={s} compacto />
                  </td>
                  <td>{fecha(s.creada_en)}</td>
                </tr>
              ))}
              <FilaDeEstado columnas={6} {...estado} />
            </tbody>
          </table>
        </div>
      )}

      <Paginacion
        total={listado.total}
        pagina={listado.pagina}
        hasNext={listado.hasNext}
        hasPrevious={listado.hasPrevious}
        onCambiarPagina={listado.setPagina}
        etiqueta={listado.total === 1 ? "solicitud" : "solicitudes"}
      />
    </div>
  );
}

function EnlaceSolicitud({ solicitud, volverA }) {
  return (
    <Link
      id={idFilaSolicitud(solicitud.id)}
      to={rutaDeSolicitud(solicitud.id)}
      state={{ volverA }}
      className="pv-numero mz-mono"
    >
      {solicitud.numero}
      <span className="visually-hidden"> de {solicitud.titular?.nombre}</span>
    </Link>
  );
}
