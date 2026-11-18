import { useEffect, useState } from "react";

import { chatService } from "../../../api/chatService";
import { useResultadosEnVivo } from "../../../hooks/useBusquedaEnVivo";
import { coincideBusqueda } from "../../../utils/busqueda";
import { confirmar } from "../../common/Confirmar/confirmar";
import { Icon } from "../../common/Icon/Icon";
import { ModalDialog } from "../../common/ModalDialog/ModalDialog";
import { useChat } from "./ChatContext";

/*
 * Editar y salir de un grupo desde la web (16/11/2026), igual que la app
 * (US-024, `mobile/src/chat/grupos.js`): mismas reglas y mismos textos.
 *
 * - Quien administra lo renombra; en uno personalizado, además agrega y
 *   quita personas (quitar pide confirmación). En uno por área, los miembros
 *   los da el área: solo cambia el nombre.
 * - Se sale solo de un grupo personalizado, con confirmación. Si se va quien
 *   administra, el servidor pasa la administración al más antiguo.
 */

export const TEXTO_SIN_NOMBRE = "Póngale un nombre al grupo.";
export const TEXTO_SOLO_QUIEN_ADMINISTRA =
  "Solo quien administra el grupo puede editarlo.";
export const TEXTO_YA_NO_ESTA =
  "Ya no forma parte de este grupo, o el grupo ya no existe.";

export const esGrupo = (conversacion) =>
  conversacion?.tipo === "grupo" || conversacion?.tipo === "area";
export const puedeCambiarMiembros = (conversacion) =>
  Boolean(conversacion?.administra) && conversacion.tipo === "grupo";
export const puedeSalir = (conversacion) => conversacion?.tipo === "grupo";
/** Las conversaciones con botón de integrantes: los grupos y el canal
 * general (18/11/2026, pedido del usuario: saber quiénes están incluidos). */
export const tieneIntegrantes = (conversacion) =>
  esGrupo(conversacion) || conversacion?.tipo === "general";
/** Desde cuántos integrantes se ofrece buscar entre ellos. */
const BUSCAR_DESDE = 10;

function mensajeDelServidor(err, porDefecto) {
  if (err?.response?.status === 404) return TEXTO_YA_NO_ESTA;
  const detalle = err?.response?.data?.error;
  const campo = Object.values(detalle?.details ?? {})[0];
  return (
    (Array.isArray(campo) ? campo[0] : campo) || detalle?.message || porDefecto
  );
}

/** El botón de la cabecera: en un grupo abre su gestión; en el canal
 * general, la lista de integrantes (solo lectura). */
export function BotonGrupo({ conversacion, className = "", onSalio }) {
  const [abierto, setAbierto] = useState(false);
  if (!tieneIntegrantes(conversacion)) return null;
  const general = conversacion.tipo === "general";
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={
          general
            ? `Ver los integrantes de ${conversacion.nombre}`
            : `Ver o editar el grupo ${conversacion.nombre}`
        }
        title={general ? "Integrantes" : "Participantes y opciones del grupo"}
        onClick={() => setAbierto(true)}
      >
        <Icon name="people" />
      </button>
      {abierto && (
        <GestionGrupo
          conversacionId={conversacion.id}
          onCerrar={() => setAbierto(false)}
          onSalio={() => {
            setAbierto(false);
            onSalio?.();
          }}
        />
      )}
    </>
  );
}

export function GestionGrupo({ conversacionId, onCerrar, onSalio }) {
  const chat = useChat();
  const [grupo, setGrupo] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [nombre, setNombre] = useState("");
  const [agregar, setAgregar] = useState([]);
  const [quitar, setQuitar] = useState([]);
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const [filtro, setFiltro] = useState("");

  useEffect(() => {
    let vigente = true;
    chatService
      .conversacion(conversacionId)
      .then((datos) => {
        if (!vigente) return;
        setGrupo(datos);
        setNombre(datos.nombre);
      })
      .catch((err) => {
        if (vigente)
          setErrorCarga(mensajeDelServidor(err, "No se pudo abrir el grupo."));
      });
    return () => {
      vigente = false;
    };
  }, [conversacionId]);

  const administra = Boolean(grupo?.administra);
  const cambiaMiembros = puedeCambiarMiembros(grupo);
  const general = grupo?.tipo === "general";
  const todos = (grupo?.participantes ?? [])
    .filter((p) => !quitar.includes(p.id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  // Con muchos integrantes (el canal general son todas las cuentas
  // activas), se puede buscar entre ellos, sin tildes ni mayúsculas.
  const miembros = filtro.trim()
    ? todos.filter((p) => coincideBusqueda(filtro, p.nombre))
    : todos;
  const yaEstan = new Set([
    ...(grupo?.participantes ?? []).map((p) => p.id),
    ...agregar.map((p) => p.id),
  ]);
  const candidatas = useResultadosEnVivo(cambiaMiembros ? busqueda : "", (q) =>
    q ? chatService.directorio(q).catch(() => []) : Promise.resolve([]),
  );
  const sugeridas = (candidatas.datos ?? [])
    .filter((p) => !yaEstan.has(p.id))
    .slice(0, 6);

  const nombreCambiado = grupo && nombre.trim() !== grupo.nombre;
  const hayCambios =
    Boolean(nombreCambiado) || agregar.length > 0 || quitar.length > 0;

  async function quitarPersona(persona) {
    const si = await confirmar({
      titulo: `¿Quitar a ${persona.nombre} del grupo?`,
      mensaje:
        "Dejará de ver los mensajes nuevos del grupo. Puede volver a agregarla después.",
      accion: "Quitar",
    });
    if (si) setQuitar((lista) => [...lista, persona.id]);
  }

  async function guardar(evento) {
    evento?.preventDefault();
    if (!nombre.trim()) {
      setError(TEXTO_SIN_NOMBRE);
      return;
    }
    setError(null);
    setGuardando(true);
    const datos = {};
    if (nombreCambiado) datos.nombre = nombre.trim();
    if (agregar.length) datos.agregar = agregar.map((p) => p.id);
    if (quitar.length) datos.quitar = quitar;
    try {
      await chatService.editarGrupo(conversacionId, datos);
      await chat?.cargarConversaciones?.();
      onCerrar();
    } catch (err) {
      setError(mensajeDelServidor(err, "No se pudo guardar el grupo."));
    } finally {
      setGuardando(false);
    }
  }

  async function salir() {
    const si = await confirmar({
      titulo: `¿Salir del grupo «${grupo.nombre}»?`,
      mensaje: administra
        ? "Dejará de recibir sus mensajes. Usted lo administra: la administración pasará a la persona más antigua del grupo."
        : "Dejará de recibir sus mensajes. Para volver, alguien que lo administre tendrá que agregarle.",
      accion: "Salir del grupo",
    });
    if (!si) return;
    setError(null);
    setSaliendo(true);
    try {
      await chatService.salir(conversacionId);
      chat?.cerrar?.(conversacionId);
      await chat?.cargarConversaciones?.();
      onSalio?.();
    } catch (err) {
      setError(mensajeDelServidor(err, "No se pudo salir del grupo."));
      setSaliendo(false);
    }
  }

  return (
    <ModalDialog
      titulo={grupo ? grupo.nombre : "Integrantes"}
      subtitulo={
        grupo
          ? `${
              general
                ? "Todas las cuentas activas"
                : grupo.tipo === "area"
                  ? "Grupo por área"
                  : "Grupo"
            } · ${grupo.participantes.length} ${
              grupo.participantes.length === 1 ? "persona" : "personas"
            }`
          : undefined
      }
      onCerrar={onCerrar}
      onSubmit={administra ? guardar : undefined}
      isSaving={guardando}
      puedeConfirmar={hayCambios}
      textoConfirmar="Guardar cambios"
      textoCancelar={administra ? "Cancelar" : "Cerrar"}
      sucio={hayCambios}
    >
      {errorCarga && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {errorCarga}
        </div>
      )}
      {!grupo && !errorCarga && (
        <p className="mz-faint" role="status">
          Cargando los integrantes…
        </p>
      )}
      {grupo && (
        <>
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {administra ? (
            <div className="mb-3">
              <label className="form-label mz-strong" htmlFor="gg-nombre">
                Nombre del grupo
              </label>
              <input
                id="gg-nombre"
                className="form-control"
                maxLength={120}
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
              {grupo.tipo === "area" && (
                <p className="mz-small mz-faint mb-0 mt-1">
                  En un grupo por área, los miembros los da el área: aquí solo
                  cambia el nombre.
                </p>
              )}
            </div>
          ) : general ? (
            <p className="mz-small mz-faint">
              En el canal general están todas las cuentas activas de la empresa;
              nadie lo edita ni puede salir de él.
            </p>
          ) : (
            <p className="mz-small mz-faint">{TEXTO_SOLO_QUIEN_ADMINISTRA}</p>
          )}

          <h3 className="h6 mb-1">
            {general ? "Integrantes" : "Participantes"}
          </h3>
          {todos.length > BUSCAR_DESDE && (
            <div className="mb-2">
              <label className="visually-hidden" htmlFor="gg-filtro">
                Buscar entre los integrantes
              </label>
              <input
                id="gg-filtro"
                type="search"
                className="form-control form-control-sm"
                placeholder="Buscar entre los integrantes"
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
              />
              {filtro.trim() && (
                <p className="mz-small mz-faint mb-0 mt-1" role="status">
                  {miembros.length === 0
                    ? "Nadie con ese nombre."
                    : `${miembros.length} de ${todos.length}`}
                </p>
              )}
            </div>
          )}
          <ul className="chat-lista chat-lista--corta mb-2">
            {miembros.map((p) => (
              <li key={p.id} className="chat-grupo__miembro">
                <span>
                  {p.nombre}
                  {p.administra && (
                    <span className="mz-pill mz-pill--neutral ms-2">
                      Administra
                    </span>
                  )}
                </span>
                {cambiaMiembros && !p.administra && (
                  <button
                    type="button"
                    className="btn btn-link btn-sm text-danger p-0"
                    onClick={() => quitarPersona(p)}
                  >
                    Quitar
                    <span className="visually-hidden"> a {p.nombre}</span>
                  </button>
                )}
              </li>
            ))}
            {agregar.map((p) => (
              <li key={`n-${p.id}`} className="chat-grupo__miembro">
                <span>
                  {p.nombre}{" "}
                  <span className="mz-pill mz-pill--ok ms-1">Nueva</span>
                </span>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0"
                  onClick={() =>
                    setAgregar((lista) => lista.filter((x) => x.id !== p.id))
                  }
                >
                  Deshacer
                  <span className="visually-hidden"> agregar a {p.nombre}</span>
                </button>
              </li>
            ))}
          </ul>

          {cambiaMiembros && (
            <div className="mb-3">
              <label className="form-label mz-small" htmlFor="gg-buscar">
                Agregar personas
              </label>
              <input
                id="gg-buscar"
                type="search"
                className="form-control form-control-sm"
                placeholder="Buscar por nombre"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
              />
              <ul className="chat-lista chat-lista--corta">
                {sugeridas.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="chat-lista__item"
                      onClick={() => {
                        setAgregar((lista) => [...lista, p]);
                        setBusqueda("");
                      }}
                    >
                      <Icon name="plus" /> {p.nombre}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {puedeSalir(grupo) && (
            <div className="border-top pt-3">
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                onClick={salir}
                disabled={saliendo || guardando}
              >
                <Icon name="box-arrow-right" />{" "}
                {saliendo ? "Saliendo…" : "Salir del grupo"}
              </button>
            </div>
          )}
        </>
      )}
    </ModalDialog>
  );
}
