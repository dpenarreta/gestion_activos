/*
 * Proyectos (`ProjectsModule` de Nexo): iniciativas transversales con fases,
 * participantes y seguimiento propio. El listado es lo que el servidor deja
 * ver (suyos, de su equipo según el organigrama o, a quien administra, todos
 * los de la empresa). Crear y la papelera: `can_create` de `projects/me/`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  errorDeProyectos,
  proyectosGhService,
} from "../../../api/proyectosGhService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { RUTA_GESTION_HUMANA } from "../../../modulos/permisosGestionHumana";
import { Aviso } from "../comunes";
import { Encabezado } from "../Tareas/ContextoTareas";
import { PillPrioridad } from "../Tareas/Indicadores";
import { fechaCorta, horas } from "../Tareas/tareasComunes";
import { ConAccesoProyectos, useProyectos } from "./ContextoProyectos";
import { FormularioProyecto } from "./FormularioProyecto";
import { Papelera } from "./Papelera";
import {
  ESTADO_PROYECTO,
  ESTADOS_PROYECTO,
  TONO_ESTADO_PROYECTO,
  nombreDe,
  porcentajeEjecutado,
} from "./proyectosComunes";

export const RUTA_PROYECTOS = `${RUTA_GESTION_HUMANA}/proyectos`;

/** El id del enlace de una tarjeta (recibe el foco al volver del detalle). */
export const idTarjeta = (id) => `gp-proyecto-${id}`;

export function Proyectos() {
  return (
    <ConAccesoProyectos titulo="Proyectos">
      <PantallaProyectos />
    </ConAccesoProyectos>
  );
}

export function PillEstadoProyecto({ estado }) {
  return (
    <span
      className={`mz-pill ${TONO_ESTADO_PROYECTO[estado] ?? "mz-pill--neutral"}`}
    >
      {ESTADO_PROYECTO[estado] ?? estado}
    </span>
  );
}

function TarjetaProyecto({ proyecto }) {
  const pct = porcentajeEjecutado(proyecto);
  return (
    <li className="gp-tarjeta">
      <div className="gp-tarjeta__cabeza">
        <h3 className="gp-tarjeta__titulo">
          <Link
            id={idTarjeta(proyecto.id)}
            to={`${RUTA_PROYECTOS}/${proyecto.id}`}
            className="gp-tarjeta__enlace"
          >
            {proyecto.name}
          </Link>
        </h3>
        <PillEstadoProyecto estado={proyecto.status} />
      </div>
      {proyecto.description && (
        <p className="mz-small mz-faint gp-dos-lineas mb-0">
          {proyecto.description}
        </p>
      )}
      <div className="gp-marcas">
        {proyecto.area && (
          <span className="mz-pill mz-pill--neutral">{proyecto.area}</span>
        )}
        <PillPrioridad prioridad={proyecto.priority} />
        {(proyecto.tags ?? []).slice(0, 2).map((t) => (
          <span key={t} className="mz-pill mz-pill--info">
            #{t}
          </span>
        ))}
      </div>
      <div>
        <p className="mz-small d-flex justify-content-between mb-1">
          <span className="mz-faint">Tiempo usado</span>
          <span className="mz-strong">
            {horas(proyecto.real_hours)} de {horas(proyecto.target_time_hours)}
          </span>
        </p>
        <span className="gh-avance d-block" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="visually-hidden">{pct} % del tiempo objetivo</span>
      </div>
      <p className="mz-small mb-0 d-flex flex-wrap justify-content-between gap-2">
        <span>
          <span className="mz-faint">Responsable: </span>
          {nombreDe(proyecto.responsible)}
        </span>
        <span>
          <span className="mz-faint">Meta: </span>
          {fechaCorta(proyecto.target_date)}
        </span>
      </p>
      <p className="mz-small mz-faint mb-0">
        {proyecto.participant_count ?? 0}{" "}
        {proyecto.participant_count === 1 ? "participante" : "participantes"} ·{" "}
        {proyecto.phase_count ?? 0}{" "}
        {proyecto.phase_count === 1 ? "fase" : "fases"}
      </p>
    </li>
  );
}

function PantallaProyectos() {
  const { usuarioId, puedeCrear } = useProyectos();
  const navigate = useNavigate();
  const location = useLocation();
  const [proyectos, setProyectos] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(location.state?.aviso ?? null);
  const [creando, setCreando] = useState(false);
  const [papelera, setPapelera] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [estado, setEstado] = useState("");
  const enfocado = useRef(false);

  const cargar = useCallback(() => {
    setError(null);
    proyectosGhService
      .listar()
      .then((lista) => setProyectos(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setError(
          errorDeProyectos(err, "No se pudieron cargar los proyectos.").mensaje,
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // De vuelta del detalle, el foco regresa a la tarjeta que se abrió.
  useEffect(() => {
    const desde = location.state?.desde;
    if (!proyectos || !desde || enfocado.current) return;
    enfocado.current = true;
    document.getElementById(idTarjeta(desde))?.focus();
  }, [proyectos, location.state]);

  const visibles = useMemo(() => {
    const texto = buscar.trim().toLowerCase();
    return (proyectos ?? []).filter(
      (p) =>
        (!estado || p.status === estado) &&
        (!texto ||
          p.name.toLowerCase().includes(texto) ||
          (p.area ?? "").toLowerCase().includes(texto) ||
          (p.tags ?? []).some((t) => t.toLowerCase().includes(texto))),
    );
  }, [proyectos, buscar, estado]);

  const hayFiltros = Boolean(buscar.trim() || estado);

  return (
    <div className="gh-page">
      <Encabezado
        titulo="Proyectos"
        descripcion="Iniciativas transversales con fases, participantes y seguimiento propio."
      >
        {puedeCrear && (
          <>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setPapelera(true)}
            >
              <Icon name="trash" /> Papelera
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setCreando(true)}
            >
              <Icon name="plus-lg" /> Nuevo proyecto
            </button>
          </>
        )}
      </Encabezado>

      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />

      {proyectos?.length > 0 && (
        <form
          className="mz-filter-bar"
          role="search"
          onSubmit={(e) => e.preventDefault()}
        >
          <label className="mz-fb-search">
            <Icon name="search" />
            <span className="visually-hidden">Buscar proyectos</span>
            <input
              type="search"
              placeholder="Buscar por nombre, área o etiqueta"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
            />
          </label>
          <select
            className="form-select form-select-sm"
            aria-label="Filtrar por estado"
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
          >
            <option value="">Todos los estados</option>
            {ESTADOS_PROYECTO.map((e) => (
              <option key={e} value={e}>
                {ESTADO_PROYECTO[e]}
              </option>
            ))}
          </select>
        </form>
      )}

      <EstadoDeCarga
        cargando={proyectos === null && !error}
        error={error}
        onReintentar={cargar}
        vacio={proyectos !== null && visibles.length === 0}
        hayFiltros={hayFiltros && proyectos?.length > 0}
        onLimpiarFiltros={() => {
          setBuscar("");
          setEstado("");
        }}
        textoVacio={
          puedeCrear
            ? "Todavía no hay proyectos. Cree el primero para empezar a darle seguimiento."
            : "No participa en ningún proyecto todavía. Cuando lo agreguen a uno, aparecerá aquí."
        }
        accionVacio={
          puedeCrear ? (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setCreando(true)}
            >
              Crear un proyecto
            </button>
          ) : null
        }
      />

      {visibles.length > 0 && (
        <>
          <p className="mz-small mz-faint mb-0" role="status">
            {visibles.length} {visibles.length === 1 ? "proyecto" : "proyectos"}
          </p>
          <ul className="gp-tarjetas">
            {visibles.map((p) => (
              <TarjetaProyecto key={p.id} proyecto={p} />
            ))}
          </ul>
        </>
      )}

      {creando && (
        <FormularioProyecto
          usuarioId={usuarioId}
          onCerrar={() => setCreando(false)}
          onGuardado={(proyecto) => {
            setCreando(false);
            navigate(`${RUTA_PROYECTOS}/${proyecto.id}`, {
              state: {
                aviso: { texto: `Proyecto «${proyecto.name}» creado.` },
              },
            });
          }}
        />
      )}
      {papelera && (
        <Papelera onCerrar={() => setPapelera(false)} onRestaurado={cargar} />
      )}
    </div>
  );
}
