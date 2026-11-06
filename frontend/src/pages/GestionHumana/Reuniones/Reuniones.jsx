/*
 * Reuniones de Gestión Humana (`MeetingsModule` de Nexo, sin Zoom ni el
 * calendario de Institucional, por decisión del usuario): las próximas y las
 * pasadas (por la hora: `timing` del servidor), el filtro por estado, el
 * alcance (las propias, las que organiza o, para quien administra, todas) y
 * «Programar reunión».
 *
 * Pestaña y filtros viven en la URL: al volver del detalle (o recargar) el
 * listado queda como se dejó. Qué reuniones aparecen lo decide el servidor.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import {
  errorDeReuniones,
  reunionesService,
} from "../../../api/reunionesService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../../components/common/Pestanas/Pestanas";
import { Aviso } from "../comunes";
import { Semaforo } from "../Desempeno/Componentes";
import { Encabezado } from "../Tareas/ContextoTareas";
import { ConAccesoReuniones, useReuniones } from "./ContextoReuniones";
import { FormularioReunion } from "./FormularioReunion";
import {
  BotonUnirse,
  PildoraEstado,
  PildoraMomento,
  PildoraSinCerrar,
} from "./Piezas";
import {
  duracionEnTexto,
  horario,
  idTarjetaReunion,
  nombreDe,
  rutaDeReunion,
} from "./reunionesComunes";

const TITULO = "Reuniones";

export function Reuniones() {
  return (
    <ConAccesoReuniones titulo={TITULO}>
      <Listado />
    </ConAccesoReuniones>
  );
}

function Listado() {
  const { puedeCrear, puedeAdministrar, estados } = useReuniones();
  const location = useLocation();
  const navigate = useNavigate();
  const [parametros, setParametros] = useSearchParams();
  const vista = parametros.get("vista") === "pasadas" ? "pasadas" : "proximas";
  const estado = parametros.get("estado") ?? "";
  const pedido = parametros.get("alcance") ?? "";
  // «Todas» solo para quien administra: con un enlace guardado por otra
  // persona, el servidor respondería 403.
  const alcance =
    pedido === "hosted" || (pedido === "all" && puedeAdministrar) ? pedido : "";
  const [reuniones, setReuniones] = useState(null);
  const [error, setError] = useState(null);
  const [vez, setVez] = useState(0);
  const [programando, setProgramando] = useState(false);
  const [aviso, setAviso] = useState(location.state?.aviso ?? null);
  const desde = useRef(location.state?.desde ?? null);

  function fijar(clave, valor) {
    setParametros(
      (actuales) => {
        const nuevos = new URLSearchParams(actuales);
        if (valor) nuevos.set(clave, valor);
        else nuevos.delete(clave);
        return nuevos;
      },
      { replace: true },
    );
  }

  // El aviso llega en el estado de la navegación (p. ej. «Reunión
  // eliminada»): se copia y se borra del historial, si no reaparece al
  // recargar.
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
    let vigente = true;
    setError(null);
    setReuniones(null);
    reunionesService
      .listar({ scope: alcance, status: estado })
      .then((lista) => {
        if (vigente) setReuniones(Array.isArray(lista) ? lista : []);
      })
      .catch((err) => {
        if (vigente)
          setError(
            errorDeReuniones(err, "No se pudieron cargar las reuniones.")
              .mensaje,
          );
      });
    return () => {
      vigente = false;
    };
  }, [alcance, estado, vez]);

  // De vuelta del detalle, el foco regresa a la reunión que se abrió.
  useEffect(() => {
    if (!reuniones || !desde.current) return;
    document.getElementById(idTarjetaReunion(desde.current))?.focus();
    desde.current = null;
  }, [reuniones]);

  // Próximas: también la que está en su horario, primero la más cercana.
  // Pasadas: la más reciente primero.
  const { proximas, pasadas } = useMemo(() => {
    const lista = reuniones ?? [];
    return {
      proximas: lista.filter((r) => r.timing !== "PAST"),
      pasadas: lista.filter((r) => r.timing === "PAST").reverse(),
    };
  }, [reuniones]);
  const visibles = vista === "pasadas" ? pasadas : proximas;
  const hayFiltros = Boolean(estado || alcance);

  return (
    <div className="gh-page">
      <Encabezado
        titulo={TITULO}
        descripcion="Las reuniones que organiza y a las que lo invitaron, con su enlace, sus invitados y la asistencia."
      >
        {puedeCrear && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setProgramando(true)}
          >
            <Icon name="plus-lg" /> Programar reunión
          </button>
        )}
      </Encabezado>

      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />

      <Pestanas
        etiqueta="Reuniones"
        idBase="re-reuniones"
        valor={vista}
        onCambio={(v) => fijar("vista", v === "pasadas" ? "pasadas" : "")}
        opciones={[
          {
            id: "proximas",
            etiqueta: "Próximas",
            icono: "calendar-event",
            cuenta: reuniones ? proximas.length : 0,
            unidad: proximas.length === 1 ? "reunión" : "reuniones",
          },
          {
            id: "pasadas",
            etiqueta: "Pasadas",
            icono: "clock-history",
            cuenta: reuniones ? pasadas.length : 0,
            unidad: pasadas.length === 1 ? "reunión" : "reuniones",
          },
        ]}
      />
      <PanelDePestana idBase="re-reuniones" valor={vista} className="gh-page">
        <form
          className="mz-filter-bar re-filtros"
          role="search"
          aria-label="Filtrar reuniones"
          onSubmit={(e) => e.preventDefault()}
        >
          <select
            className="form-select form-select-sm"
            aria-label="Filtrar por estado"
            value={estado}
            onChange={(e) => fijar("estado", e.target.value)}
          >
            <option value="">Todo estado</option>
            {estados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.texto}
              </option>
            ))}
          </select>
          <select
            className="form-select form-select-sm"
            aria-label="Qué reuniones ver"
            value={alcance}
            onChange={(e) => fijar("alcance", e.target.value)}
          >
            <option value="">Mis reuniones e invitaciones</option>
            <option value="hosted">Solo las que organizo</option>
            {puedeAdministrar && (
              <option value="all">Todas las de la empresa</option>
            )}
          </select>
        </form>

        <EstadoDeCarga
          cargando={reuniones === null && !error}
          error={error}
          onReintentar={() => setVez((v) => v + 1)}
          vacio={reuniones !== null && visibles.length === 0}
          hayFiltros={hayFiltros}
          onLimpiarFiltros={() =>
            setParametros(vista === "pasadas" ? { vista } : {}, {
              replace: true,
            })
          }
          textoVacio={
            vista === "pasadas"
              ? "No hay reuniones pasadas."
              : "No tiene reuniones próximas."
          }
          accionVacio={
            puedeCrear && vista === "proximas" ? (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setProgramando(true)}
              >
                Programar una reunión
              </button>
            ) : null
          }
        />

        {/* Siempre montado: una región viva que aparece ya con texto no se
            anuncia. */}
        <p className="mz-small mz-faint mb-0" role="status">
          {reuniones !== null && visibles.length > 0
            ? `${visibles.length} ${visibles.length === 1 ? "reunión" : "reuniones"}`
            : ""}
        </p>
        {visibles.length > 0 && (
          <ul className="re-lista">
            {visibles.map((r) => (
              <TarjetaReunion
                key={r.id}
                reunion={r}
                volverA={location.search}
              />
            ))}
          </ul>
        )}
      </PanelDePestana>

      {programando && (
        <FormularioReunion
          onCerrar={() => setProgramando(false)}
          onGuardada={(reunion) => {
            setProgramando(false);
            setAviso({
              texto: `Reunión «${reunion.title}» programada. A los invitados les llegó el aviso.`,
            });
            setVez((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

function TarjetaReunion({ reunion, volverA }) {
  const invitados = reunion.invitees?.length ?? 0;
  return (
    <li className="re-tarjeta">
      <div className="re-tarjeta__cuerpo">
        <Link
          id={idTarjetaReunion(reunion.id)}
          to={rutaDeReunion(reunion.id)}
          state={{ volverA }}
          className="re-tarjeta__titulo"
        >
          {reunion.title}
        </Link>
        <p className="mb-0 re-tarjeta__horario">
          <Icon name="clock" /> {horario(reunion)}{" "}
          <span className="mz-faint">
            ({duracionEnTexto(reunion.duration)})
          </span>
        </p>
        <div className="mz-pill-row">
          <PildoraEstado status={reunion.status} texto={reunion.status_label} />
          <PildoraMomento timing={reunion.timing} />
          <PildoraSinCerrar reunion={reunion} />
          {reunion.is_host && (
            <Semaforo tono="info">
              <Icon name="person-badge" /> Usted organiza
            </Semaforo>
          )}
        </div>
        <p className="mz-small mz-faint mb-0">
          Organiza {nombreDe(reunion.host)} ·{" "}
          {invitados === 1 ? "1 invitado" : `${invitados} invitados`}
        </p>
      </div>
      {reunion.timing !== "PAST" && (
        <div className="re-tarjeta__acciones">
          <BotonUnirse
            reunion={reunion}
            className="btn btn-outline-primary btn-sm"
          />
        </div>
      )}
    </li>
  );
}
