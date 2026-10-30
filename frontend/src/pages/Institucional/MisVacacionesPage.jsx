import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { institucionalService } from "../../api/institucionalService";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { usePermission } from "../../hooks/usePermission";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import "./Institucional.css";

function dias(n) {
  return `${n} ${n === 1 ? "día" : "días"}`;
}

/** «1 día disponible», «3 días disponibles» (antes «1 día pendientes»). */
function diasCon(n, singular, plural) {
  return `${dias(n)} ${n === 1 ? singular : plural}`;
}

const SOLICITAR = "/admin/institucional/permisos?nueva=vacaciones";

/** Los sábados y domingos que lleva el período frente a los que pide la
 * regla, para que no lleguen por sorpresa los «marcados por defecto»
 * (auditoría UX/UI, 30/10/2026). */
function FinesDeSemana({ periodo, regla }) {
  if (!regla?.sabados && !regla?.domingos) return null;
  const completo =
    periodo.sabados >= regla.sabados && periodo.domingos >= regla.domingos;
  return (
    <p className="vacaciones-periodo__fines mb-0">
      <Icon name="calendar-week" /> Fines de semana:{" "}
      <span className="vacaciones-num">
        {Math.min(periodo.sabados, regla.sabados)} de {regla.sabados}
      </span>{" "}
      {regla.sabados === 1 ? "sábado" : "sábados"} ·{" "}
      <span className="vacaciones-num">
        {Math.min(periodo.domingos, regla.domingos)} de {regla.domingos}
      </span>{" "}
      {regla.domingos === 1 ? "domingo" : "domingos"}{" "}
      <span className={`mz-pill ${completo ? "mz-pill--ok" : "mz-pill--warn"}`}>
        {completo ? "Completos" : "Faltan"}
      </span>
    </p>
  );
}

/** Un período: lo que corresponde, lo gozado, lo reservado en aprobación y lo
 * disponible, con la barra de avance y el detalle de lo gozado. */
function Periodo({ periodo, regla, primero }) {
  const base = periodo.correspondientes || 1;
  const gozado = Math.min(100, (periodo.gozados / base) * 100);
  const reservado = Math.min(100 - gozado, (periodo.reservados / base) * 100);
  const tituloId = `periodo-${periodo.id}`;
  return (
    <section className="vacaciones-periodo" aria-labelledby={tituloId}>
      <header className="vacaciones-periodo__cabecera">
        <div>
          <h3 id={tituloId} className="vacaciones-periodo__titulo">
            Período {periodo.nombre}
          </h3>
          <small>
            Del {formatearFecha(periodo.desde)} al{" "}
            {formatearFecha(periodo.hasta)}
          </small>
        </div>
        <div className="vacaciones-periodo__marcas">
          <span className="mz-pill mz-pill--warn">
            {diasCon(periodo.disponibles, "disponible", "disponibles")}
          </span>
          {primero && (
            <span className="mz-pill mz-pill--neutral">
              Se descuenta primero
            </span>
          )}
        </div>
      </header>

      <dl className="vacaciones-periodo__cifras">
        <div>
          <dt>Corresponden</dt>
          <dd>{periodo.correspondientes}</dd>
        </div>
        <div>
          <dt>Gozados</dt>
          <dd>{periodo.gozados}</dd>
        </div>
        <div>
          <dt>En aprobación</dt>
          <dd>{periodo.reservados}</dd>
        </div>
        <div>
          <dt>Disponibles</dt>
          <dd className="vacaciones-periodo__pendientes">
            {periodo.disponibles}
          </dd>
        </div>
      </dl>
      {/* Decorativa: las cifras ya están arriba, en texto. */}
      <div className="vacaciones-barra" aria-hidden="true">
        <span
          className="vacaciones-barra__gozado"
          style={{ width: `${gozado}%` }}
        />
        <span
          className="vacaciones-barra__reservado"
          style={{ width: `${reservado}%` }}
        />
      </div>
      <FinesDeSemana periodo={periodo} regla={regla} />

      {periodo.goces.length > 0 ? (
        <div className="vacaciones-goces-marco">
          <table className="mz-table vacaciones-goces">
            <caption className="visually-hidden">
              Días gozados del período {periodo.nombre}
            </caption>
            <thead>
              <tr>
                <th scope="col">Gozadas del</th>
                <th scope="col">Al</th>
                <th scope="col" className="num">
                  Días
                </th>
                <th scope="col">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {periodo.goces.map((g) => (
                <tr key={g.id}>
                  <td>{formatearFecha(g.desde)}</td>
                  <td>{formatearFecha(g.hasta)}</td>
                  <td className="num">{g.dias}</td>
                  <td className="mz-small">
                    {g.por_defecto && (
                      <span className="mz-pill mz-pill--neutral me-1">
                        Por defecto
                      </span>
                    )}
                    {g.descripcion || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mz-faint mz-small mb-0">
          Todavía no ha gozado días de este período.
        </p>
      )}
      {periodo.nota && (
        <p className="mz-small mz-faint mb-0">
          <Icon name="info-circle" /> {periodo.nota}
        </p>
      )}
    </section>
  );
}

/** Los períodos ya gozados por completo, a la vista si se quieren cuadrar
 * los totales. */
function PeriodoGozado({ periodo }) {
  return (
    <li>
      <strong>Período {periodo.nombre}</strong>{" "}
      <span className="mz-faint">
        ({formatearFecha(periodo.desde)} al {formatearFecha(periodo.hasta)}) ·{" "}
        {diasCon(periodo.gozados, "gozado", "gozados")} de{" "}
        {periodo.correspondientes}
      </span>
    </li>
  );
}

/** El resumen y los períodos de una persona. */
function Vacaciones({ datos, propias }) {
  if (datos.periodos.length === 0) {
    return (
      <div className="mz-card">
        <div className="mz-card-body mz-empty">
          <Icon name="sun" />
          {propias ? (
            <p>
              Aún no tiene períodos de vacaciones registrados. Los carga Talento
              Humano al cumplir cada año de servicio; si cree que falta alguno,
              escríbales.
            </p>
          ) : (
            <p>
              {datos.persona.nombre} no tiene períodos de vacaciones
              registrados.
            </p>
          )}
        </div>
      </div>
    );
  }
  // Los períodos con días, del más antiguo al más nuevo: en ese orden se
  // descuentan al pedir (antes iban al revés).
  const periodos = datos.periodos.filter((p) => p.pendientes > 0);
  const gozados = datos.periodos.filter((p) => p.pendientes === 0);
  const regla = datos.regla;
  const primero = periodos.find((p) => p.disponibles > 0);
  return (
    <>
      <h3 className="visually-hidden">Resumen</h3>
      <div className="vacaciones-resumen">
        <div className="vacaciones-resumen__principal">
          <span>Disponibles para pedir</span>
          <strong>{datos.disponibles}</strong>
          <small>
            {datos.reservados > 0
              ? `${diasCon(datos.reservados, "en aprobación", "en aprobación")} · `
              : ""}
            {datos.periodos_con_pendientes === 0
              ? "No tiene días pendientes."
              : `en ${datos.periodos_con_pendientes} ${
                  datos.periodos_con_pendientes === 1 ? "período" : "períodos"
                }`}
          </small>
        </div>
        <div>
          <span>Gozados</span>
          <strong>{datos.gozados}</strong>
          <small>
            de {datos.correspondientes} que corresponden en{" "}
            {datos.periodos.length}{" "}
            {datos.periodos.length === 1 ? "período" : "períodos"}
          </small>
        </div>
      </div>

      {datos.en_curso?.length > 0 && (
        <section
          className="mz-card vacaciones-en-curso"
          aria-labelledby="vac-en-curso"
        >
          <div className="mz-card-body">
            <h3 id="vac-en-curso" className="vacaciones-seccion">
              Solicitudes de vacaciones en aprobación
            </h3>
            <ul className="mb-0">
              {datos.en_curso.map((s) => (
                <li key={s.id}>
                  {propias ? (
                    <Link
                      to={`/admin/institucional/permisos?solicitud=${s.id}`}
                    >
                      {formatearFecha(s.desde)} al {formatearFecha(s.hasta)}
                    </Link>
                  ) : (
                    <span>
                      {formatearFecha(s.desde)} al {formatearFecha(s.hasta)}
                    </span>
                  )}{" "}
                  <span className="mz-faint">
                    · {dias(s.dias)}
                    {s.paso ? ` · en «${s.paso}»` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {(regla?.sabados > 0 || regla?.domingos > 0) && (
        <details className="vacaciones-regla">
          <summary>¿Por qué se cuentan los fines de semana?</summary>
          <p className="mb-0">
            De cada período deben salir al menos {regla.sabados}{" "}
            {regla.sabados === 1 ? "sábado" : "sábados"} y {regla.domingos}{" "}
            {regla.domingos === 1 ? "domingo" : "domingos"}. Si al completarse
            el período faltan, se marcan por defecto los siguientes a la
            solicitud (aparecen como «Por defecto» en lo gozado). Para elegirlos
            usted, inclúyalos al pedir sus vacaciones.
          </p>
        </details>
      )}

      {periodos.length === 0 ? (
        <div className="mz-card">
          <div className="mz-card-body mz-empty">
            <Icon name="check-circle" />
            <p>No tiene días pendientes: todos sus períodos están gozados.</p>
          </div>
        </div>
      ) : (
        <div className="vacaciones-periodos">
          {periodos.map((p) => (
            <Periodo
              key={p.id}
              periodo={p}
              regla={regla}
              primero={periodos.length > 1 && p === primero}
            />
          ))}
        </div>
      )}
      {gozados.length > 0 && periodos.length > 0 && (
        <details className="vacaciones-regla">
          <summary>
            Ver {gozados.length}{" "}
            {gozados.length === 1 ? "período ya gozado" : "períodos ya gozados"}{" "}
            por completo
          </summary>
          <ul className="mb-0">
            {gozados.map((p) => (
              <PeriodoGozado key={p.id} periodo={p} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/**
 * Institucional → Mis vacaciones: los días disponibles para pedir (los
 * pendientes menos lo que está en aprobación, como al solicitar), y por cada
 * período (año de servicio) cuántos corresponden, cuántos se gozaron y los
 * fines de semana que pide la regla. Quien tiene `vacaciones.ver_todas`
 * puede consultar los de cualquier persona de la empresa.
 */
export function MisVacacionesPage() {
  const verTodas = usePermission("vacaciones.ver_todas");
  const puedeSolicitar = usePermission("licencias.solicitar");
  const [mias, setMias] = useState(null);
  const [personas, setPersonas] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [otra, setOtra] = useState(null);
  const [abriendo, setAbriendo] = useState(null);
  const [error, setError] = useState(null);
  // Cargando y error de cada lista por separado, con «Reintentar»; antes la
  // pantalla quedaba en blanco mientras cargaba y un fallo al buscar
  // personas se veía como «Nadie coincide» (auditoría UX/UI, fase 2,
  // 28/10/2026).
  const [errorMias, setErrorMias] = useState(null);
  const [errorPersonas, setErrorPersonas] = useState(null);
  const titulo = useRef(null);

  const cargarMias = useCallback(() => {
    setErrorMias(null);
    institucionalService
      .misVacaciones()
      .then(setMias)
      .catch((err) =>
        setErrorMias(
          mensajeDeError(err, "No se pudieron cargar sus vacaciones."),
        ),
      );
  }, []);

  useEffect(() => {
    cargarMias();
  }, [cargarMias]);

  // Se conserva la lista anterior mientras se busca (antes parpadeaba a
  // «Cargando…» en cada letra).
  const cargarPersonas = useCallback(() => {
    setBuscando(true);
    setErrorPersonas(null);
    institucionalService
      .personasVacaciones(buscar)
      .then(setPersonas)
      .catch((err) =>
        setErrorPersonas(
          mensajeDeError(err, "No se pudo buscar a las personas."),
        ),
      )
      .finally(() => setBuscando(false));
  }, [buscar]);

  useEffect(() => {
    if (!verTodas) return undefined;
    const espera = setTimeout(cargarPersonas, 250);
    return () => clearTimeout(espera);
  }, [verTodas, cargarPersonas]);

  // El foco va al título al cambiar de persona o volver a las propias: el
  // contenido cambió y el botón pulsado puede haber desaparecido.
  const enfocarTitulo = () =>
    requestAnimationFrame(() => titulo.current?.focus());

  async function verDe(persona) {
    if (abriendo) return;
    setError(null);
    setAbriendo(persona.id);
    try {
      setOtra(await institucionalService.vacacionesDe(persona.id));
      enfocarTitulo();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudieron cargar sus vacaciones."));
    } finally {
      setAbriendo(null);
    }
  }

  function volver() {
    setOtra(null);
    setError(null);
    enfocarTitulo();
  }

  const mostradas = otra ?? mias;

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2 ref={titulo} tabIndex={-1} className="vacaciones-titulo">
            {otra ? `Vacaciones de ${otra.persona.nombre}` : "Mis vacaciones"}
          </h2>
          <p className="mz-desc">
            Los días disponibles para pedir y, por cada período, cuántos
            corresponden, cuántos se gozaron y cuántos están en aprobación.
          </p>
        </div>
        <div className="mz-actions">
          {otra ? (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={volver}
            >
              <Icon name="arrow-left" /> Volver a las mías
            </button>
          ) : (
            puedeSolicitar &&
            mias?.periodos?.length > 0 &&
            (mias.disponibles > 0 ? (
              <Link to={SOLICITAR} className="btn btn-primary btn-sm">
                <Icon name="plus-lg" /> Solicitar vacaciones
              </Link>
            ) : (
              <span className="mz-faint mz-small">
                Sin días disponibles para pedir.
              </span>
            ))
          )}
        </div>
      </div>

      {verTodas && (
        <details className="mz-card vacaciones-consulta">
          <summary>
            <Icon name="people" /> Consultar las vacaciones de otra persona
          </summary>
          <div className="mz-card-body">
            <input
              type="search"
              className="form-control form-control-sm mb-2"
              placeholder="Buscar por nombre o correo"
              aria-label="Buscar persona"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
            />
            {buscando && personas !== null && (
              <p className="mz-faint mz-small mb-1" role="status">
                Buscando…
              </p>
            )}
            <EstadoDeCarga
              cargando={personas === null && !errorPersonas}
              error={errorPersonas}
              onReintentar={cargarPersonas}
              vacio={personas?.length === 0}
              textoVacio="Todavía no hay personas con vacaciones cargadas."
              hayFiltros={buscar.trim() !== ""}
              onLimpiarFiltros={() => setBuscar("")}
            />
            <ul className="vacaciones-personas" aria-busy={Boolean(abriendo)}>
              {(personas ?? []).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="vacaciones-personas__boton"
                    disabled={Boolean(abriendo)}
                    onClick={() => verDe(p)}
                  >
                    <span>{p.nombre}</span>
                    <span className="mz-faint mz-small">
                      {abriendo === p.id
                        ? "Abriendo…"
                        : p.periodos === 0
                          ? "Sin períodos"
                          : diasCon(
                              p.disponibles ?? p.pendientes,
                              "disponible",
                              "disponibles",
                            )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {!otra && (
        <EstadoDeCarga
          cargando={mias === null && !errorMias}
          error={errorMias}
          onReintentar={cargarMias}
        />
      )}
      {mostradas && <Vacaciones datos={mostradas} propias={!otra} />}
    </div>
  );
}
