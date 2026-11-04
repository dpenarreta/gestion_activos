/*
 * Ingresos y salidas: consulta consolidada (solo lectura) de los movimientos
 * que ya registró el módulo: altas en la base y reingresos (Inactivo →
 * Activo), y salidas (cambios a Inactivo). Tiene sus propios permisos
 * (`novedades.ingresos_ver`, `novedades.salidas_ver`), independientes del
 * acceso al resto del módulo: por eso no usa el marco de `novedades/me/`.
 * Filtrar, paginar o exportar nunca crea movimientos ni envía correos.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { errorDeNovedades, novedadesService } from "../../api/novedadesService";
import {
  EstadoDeCarga,
  FilaDeEstado,
} from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
import { useVistaDeTarjetas } from "../../hooks/useMediaQuery";
import { EstadoColaborador, fecha, fechaHora } from "./comunes";
import { Encabezado } from "./ContextoNovedades";
import "./GestionHumana.css";

const FILTROS = {
  q: "",
  date_from: "",
  date_to: "",
  cargo: "",
  supervisor: "",
  status: "",
  order: "desc",
};

export function IngresosSalidas() {
  const [acceso, setAcceso] = useState(null);
  const [error, setError] = useState(null);
  const [opciones, setOpciones] = useState(null);
  const [tipo, setTipo] = useState(null);

  const cargar = useCallback(() => {
    setError(null);
    novedadesService
      .accesoMovimientos()
      .then((datos) => {
        setAcceso(datos);
        setTipo(
          (actual) =>
            actual ??
            (datos.entries ? "entries" : datos.exits ? "exits" : null),
        );
        if (datos.entries || datos.exits) {
          novedadesService
            .opcionesMovimientos()
            .then(setOpciones)
            .catch(() =>
              setOpciones({ supervisors: [], cargos: [], statuses: [] }),
            );
        }
      })
      .catch((err) =>
        setError(
          errorDeNovedades(err, "No se pudo cargar la consulta.").mensaje,
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const pestanas = [
    acceso?.entries && {
      id: "entries",
      etiqueta: "Ingresos",
      icono: "box-arrow-in-right",
    },
    acceso?.exits && {
      id: "exits",
      etiqueta: "Salidas",
      icono: "box-arrow-right",
    },
  ].filter(Boolean);

  return (
    <div className="gh-page">
      <Encabezado
        titulo="Ingresos y salidas"
        descripcion="Consulta consolidada de los movimientos de colaboradores registrados en el sistema."
      />
      {!acceso ? (
        <EstadoDeCarga cargando={!error} error={error} onReintentar={cargar} />
      ) : pestanas.length === 0 ? (
        <div className="mz-alert mz-alert--warn" role="alert">
          <Icon name="shield-lock" />
          <span>
            No tiene acceso a Ingresos ni a Salidas. Si lo necesita, solicítelo
            al Administrador del módulo.
          </span>
        </div>
      ) : (
        <>
          {pestanas.length > 1 && (
            <Pestanas
              etiqueta="Movimientos"
              idBase="gh-mov"
              valor={tipo}
              onCambio={setTipo}
              opciones={pestanas}
            />
          )}
          <PanelDePestana
            idBase="gh-mov"
            valor={tipo}
            sinPestanas={pestanas.length < 2}
          >
            <Movimientos key={tipo} tipo={tipo} opciones={opciones} />
          </PanelDePestana>
        </>
      )}
    </div>
  );
}

function Movimientos({ tipo, opciones }) {
  const [filtros, setFiltros] = useState(FILTROS);
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(1);
  const [tamano, setTamano] = useState(25);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [exportando, setExportando] = useState(false);
  const enTarjetas = useVistaDeTarjetas();
  const esIngreso = tipo === "entries";

  // La búsqueda por texto espera a que se deje de escribir.
  useEffect(() => {
    const reloj = setTimeout(() => {
      setFiltros((f) =>
        f.q === busqueda.trim() ? f : { ...f, q: busqueda.trim() },
      );
      setPagina(1);
    }, 350);
    return () => clearTimeout(reloj);
  }, [busqueda]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setDatos(
        await novedadesService.movimientos(tipo, {
          ...filtros,
          page: pagina,
          page_size: tamano,
        }),
      );
    } catch (err) {
      setError(errorDeNovedades(err, "No se pudo cargar la consulta.").mensaje);
    } finally {
      setCargando(false);
    }
  }, [tipo, filtros, pagina, tamano]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const poner = (cambios) => {
    setFiltros((f) => ({ ...f, ...cambios }));
    setPagina(1);
  };
  const limpiar = () => {
    setBusqueda("");
    setFiltros({ ...FILTROS, order: filtros.order });
    setPagina(1);
  };

  async function exportar() {
    setExportando(true);
    try {
      await novedadesService.exportarMovimientos(tipo, filtros);
    } catch (err) {
      setError(errorDeNovedades(err, "No se pudo exportar.").mensaje);
    } finally {
      setExportando(false);
    }
  }

  const activos = useMemo(() => {
    const supervisor = opciones?.supervisors.find(
      (s) => String(s.id) === filtros.supervisor,
    )?.name;
    const estado = opciones?.statuses.find(
      (s) => s.value === filtros.status,
    )?.label;
    return [
      filtros.q && `Búsqueda: «${filtros.q}»`,
      filtros.date_from && `Desde ${fecha(filtros.date_from)}`,
      filtros.date_to && `Hasta ${fecha(filtros.date_to)}`,
      filtros.cargo && `Cargo: ${filtros.cargo}`,
      filtros.supervisor && `Supervisor: ${supervisor ?? filtros.supervisor}`,
      filtros.status && `Estado actual: ${estado ?? filtros.status}`,
    ].filter(Boolean);
  }, [filtros, opciones]);

  const resultados = datos?.results ?? [];
  const paginas = datos
    ? Math.max(1, Math.ceil(datos.count / datos.page_size))
    : 1;
  const estadoDeCarga = {
    cargando: cargando && !datos,
    error: !datos ? error : null,
    onReintentar: cargar,
    vacio: datos !== null && resultados.length === 0,
    textoVacio: esIngreso
      ? "Todavía no hay ingresos registrados."
      : "Todavía no hay salidas registradas.",
    hayFiltros: activos.length > 0,
    onLimpiarFiltros: limpiar,
  };
  const columnas = esIngreso ? 10 : 9;

  return (
    <div className="gh-page">
      <p className="mz-small mz-faint mb-0">
        {esIngreso
          ? "Ingresos = altas de colaboradores en la base (formulario o importación) y reingresos (de Inactivo a Activo). La fecha es la del registro en el sistema, no una fecha formal de ingreso laboral."
          : "Salidas = cambios de estado a Inactivo. La fecha es la del cambio en el sistema y no acredita por sí misma una desvinculación laboral formal."}
      </p>
      {datos && (
        <div
          className="mz-kpi-grid"
          aria-label="Totales con los filtros aplicados"
        >
          <div className="mz-kpi">
            <div className="mz-kpi-value">{datos.counters.movements}</div>
            <div className="mz-kpi-label">
              {esIngreso ? "Ingresos (movimientos)" : "Salidas (movimientos)"}
            </div>
          </div>
          <div className="mz-kpi">
            <div className="mz-kpi-value">{datos.counters.people}</div>
            <div className="mz-kpi-label">Personas distintas</div>
          </div>
          {esIngreso && (
            <>
              <div className="mz-kpi">
                <div className="mz-kpi-value">{datos.counters.altas ?? 0}</div>
                <div className="mz-kpi-label">Altas en la base</div>
              </div>
              <div className="mz-kpi">
                <div className="mz-kpi-value">
                  {datos.counters.reingresos ?? 0}
                </div>
                <div className="mz-kpi-label">Reingresos</div>
              </div>
            </>
          )}
        </div>
      )}
      <div className="mz-filter-bar" role="group" aria-label="Filtros">
        <div className="mz-fb-search">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Buscar por cédula o nombre"
            placeholder="Buscar cédula o nombre"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <div className="mz-inline-field">
          <label htmlFor={`gh-mov-${tipo}-desde`}>Desde</label>
          <input
            id={`gh-mov-${tipo}-desde`}
            type="date"
            className="form-control form-control-sm"
            value={filtros.date_from}
            onChange={(e) => poner({ date_from: e.target.value })}
          />
        </div>
        <div className="mz-inline-field">
          <label htmlFor={`gh-mov-${tipo}-hasta`}>Hasta</label>
          <input
            id={`gh-mov-${tipo}-hasta`}
            type="date"
            className="form-control form-control-sm"
            value={filtros.date_to}
            onChange={(e) => poner({ date_to: e.target.value })}
          />
        </div>
        <div className="mz-inline-field">
          <label htmlFor={`gh-mov-${tipo}-orden`}>Orden</label>
          <select
            id={`gh-mov-${tipo}-orden`}
            className="form-select form-select-sm"
            value={filtros.order}
            onChange={(e) => poner({ order: e.target.value })}
          >
            <option value="desc">Más recientes primero</option>
            <option value="asc">Más antiguos primero</option>
          </select>
        </div>
        <div className="mz-inline-field">
          <label htmlFor={`gh-mov-${tipo}-cargo`}>Cargo</label>
          <select
            id={`gh-mov-${tipo}-cargo`}
            className="form-select form-select-sm"
            value={filtros.cargo}
            onChange={(e) => poner({ cargo: e.target.value })}
          >
            <option value="">Todos</option>
            {opciones?.cargos.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="mz-inline-field">
          <label htmlFor={`gh-mov-${tipo}-supervisor`}>Supervisor</label>
          <select
            id={`gh-mov-${tipo}-supervisor`}
            className="form-select form-select-sm"
            value={filtros.supervisor}
            onChange={(e) => poner({ supervisor: e.target.value })}
          >
            <option value="">Todos</option>
            {opciones?.supervisors.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mz-inline-field">
          <label htmlFor={`gh-mov-${tipo}-estado`}>Estado actual</label>
          <select
            id={`gh-mov-${tipo}-estado`}
            className="form-select form-select-sm"
            value={filtros.status}
            onChange={(e) => poner({ status: e.target.value })}
          >
            <option value="">Todos</option>
            {opciones?.statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          disabled={!datos || datos.count === 0 || exportando}
          onClick={exportar}
        >
          <Icon name="file-earmark-excel" />{" "}
          {exportando ? "Exportando…" : "Exportar a Excel"}
        </button>
      </div>
      <div className="gh-barra" aria-live="polite">
        <span className="mz-small">
          {datos ? `${datos.count} resultado(s)` : "Cargando…"}
          {activos.length > 0 && ` · ${activos.join(" · ")}`}
        </span>
        {activos.length > 0 && (
          <button
            type="button"
            className="btn btn-link btn-sm p-0"
            onClick={limpiar}
          >
            Limpiar filtros
          </button>
        )}
      </div>
      {datos && error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          <span>{error}</span>
        </div>
      )}

      {!enTarjetas && (
        <div className="mz-table-wrap">
          <table className="mz-table mz-table--ancha">
            <caption className="visually-hidden">
              {esIngreso ? "Ingresos" : "Salidas"}
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  {esIngreso
                    ? "Fecha de registro"
                    : "Fecha del cambio a Inactivo"}
                </th>
                <th scope="col">{esIngreso ? "Tipo" : "Estado anterior"}</th>
                <th scope="col">Cédula</th>
                <th scope="col">Empleado</th>
                <th scope="col">Cargo</th>
                <th scope="col">Área</th>
                <th scope="col">Supervisor responsable</th>
                <th scope="col">Estado actual</th>
                <th scope="col">
                  {esIngreso ? "Registrado por" : "Cambiado por"}
                </th>
                {esIngreso && <th scope="col">Origen</th>}
              </tr>
            </thead>
            <tbody>
              {resultados.map((r) => (
                <tr key={r.id}>
                  <td>
                    {fechaHora(esIngreso ? r.registered_at : r.changed_at)}
                  </td>
                  <td>
                    {esIngreso ? (
                      <span
                        className={`mz-pill ${r.kind === "REINGRESO" ? "mz-pill--info" : "mz-pill--neutral"}`}
                      >
                        {r.kind_label}
                      </span>
                    ) : (
                      r.previous_status_label
                    )}
                  </td>
                  <td className="gh-mono">{r.cedula}</td>
                  <td>{r.full_name}</td>
                  <td>{r.cargo || "—"}</td>
                  <td>{r.area || "—"}</td>
                  <td>{r.supervisor || "—"}</td>
                  <td>
                    <EstadoColaborador estado={r.status} />
                  </td>
                  <td>{(esIngreso ? r.registered_by : r.changed_by) || "—"}</td>
                  {esIngreso && <td className="mz-faint">{r.origin}</td>}
                </tr>
              ))}
              <FilaDeEstado columnas={columnas} {...estadoDeCarga} />
            </tbody>
          </table>
        </div>
      )}
      {enTarjetas && (
        <div className="mz-cards">
          <EstadoDeCarga {...estadoDeCarga} />
          {resultados.length > 0 && (
            <ul
              className="mz-cards-lista"
              aria-label={esIngreso ? "Ingresos" : "Salidas"}
            >
              {resultados.map((r) => (
                <li key={r.id} className="mz-card-row">
                  <div className="mz-row-between">
                    <strong>{r.full_name}</strong>
                    <EstadoColaborador estado={r.status} />
                  </div>
                  <div className="mz-card-meta">
                    <span>
                      {fechaHora(esIngreso ? r.registered_at : r.changed_at)}
                    </span>
                    <span className="gh-mono">{r.cedula}</span>
                    <span>
                      {esIngreso
                        ? r.kind_label
                        : `Antes: ${r.previous_status_label}`}
                    </span>
                    <span>{r.supervisor || "—"}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {datos && datos.count > 0 && (
        <div className="mz-pager">
          <span className="mz-small mz-faint me-auto">
            Página {datos.page} de {paginas}
          </span>
          <label className="visually-hidden" htmlFor={`gh-mov-${tipo}-tamano`}>
            Registros por página
          </label>
          <select
            id={`gh-mov-${tipo}-tamano`}
            className="form-select form-select-sm w-auto"
            value={tamano}
            onChange={(e) => {
              setTamano(Number(e.target.value));
              setPagina(1);
            }}
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n} por página
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={pagina <= 1 || cargando}
            onClick={() => setPagina((p) => p - 1)}
          >
            Anterior
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={pagina >= paginas || cargando}
            onClick={() => setPagina((p) => p + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
