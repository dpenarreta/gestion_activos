import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { getEmpresaActiva } from "../../api/client";
import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { Paginacion } from "../../components/common/Paginacion/Paginacion";
import { useUltimaPeticion } from "../../hooks/useUltimaPeticion";
import { mensajeDeError } from "../../utils/errores";
import {
  ICONO_DEL_GRUPO,
  PILDORA_DEL_GRUPO,
  PRIORIDADES,
  fechaCorta,
  textoDeDias,
} from "./formatoMatriz";
import { BotonesExportar } from "./BotonesExportar";
import { ObligacionFormModal } from "./ObligacionFormModal";
import { PeriodoPanel } from "./PeriodoPanel";
import { useOpcionesMatriz } from "./useOpcionesMatriz";
import { usePanelDePeriodo } from "./usePanelDePeriodo";
import "./Matriz.css";

/** Los filtros que viajan a la API, en el mismo nombre de la dirección. */
const FILTROS = [
  "q",
  "area",
  "entity",
  "responsible",
  "priority",
  "status",
  "stage",
];

const COLUMNAS = [
  { clave: "code", titulo: "Código" },
  { clave: "name", titulo: "Obligación" },
  { clave: "area", titulo: "Área" },
  { clave: "entity", titulo: "Entidad" },
  { clave: "responsible", titulo: "Responsable" },
  { clave: "priority", titulo: "Prioridad" },
  { clave: "due", titulo: "Vence" },
  { clave: null, titulo: "Días" },
  { clave: "urgency", titulo: "Estado" },
];

const AGRUPACIONES = [
  ["", "Sin agrupar"],
  ["area", "Por área"],
  ["entidad", "Por entidad"],
];

function Estado({ estado }) {
  return (
    <span className={`mz-pill ${PILDORA_DEL_GRUPO[estado.group]}`}>
      <Icon name={ICONO_DEL_GRUPO[estado.group]} /> {estado.label}
    </span>
  );
}

/**
 * La matriz de obligaciones de la empresa activa (§15.3): la lista operativa
 * de períodos. Los filtros y el orden viven en la dirección, así que una vista
 * filtrada se comparte con un enlace y el «atrás» del navegador la recupera.
 * Por defecto, por urgencia: primero lo incumplido.
 */
export function MatrizObligacionesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const panel = usePanelDePeriodo();
  const opciones = useOpcionesMatriz();
  const [busqueda, setBusqueda] = useState(params.get("q") ?? "");
  const [agrupar, setAgrupar] = useState("");
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [empresa, setEmpresa] = useState(null);
  const [creando, setCreando] = useState(false);

  const orden = params.get("sort") || "urgency";
  const filtros = useMemo(
    () =>
      Object.fromEntries(
        FILTROS.map((clave) => [clave, params.get(clave) ?? ""]).filter(
          ([, v]) => v,
        ),
      ),
    [params],
  );
  const hayFiltros = Object.keys(filtros).length > 0;

  useEffect(() => {
    matrizService
      .misEmpresas()
      .then(({ empresas }) => {
        const activa = String(getEmpresaActiva() ?? "");
        setEmpresa(
          empresas.find((e) => String(e.id) === activa) ?? empresas[0] ?? null,
        );
      })
      .catch(() => setEmpresa(null));
  }, []);

  const nuevaPeticion = useUltimaPeticion();
  const cargar = useCallback(() => {
    const vigente = nuevaPeticion();
    matrizService
      .periodos({ ...filtros, sort: orden, page: pagina })
      .then((respuesta) => {
        if (!vigente()) return;
        setDatos(respuesta);
        setError(null);
      })
      .catch(
        (err) =>
          vigente() &&
          setError(mensajeDeError(err, "No se pudo cargar la matriz.")),
      );
  }, [filtros, orden, pagina, nuevaPeticion]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // La búsqueda global de la barra superior llega por `?q=`.
  useEffect(() => {
    setBusqueda(params.get("q") ?? "");
  }, [params]);

  function fijarParametro(clave, valor) {
    const siguientes = new URLSearchParams(params);
    if (valor) siguientes.set(clave, valor);
    else siguientes.delete(clave);
    setParams(siguientes);
    setPagina(1);
  }

  function ordenarPor(clave) {
    fijarParametro("sort", orden === clave ? `-${clave}` : clave);
  }

  function limpiar() {
    const siguientes = new URLSearchParams();
    if (panel.abierto) siguientes.set("periodo", String(panel.abierto));
    setParams(siguientes);
    setBusqueda("");
    setPagina(1);
  }

  const filas = useMemo(() => datos?.results ?? [], [datos]);
  const grupos = useMemo(() => {
    if (!agrupar) return [{ titulo: null, filas }];
    const mapa = new Map();
    for (const fila of filas) {
      const clave = agrupar === "area" ? fila.area : fila.entidad;
      if (!mapa.has(clave)) mapa.set(clave, []);
      mapa.get(clave).push(fila);
    }
    return [...mapa.entries()].map(([titulo, lista]) => ({
      titulo,
      filas: lista,
    }));
  }, [filas, agrupar]);

  const zona = empresa?.zona_horaria;
  const puedeCrear = empresa?.capacidades.includes("matriz.crear");
  const puedeExportar = empresa?.capacidades.includes("matriz.exportar");

  return (
    <div className="matriz-page">
      <div className="mz-view-head">
        <div>
          <h2>Matriz de obligaciones</h2>
          <p className="mz-desc">
            Cada período con su responsable, su vencimiento y su estado. Por
            defecto, lo más urgente arriba.
          </p>
        </div>
        {(puedeCrear || puedeExportar) && (
          <div className="mz-view-actions">
            {puedeExportar && (
              <BotonesExportar
                recurso="periodos"
                params={{ ...filtros, sort: orden }}
                nombre="matriz"
              />
            )}
            {puedeCrear && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setCreando(true)}
              >
                <Icon name="plus-lg" /> Nueva obligación
              </button>
            )}
          </div>
        )}
      </div>

      <form
        className="mz-filter-bar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          fijarParametro("q", busqueda.trim());
        }}
      >
        <label className="mz-fb-search">
          <Icon name="search" />
          <span className="visually-hidden">Buscar en la matriz</span>
          <input
            type="search"
            placeholder="Obligación, código, responsable, entidad…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </label>
        <select
          className="form-select form-select-sm"
          aria-label="Filtrar por área"
          value={filtros.area ?? ""}
          onChange={(e) => fijarParametro("area", e.target.value)}
        >
          <option value="">Todas las áreas</option>
          {opciones.areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm"
          aria-label="Filtrar por entidad"
          value={filtros.entity ?? ""}
          onChange={(e) => fijarParametro("entity", e.target.value)}
        >
          <option value="">Todas las entidades</option>
          {opciones.entidades.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm"
          aria-label="Filtrar por responsable"
          value={filtros.responsible ?? ""}
          onChange={(e) => fijarParametro("responsible", e.target.value)}
        >
          <option value="">Todos los responsables</option>
          {opciones.personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm"
          aria-label="Filtrar por prioridad"
          value={filtros.priority ?? ""}
          onChange={(e) => fijarParametro("priority", e.target.value)}
        >
          <option value="">Toda prioridad</option>
          {opciones.prioridades.map((p) => (
            <option key={p.valor} value={p.valor}>
              {p.nombre}
            </option>
          ))}
        </select>
        <div className="mz-chips" role="group" aria-label="Filtrar por estado">
          {[
            ["", "Todos"],
            ["incumplido", "Incumplidos"],
            ["en_progreso", "En progreso"],
            ["finalizado", "Finalizados"],
          ].map(([valor, nombre]) => (
            <button
              key={nombre}
              type="button"
              className={(filtros.status ?? "") === valor ? "is-on" : undefined}
              aria-pressed={(filtros.status ?? "") === valor}
              onClick={() => fijarParametro("status", valor)}
            >
              {nombre}
            </button>
          ))}
        </div>
        <select
          className="form-select form-select-sm"
          aria-label="Agrupar"
          value={agrupar}
          onChange={(e) => setAgrupar(e.target.value)}
        >
          {AGRUPACIONES.map(([valor, nombre]) => (
            <option key={valor} value={valor}>
              {nombre}
            </option>
          ))}
        </select>
        {hayFiltros && (
          <button
            type="button"
            className="btn btn-link btn-sm"
            onClick={limpiar}
          >
            Limpiar filtros
          </button>
        )}
      </form>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      <div className="mz-table-wrap mz-table-wrap--con-tarjetas">
        <table className="mz-table mz-table--ancha mz-table--clicable">
          <thead>
            <tr>
              {COLUMNAS.map((col) => (
                <th
                  key={col.titulo}
                  className={col.clave ? "is-sortable" : undefined}
                  aria-sort={
                    orden === col.clave
                      ? "ascending"
                      : orden === `-${col.clave}`
                        ? "descending"
                        : undefined
                  }
                >
                  {col.clave ? (
                    <button
                      type="button"
                      className="matriz-orden"
                      onClick={() => ordenarPor(col.clave)}
                    >
                      {col.titulo}{" "}
                      <Icon
                        name={
                          orden === col.clave
                            ? "sort-down"
                            : orden === `-${col.clave}`
                              ? "sort-up"
                              : "arrow-down-up"
                        }
                      />
                    </button>
                  ) : (
                    col.titulo
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {datos === null && !error && (
              <tr className="mz-empty-row">
                <td colSpan={COLUMNAS.length}>Cargando…</td>
              </tr>
            )}
            {datos && filas.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={COLUMNAS.length}>
                  {hayFiltros
                    ? "Ningún período coincide con los filtros."
                    : "Todavía no hay obligaciones registradas."}
                </td>
              </tr>
            )}
            {grupos.map((grupo) => [
              grupo.titulo && (
                <tr key={`g-${grupo.titulo}`} className="mz-group-row">
                  <td colSpan={COLUMNAS.length}>
                    {grupo.titulo} · {grupo.filas.length}
                  </td>
                </tr>
              ),
              ...grupo.filas.map((fila) => {
                const dias = textoDeDias(fila.estado);
                return (
                  <tr
                    key={fila.id}
                    tabIndex={0}
                    onClick={() => panel.abrir(fila.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") panel.abrir(fila.id);
                    }}
                    aria-label={`Abrir ${fila.codigo} ${fila.obligacion.nombre}`}
                  >
                    <td className="mz-code">{fila.codigo}</td>
                    <td>
                      <span className="mz-strong d-block">
                        {fila.obligacion.nombre}
                      </span>
                      <span className="mz-small mz-faint">{fila.etiqueta}</span>
                    </td>
                    <td>{fila.area}</td>
                    <td>{fila.entidad}</td>
                    <td>{fila.responsable?.nombre}</td>
                    <td className={`mz-prio--${fila.prioridad}`}>
                      {PRIORIDADES[fila.prioridad]}
                    </td>
                    <td className="mz-mono">
                      {fechaCorta(fila.vence_en, zona)}
                    </td>
                    <td className={dias.clase}>{dias.texto}</td>
                    <td>
                      <Estado estado={fila.estado} />
                    </td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
      </div>

      <div className="mz-cards">
        {filas.map((fila) => (
          <button
            key={fila.id}
            type="button"
            className="mz-card-row"
            onClick={() => panel.abrir(fila.id)}
          >
            <div className="mz-row-between">
              <strong>{fila.obligacion.nombre}</strong>
              <Estado estado={fila.estado} />
            </div>
            <div className="mz-card-meta">
              <span className="mz-code">{fila.codigo}</span>
              <span>{fila.area}</span>
              <span>{fila.responsable?.nombre}</span>
              <span>{fechaCorta(fila.vence_en, zona)}</span>
              <span className={textoDeDias(fila.estado).clase}>
                {textoDeDias(fila.estado).texto}
              </span>
            </div>
          </button>
        ))}
      </div>

      {datos && (
        <Paginacion
          total={datos.count}
          pagina={pagina}
          hasNext={Boolean(datos.next)}
          hasPrevious={Boolean(datos.previous)}
          onCambiarPagina={setPagina}
          etiqueta="períodos"
        />
      )}

      {panel.abierto && (
        <PeriodoPanel
          id={panel.abierto}
          onCerrar={panel.cerrar}
          onCambio={cargar}
        />
      )}
      {creando && (
        <ObligacionFormModal
          onCerrar={() => setCreando(false)}
          onCreada={(periodo) => {
            setCreando(false);
            cargar();
            navigate(`/admin/matriz/obligaciones?periodo=${periodo.id}`);
          }}
        />
      )}
    </div>
  );
}
