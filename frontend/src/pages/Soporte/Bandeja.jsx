import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import {
  EstadoDeCarga,
  FilaDeEstado,
} from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { Paginacion } from "../../components/common/Paginacion/Paginacion";
import {
  PanelDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
import { useAuth } from "../../hooks/useAuth";
import { useListadoPaginado } from "../../hooks/useListadoPaginado";
import { useVistaDeTarjetas } from "../../hooks/useMediaQuery";
import { PERMISOS_SOPORTE } from "../../modulos/permisosSoporte";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import {
  EstadoTicket,
  PrioridadTicket,
  queSigue,
  VenceTicket,
  useEtiquetas,
} from "./comunes";
import "./Soporte.css";

/** Cada cuánto se refresca la bandeja: los tickets llegan solos. */
const REFRESCO_MS = 30_000;
const SIN_COLA = "No hay tickets en la cola que usted pueda atender.";

/**
 * Bandeja de la mesa de ayuda.
 *
 * Toda persona ve aquí «Mis solicitudes»: lo que ella creó, en cualquier
 * estado, con su posición en la cola (21/10/2026); cada quien solo lo suyo.
 * Quien es del equipo ve además, arriba, su estado (en horario, cuántos tiene
 * y cuántos esperan en la cola para él) y «Tomar siguiente», y abajo sus
 * tickets, la cola o —para quien coordina— todos los de la empresa.
 */
export function Bandeja({ todos = false }) {
  const navegar = useNavigate();
  const etiquetas = useEtiquetas();
  const { user } = useAuth();
  const delEquipo = PERMISOS_SOPORTE.some((p) =>
    user?.permissions?.includes(p),
  );
  const [cabecera, setCabecera] = useState(null);
  const [parametros, setParametros] = useSearchParams();
  /* La pestaña va en la dirección (?vista=…): al recargar se queda donde
   * estaba. Sin elegir, la que corresponde una vez que se sabe quién es
   * (auditoría UX/UI, 30/10/2026: al recargar, el técnico caía en «Mis
   * solicitudes», porque se decidía antes de cargar sus permisos). */
  const elegida = parametros.get("vista");
  const ambito = todos
    ? "todos"
    : elegida ||
      (!delEquipo
        ? "creados"
        : cabecera
          ? cabecera.tecnico
            ? "mios"
            : cabecera.puede.ver_todos
              ? "todos"
              : "creados"
          : null);
  const setAmbito = (vista) =>
    setParametros(
      (actuales) => {
        const nuevos = new URLSearchParams(actuales);
        nuevos.set("vista", vista);
        return nuevos;
      },
      { replace: true },
    );
  const [busqueda, setBusqueda] = useState("");
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);
  const [tomando, setTomando] = useState(false);
  const enTarjetas = useVistaDeTarjetas();

  const cargar = useCallback(
    (params) =>
      // «Mis solicitudes» tiene su propio listado (ver `MisSolicitudes`), y
      // sin saber todavía la pestaña no se pide nada.
      ambito === "creados" || ambito === null
        ? Promise.resolve({ results: [], count: 0 })
        : soporteService.tickets({ ...params, ambito }),
    [ambito],
  );
  const listado = useListadoPaginado(
    cargar,
    { q: "", estado: "", prioridad: "", vencidos: "" },
    "No se pudieron cargar los tickets.",
  );
  const { refresh, actualizarFiltros } = listado;
  const buscado = listado.filtros.q;

  // La búsqueda se aplica sola al dejar de escribir (antes había que pulsar
  // «Buscar» y el estado, en cambio, se aplicaba al instante).
  useEffect(() => {
    if (busqueda.trim() === buscado) return undefined;
    const espera = setTimeout(
      () => actualizarFiltros({ q: busqueda.trim() }),
      300,
    );
    return () => clearTimeout(espera);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al escribir
  }, [busqueda]);

  const cargarCabecera = useCallback(() => {
    // Quien no es del equipo no tiene estado de técnico que mostrar: pedirlo
    // solo dejaría un acceso denegado en la auditoría cada medio minuto.
    if (!delEquipo) return;
    soporteService
      .bandeja()
      .then(setCabecera)
      .catch(() => setCabecera(null));
  }, [delEquipo]);

  useEffect(() => {
    cargarCabecera();
    const intervalo = setInterval(() => {
      cargarCabecera();
      refresh?.();
    }, REFRESCO_MS);
    return () => clearInterval(intervalo);
  }, [cargarCabecera, refresh]);

  /* Auditoría UX/UI, fase 2 (28/10/2026): cualquier fallo salía como «No hay
   * tickets en la cola»; un error de red o de permisos parecía una cola vacía.
   * La cola vacía (404 del servidor) es un aviso; lo demás, un error. */
  async function tomarSiguiente() {
    setError(null);
    setAviso(null);
    setTomando(true);
    try {
      const ticket = await soporteService.tomarSiguiente();
      if (!ticket?.id) {
        setAviso(SIN_COLA);
        return;
      }
      navegar(`/admin/soporte/tickets/${ticket.id}`);
    } catch (err) {
      if (err?.response?.status === 404) {
        setAviso(mensajeDeError(err, SIN_COLA));
      } else {
        setError(mensajeDeError(err, "No se pudo tomar el siguiente ticket."));
      }
    } finally {
      setTomando(false);
    }
  }

  const tecnico = cabecera?.tecnico;
  const sinColaParaMi = tecnico && tecnico.cola_para_mi === 0;
  const hayFiltros = Boolean(
    listado.filtros.q ||
    listado.filtros.estado ||
    listado.filtros.prioridad ||
    listado.filtros.vencidos,
  );
  const limpiarFiltros = () => {
    setBusqueda("");
    listado.actualizarFiltros({
      q: "",
      estado: "",
      prioridad: "",
      vencidos: "",
    });
  };
  const textoVacio = listado.filtros.vencidos
    ? "No hay tickets vencidos."
    : ambito === "mios"
      ? "No tiene tickets en atención."
      : ambito === "cola"
        ? "No hay tickets esperando en la cola."
        : "No hay tickets.";
  const accionVacio =
    ambito !== "mios" || !tecnico || hayFiltros ? undefined : sinColaParaMi ? (
      <button
        type="button"
        className="btn btn-outline-primary btn-sm"
        onClick={() => setAmbito("cola")}
      >
        Ver la cola de la empresa
      </button>
    ) : (
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={tomando}
        onClick={tomarSiguiente}
      >
        {tomando ? "Tomando…" : "Tomar el siguiente de la cola"}
      </button>
    );
  const ambitos = [
    ...(tecnico
      ? [
          ["mios", "Mis tickets"],
          ["cola", "Cola"],
        ]
      : []),
    ...(cabecera?.puede.ver_todos ? [["todos", "Todos"]] : []),
    ["creados", "Mis solicitudes"],
  ];

  return (
    <div className="soporte-page">
      <div className="mz-view-head">
        <div>
          <h2>{todos ? "Todos los tickets" : "Bandeja de soporte"}</h2>
          <p className="mz-desc">
            {cabecera
              ? `${cabecera.cola_total} ticket(s) esperan en la cola de la empresa.`
              : "Sus solicitudes a la Mesa de ayuda de TI y en qué van."}
          </p>
        </div>
        {(tecnico || cabecera?.puede.registrar) && (
          <div className="mz-view-actions">
            {/* Lo que llega por teléfono, WhatsApp o en persona también se
                registra: «sin ticket no hay atención». */}
            {cabecera?.puede.registrar && (
              <Link
                className="btn btn-outline-primary btn-sm"
                to="/admin/soporte/registrar"
              >
                <Icon name="telephone-plus" /> Registrar ticket
              </Link>
            )}
            {tecnico && (
              /* Sin nada para usted en la cola, el botón lo dice en vez de
                 invitar a pulsarlo (auditoría UX/UI, 30/10/2026). */
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={tomarSiguiente}
                disabled={tomando || sinColaParaMi}
                aria-describedby={
                  sinColaParaMi ? "sb-sin-cola-para-mi" : undefined
                }
              >
                <Icon name="inbox-fill" />{" "}
                {tomando ? "Tomando…" : "Tomar siguiente"}
              </button>
            )}
          </div>
        )}
      </div>

      {cabecera?.categorias_sin_tecnicos?.length > 0 && (
        <div className="mz-alert mz-alert--bad" role="status">
          <Icon name="exclamation-octagon" />
          <span>
            {cabecera.categorias_sin_tecnicos.length === 1
              ? `La categoría «${cabecera.categorias_sin_tecnicos[0]}» no tiene técnicos: sus tickets no se reparten.`
              : `${cabecera.categorias_sin_tecnicos.length} categorías no tienen técnicos (${cabecera.categorias_sin_tecnicos.join(", ")}): sus tickets no se reparten.`}{" "}
            <Link to="/admin/configuracion/soporte">Asignar técnicos</Link>
          </span>
        </div>
      )}

      {tecnico && !todos && (
        <section className="mz-card mb-3">
          <div className="mz-card-body soporte-estado-tecnico">
            <span
              className={`mz-pill ${tecnico.en_horario ? "mz-pill--ok" : "mz-pill--neutral"}`}
            >
              {tecnico.en_horario
                ? "En horario de atención"
                : "Fuera de su horario"}
            </span>
            <span>
              <strong>{tecnico.abiertos}</strong> de {tecnico.capacidad} en
              atención
            </span>
            <span id="sb-sin-cola-para-mi">
              {sinColaParaMi ? (
                "No hay tickets de sus categorías en la cola"
              ) : (
                <>
                  <strong>{tecnico.cola_para_mi}</strong> en la cola para usted
                </>
              )}
            </span>
            <span className="mz-small mz-faint">
              {tecnico.nivel} ·{" "}
              {tecnico.categorias.join(", ") || "sin categorías asignadas"}
            </span>
          </div>
        </section>
      )}
      {cabecera && !tecnico && !cabecera.puede.ver_todos && (
        <div className="mz-alert mz-alert--info">
          <Icon name="info-circle" />
          Usted no es parte del equipo de soporte de esta empresa. Quien
          configura la mesa de ayuda lo da de alta en Configuración → Mesa de
          ayuda → Técnicos.
        </div>
      )}

      {aviso && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="info-circle" />
          {aviso}
        </div>
      )}
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {/* Pestañas de verdad (auditoría UX/UI, fase 2, 28/10/2026): antes era
          un <nav> con aria-current en botones que no navegan. */}
      {ambitos.length > 1 && !todos && (
        <Pestanas
          className="mz-config-tabs"
          etiqueta="Qué tickets ver"
          idBase="sb-ambito"
          valor={ambito}
          onCambio={setAmbito}
          opciones={ambitos.map(([id, etiqueta]) => ({ id, etiqueta }))}
        />
      )}

      <PanelDePestana
        idBase="sb-ambito"
        valor={ambito}
        // Sin pestañas a la vista, el panel no se presenta como tal.
        sinPestanas={!(ambitos.length > 1 && !todos)}
      >
        {ambito === null ? (
          <EstadoDeCarga cargando />
        ) : ambito === "creados" ? (
          <MisSolicitudes />
        ) : (
          <>
            <form
              className="mz-filter-bar"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                listado.actualizarFiltros({ q: busqueda.trim() });
              }}
            >
              <label className="mz-fb-search" htmlFor="sb-buscar">
                <Icon name="search" />
                <span className="visually-hidden">Buscar</span>
                <input
                  id="sb-buscar"
                  type="search"
                  placeholder="N.º de ticket, solicitante o descripción"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                />
              </label>
              {ambito !== "cola" && (
                <div className="mz-inline-field">
                  <label htmlFor="sb-estado">Estado</label>
                  <select
                    id="sb-estado"
                    className="form-select form-select-sm"
                    value={listado.filtros.estado}
                    onChange={(e) =>
                      listado.actualizarFiltros({ estado: e.target.value })
                    }
                  >
                    <option value="">Abiertos</option>
                    {etiquetas.estados.map(([valor, etiqueta]) => (
                      <option key={valor} value={valor}>
                        {etiqueta}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="mz-inline-field">
                <label htmlFor="sb-prioridad">Prioridad</label>
                <select
                  id="sb-prioridad"
                  className="form-select form-select-sm"
                  value={listado.filtros.prioridad}
                  onChange={(e) =>
                    listado.actualizarFiltros({ prioridad: e.target.value })
                  }
                >
                  <option value="">Todas</option>
                  {etiquetas.prioridades.map(([valor, etiqueta]) => (
                    <option key={valor} value={valor}>
                      {etiqueta}
                    </option>
                  ))}
                </select>
              </div>
              <label className="form-check mb-0" htmlFor="sb-vencidos">
                <input
                  id="sb-vencidos"
                  type="checkbox"
                  className="form-check-input"
                  checked={Boolean(listado.filtros.vencidos)}
                  onChange={(e) =>
                    listado.actualizarFiltros({
                      vencidos: e.target.checked ? "true" : "",
                    })
                  }
                />{" "}
                <span className="form-check-label">Solo vencidos</span>
              </label>
            </form>
            {ambito !== "cola" && (
              <p className="mz-small mz-faint mb-2">
                Primero lo que vence antes.
              </p>
            )}

            {/* En el teléfono, cada ticket en una tarjeta como en la Matriz:
                ocho columnas a 375 px solo se leían desplazándose de lado
                (auditoría UX/UI, fase 3, 28/10/2026). */}
            <div className="mz-table-wrap mz-table-wrap--con-tarjetas">
              <table className="mz-table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Solicitante</th>
                    <th>Caso</th>
                    <th>Prioridad</th>
                    <th>Estado</th>
                    <th>{ambito === "cola" ? "Posición" : "Atiende"}</th>
                    <th>Vence</th>
                  </tr>
                </thead>
                <tbody>
                  {listado.resultados.map((t) => (
                    <tr key={t.id}>
                      <td className="mz-mono">
                        <Link to={`/admin/soporte/tickets/${t.id}`}>
                          {t.numero}
                        </Link>
                        <div className="mz-small mz-faint">
                          {formatearFecha(t.created_at, true)}
                        </div>
                      </td>
                      <td>
                        {t.solicitante_nombre}
                        <div className="mz-small mz-faint">
                          {[t.agencia, t.area].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td>
                        {t.caso}
                        <div className="mz-small mz-faint">
                          {t.categoria} · {t.nivel}
                        </div>
                      </td>
                      <td>
                        <PrioridadTicket ticket={t} />
                      </td>
                      <td>
                        <EstadoTicket ticket={t} />
                        {t.escalado_por_sla && (
                          <div className="mz-small text-danger">
                            Escalado por SLA
                          </div>
                        )}
                      </td>
                      <td>
                        {ambito === "cola"
                          ? t.posicion
                          : t.tecnico?.nombre || "—"}
                      </td>
                      <td>
                        <VenceTicket sla={t.sla} />
                      </td>
                    </tr>
                  ))}
                  {/* Cargando, error y vacío dentro de la tabla, en sus 7
                    columnas. */}
                  <FilaDeEstado
                    columnas={7}
                    cargando={
                      listado.isLoading && listado.resultados.length === 0
                    }
                    error={listado.error}
                    onReintentar={listado.refresh}
                    vacio={listado.resultados.length === 0}
                    hayFiltros={hayFiltros}
                    onLimpiarFiltros={limpiarFiltros}
                    textoVacio={textoVacio}
                    accionVacio={accionVacio}
                  />
                </tbody>
              </table>
            </div>
            {enTarjetas && (
              <div className="mz-cards">
                <EstadoDeCarga
                  cargando={
                    listado.isLoading && listado.resultados.length === 0
                  }
                  error={listado.error}
                  onReintentar={listado.refresh}
                  vacio={listado.resultados.length === 0}
                  hayFiltros={hayFiltros}
                  onLimpiarFiltros={limpiarFiltros}
                  textoVacio={textoVacio}
                  accionVacio={accionVacio}
                />
                {listado.resultados.length > 0 && (
                  <ul className="mz-cards-lista" aria-label="Tickets">
                    {listado.resultados.map((t) => (
                      <li key={t.id} className="mz-card-row">
                        <div className="mz-row-between">
                          <span className="mz-mono mz-strong">{t.numero}</span>
                          <EstadoTicket ticket={t} />
                        </div>
                        <div className="mz-card-row__titulo">{t.caso}</div>
                        {t.escalado_por_sla && (
                          <div className="mz-small text-danger">
                            Escalado por SLA
                          </div>
                        )}
                        <div className="mz-card-meta">
                          <span>{t.solicitante_nombre}</span>
                          <PrioridadTicket ticket={t} />
                          <span>
                            {ambito === "cola"
                              ? `Posición ${t.posicion}`
                              : `Atiende: ${t.tecnico?.nombre || "—"}`}
                          </span>
                          <VenceTicket sla={t.sla} />
                        </div>
                        <div className="mz-card-acciones">
                          <Link
                            className="btn btn-outline-primary btn-sm"
                            to={`/admin/soporte/tickets/${t.id}`}
                          >
                            Abrir ticket {t.numero}
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <Paginacion
              total={listado.total}
              pagina={listado.pagina}
              hasNext={listado.hasNext}
              hasPrevious={listado.hasPrevious}
              onCambiarPagina={listado.setPagina}
              etiqueta="tickets"
            />
          </>
        )}
      </PanelDePestana>
    </div>
  );
}

/** «Qué sigue» de un ticket propio: resaltado si le toca a la persona. */
function QueSigue({ ticket }) {
  const { texto, accion } = queSigue(ticket);
  return accion ? (
    <strong className="soporte-le-toca">
      <Icon name="arrow-right-circle-fill" /> {texto}
    </strong>
  ) : (
    <span className="mz-faint">{texto}</span>
  );
}

/**
 * «Mis solicitudes»: los tickets que la persona creó, en cualquier estado.
 * Solo los suyos (el servidor no devuelve otros) y abren su ficha de
 * seguimiento, la de quien pide —sin notas internas—.
 *
 * Auditoría UX/UI (30/10/2026): primero los que le piden algo («Le
 * respondieron», «Confirme si quedó resuelto»), con la columna «Qué sigue»;
 * la prioridad en palabras llanas (sin «P1») y un botón «Ver» por fila.
 */
export function MisSolicitudes() {
  const [tickets, setTickets] = useState(null);
  const [error, setError] = useState(null);
  const enTarjetas = useVistaDeTarjetas();

  const cargar = useCallback(() => {
    // El error se borra al cargar bien: se consulta cada 30 s y, si se
    // borrara antes, el aviso se anunciaría de nuevo en cada vuelta.
    soporteService
      .misTickets()
      .then((datos) => {
        setTickets(datos);
        setError(null);
      })
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar sus solicitudes.")),
      );
  }, []);

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, REFRESCO_MS);
    return () => clearInterval(intervalo);
  }, [cargar]);

  // Lo que le toca a la persona, arriba; el resto, como llega (lo reciente
  // primero).
  const ordenados = [...(tickets ?? [])].sort(
    (a, b) => Number(queSigue(b).accion) - Number(queSigue(a).accion),
  );
  const pendientes = ordenados.filter((t) => queSigue(t).accion).length;

  return (
    <>
      {pendientes > 0 && (
        <div className="mz-alert mz-alert--warn" role="status">
          <Icon name="arrow-right-circle" />
          {pendientes === 1
            ? "Un ticket necesita algo de usted: está primero en la lista."
            : `${pendientes} tickets necesitan algo de usted: están primero en la lista.`}
        </div>
      )}
      <div className="mz-table-wrap mz-table-wrap--con-tarjetas">
        <table className="mz-table" aria-label="Mis tickets">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Caso</th>
              <th>Prioridad</th>
              <th>Estado</th>
              <th>Qué sigue</th>
              <th>
                <span className="visually-hidden">Abrir</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ordenados.map((t) => (
              <tr key={t.id}>
                <td className="mz-mono">
                  <Link to={`/admin/ayuda/tickets/${t.id}`}>{t.numero}</Link>
                  <div className="mz-small mz-faint">
                    {formatearFecha(t.creado, true)}
                  </div>
                </td>
                <td>
                  {t.caso}
                  <div className="mz-small mz-faint">{t.categoria}</div>
                </td>
                <td>
                  <PrioridadTicket ticket={t} llano />
                </td>
                <td>
                  <EstadoTicket ticket={t} />
                </td>
                <td>
                  <QueSigue ticket={t} />
                </td>
                <td>
                  <Link
                    className="btn btn-outline-primary btn-sm"
                    to={`/admin/ayuda/tickets/${t.id}`}
                    aria-label={`Ver el ticket ${t.numero}`}
                  >
                    Ver
                  </Link>
                </td>
              </tr>
            ))}
            {/* Mientras carga ya no se ve una tabla vacía, y un fallo no se
                confunde con «no ha creado solicitudes». */}
            <FilaDeEstado
              columnas={6}
              cargando={tickets === null}
              error={error}
              onReintentar={cargar}
              vacio={tickets?.length === 0}
              textoVacio="Todavía no ha pedido ayuda."
              accionVacio={
                <Link to="/admin/ayuda">Pedir ayuda en Soporte TI</Link>
              }
            />
          </tbody>
        </table>
      </div>
      {/* En el teléfono, en tarjetas. */}
      {enTarjetas && (
        <div className="mz-cards">
          <EstadoDeCarga
            cargando={tickets === null}
            error={error}
            onReintentar={cargar}
            vacio={tickets?.length === 0}
            textoVacio="Todavía no ha pedido ayuda."
            accionVacio={
              <Link to="/admin/ayuda">Pedir ayuda en Soporte TI</Link>
            }
          />
          {ordenados.length > 0 && (
            <ul className="mz-cards-lista" aria-label="Mis tickets">
              {ordenados.map((t) => (
                <li key={t.id} className="mz-card-row">
                  <div className="mz-row-between">
                    <span className="mz-mono mz-strong">{t.numero}</span>
                    <EstadoTicket ticket={t} />
                  </div>
                  <div className="mz-card-row__titulo">{t.caso}</div>
                  <div className="mz-card-meta">
                    <QueSigue ticket={t} />
                    <PrioridadTicket ticket={t} llano />
                    <span>{formatearFecha(t.creado, true)}</span>
                  </div>
                  <div className="mz-card-acciones">
                    <Link
                      className="btn btn-outline-primary btn-sm"
                      to={`/admin/ayuda/tickets/${t.id}`}
                    >
                      Ver el ticket {t.numero}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
