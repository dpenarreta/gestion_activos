import { useEffect, useState } from "react";

import { chatService } from "../../../api/chatService";
import { formatearFecha } from "../../../utils/formato";
import { Icon } from "../../common/Icon/Icon";
import { useChat } from "./ChatContext";
import { TarjetaContacto } from "./Contacto";
import { Presencia, textoPresencia, usePresencia } from "./Presencia";

const ICONO = {
  general: "megaphone",
  directa: "person",
  grupo: "people",
  area: "diagram-3",
};

/** El canal general y los grupos se pintan de otro color que los directos,
 * para distinguirlos de un vistazo. */
export function esGrupal(conversacion) {
  return conversacion?.tipo !== "directa";
}

/** «1 mensaje sin leer», «3 mensajes sin leer»: lo que oye el lector de
 * pantalla en lugar del número de la insignia (revisión final UX/UI,
 * 28/10/2026). */
export function textoSinLeer(cantidad) {
  return `${cantidad} ${cantidad === 1 ? "mensaje" : "mensajes"} sin leer`;
}

/** Mis conversaciones: el canal general primero, luego lo más reciente. */
export function ListaConversaciones({
  onElegir,
  activa,
  soloGrupales = false,
}) {
  const { conversaciones: todas, noLeidos } = useChat();
  const conversaciones = soloGrupales ? todas.filter(esGrupal) : todas;
  // En los directos, si la otra persona está en línea.
  const presencia = usePresencia(
    conversaciones.filter((c) => c.tipo === "directa").map((c) => c.otro?.id),
  );
  if (todas.length === 0) {
    return (
      <p className="mz-small mz-faint p-3 mb-0">Cargando conversaciones…</p>
    );
  }
  return (
    <ul className="chat-lista" aria-label="Conversaciones">
      {conversaciones.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className={`chat-lista__item${activa === c.id ? " chat-lista__item--activa" : ""}${
              esGrupal(c) ? " chat-lista__item--grupo" : ""
            }`}
            onClick={() => onElegir(c.id)}
          >
            <span className="chat-lista__icono" aria-hidden="true">
              <Icon name={ICONO[c.tipo] ?? "chat"} />
            </span>
            <span className="chat-lista__texto">
              <strong>
                {c.nombre}{" "}
                {c.tipo === "directa" && (
                  <Presencia estado={presencia[c.otro?.id]} />
                )}
              </strong>
              <span className="chat-lista__ultimo">
                {c.ultimo
                  ? `${c.ultimo.propio ? "Usted" : c.ultimo.autor}: ${c.ultimo.texto}`
                  : c.tipo === "general"
                    ? "Toda la empresa"
                    : "Sin mensajes"}
              </span>
            </span>
            <span className="chat-lista__meta">
              {c.ultimo && (
                <span className="mz-small mz-faint">
                  {formatearFecha(c.ultimo.fecha)}
                </span>
              )}
              {noLeidos[c.id] > 0 && (
                <span className="chat-contador">
                  <span aria-hidden="true">{noLeidos[c.id]}</span>
                  <span className="visually-hidden">
                    {textoSinLeer(noLeidos[c.id])}
                  </span>
                </span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Las personas de la empresa, para empezar un chat directo. */
export function Directorio({ onElegida }) {
  const { iniciarDirecta } = useChat();
  const [busqueda, setBusqueda] = useState("");
  const [personas, setPersonas] = useState([]);
  // De quién se está viendo el contacto.
  const [contacto, setContacto] = useState(null);
  const presencia = usePresencia(personas.map((p) => p.id));

  useEffect(() => {
    const temporizador = setTimeout(() => {
      chatService
        .directorio(busqueda)
        .then(setPersonas)
        .catch(() => setPersonas([]));
    }, 250);
    return () => clearTimeout(temporizador);
  }, [busqueda]);

  return (
    <div className="chat-directorio">
      <input
        className="form-control form-control-sm"
        placeholder="Buscar por nombre o correo"
        aria-label="Buscar personas"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
      />
      <ul className="chat-lista" aria-label="Personas">
        {personas.map((p) => (
          <li key={p.id} className="chat-persona">
            <div className="chat-persona__fila">
              <button
                type="button"
                className="chat-lista__item"
                onClick={async () => {
                  const conversacion = await iniciarDirecta(p.id);
                  onElegida?.(conversacion.id);
                }}
              >
                <span className="chat-lista__icono" aria-hidden="true">
                  <Icon name="person" />
                </span>
                <span className="chat-lista__texto">
                  <strong>
                    {p.nombre} <Presencia estado={presencia[p.id]} />
                  </strong>
                  <span className="chat-lista__ultimo">
                    {[textoPresencia(presencia[p.id]), p.area]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
              {/* Ver su contacto (correo y, si lo autorizó, teléfono) sin
                  abrir el chat. */}
              <button
                type="button"
                className={`chat-persona__contacto${contacto === p.id ? " is-active" : ""}`}
                aria-label={`Ver contacto de ${p.nombre}`}
                aria-expanded={contacto === p.id}
                title="Ver contacto"
                onClick={() => setContacto(contacto === p.id ? null : p.id)}
              >
                <Icon name="person-vcard" />
              </button>
            </div>
            {contacto === p.id && <TarjetaContacto persona={p} />}
          </li>
        ))}
        {personas.length === 0 && (
          <li className="mz-small mz-faint p-2">Nadie con ese nombre.</li>
        )}
      </ul>
    </div>
  );
}

/** Un grupo personalizado (elige a las personas) o, con permiso, por área. */
export function NuevoGrupo({ onCreado }) {
  const { crearGrupo } = useChat();
  const [nombre, setNombre] = useState("");
  const [modo, setModo] = useState("personas");
  const [areas, setAreas] = useState([]);
  const [area, setArea] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [personas, setPersonas] = useState([]);
  const [elegidas, setElegidas] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    chatService
      .areas()
      .then(setAreas)
      .catch(() => setAreas([]));
  }, []);

  useEffect(() => {
    chatService
      .directorio(busqueda)
      .then(setPersonas)
      .catch(() => setPersonas([]));
  }, [busqueda]);

  async function crear(evento) {
    evento.preventDefault();
    setError(null);
    try {
      const conversacion = await crearGrupo(
        modo === "area"
          ? { nombre, departamento: Number(area) }
          : { nombre, participantes: elegidas.map((p) => p.id) },
      );
      onCreado?.(conversacion.id);
    } catch (err) {
      const detalle = err?.response?.data?.error;
      setError(
        Object.values(detalle?.details ?? {})[0]?.[0] ||
          detalle?.message ||
          "No se pudo crear el grupo.",
      );
    }
  }

  return (
    <form className="chat-nuevo-grupo" onSubmit={crear}>
      <label className="form-label mz-small" htmlFor="cg-nombre">
        Nombre del grupo
      </label>
      <input
        id="cg-nombre"
        className="form-control form-control-sm"
        required
        maxLength={120}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
      />
      {areas.length > 0 && (
        <div className="d-flex gap-3 my-2">
          <div className="form-check">
            <input
              id="cg-personas"
              type="radio"
              className="form-check-input"
              checked={modo === "personas"}
              onChange={() => setModo("personas")}
            />
            <label className="form-check-label mz-small" htmlFor="cg-personas">
              Elegir personas
            </label>
          </div>
          <div className="form-check">
            <input
              id="cg-area"
              type="radio"
              className="form-check-input"
              checked={modo === "area"}
              onChange={() => setModo("area")}
            />
            <label className="form-check-label mz-small" htmlFor="cg-area">
              Por área
            </label>
          </div>
        </div>
      )}
      {modo === "area" ? (
        <>
          <label className="form-label mz-small mt-2" htmlFor="cg-departamento">
            Área (sus personas son los miembros)
          </label>
          <select
            id="cg-departamento"
            className="form-select form-select-sm"
            required
            value={area}
            onChange={(e) => setArea(e.target.value)}
          >
            <option value="">Elija el área</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <div className="chat-elegidas">
            {elegidas.map((p) => (
              <span key={p.id} className="mz-pill mz-pill--neutral">
                {p.nombre}
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0 ms-1"
                  aria-label={`Quitar a ${p.nombre}`}
                  onClick={() =>
                    setElegidas((lista) => lista.filter((x) => x.id !== p.id))
                  }
                >
                  <Icon name="x" />
                </button>
              </span>
            ))}
          </div>
          <input
            className="form-control form-control-sm mt-2"
            placeholder="Buscar personas para agregar"
            aria-label="Buscar personas para el grupo"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
          <ul className="chat-lista chat-lista--corta">
            {personas
              .filter((p) => !elegidas.some((e) => e.id === p.id))
              .slice(0, 8)
              .map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="chat-lista__item"
                    onClick={() => setElegidas((lista) => [...lista, p])}
                  >
                    <Icon name="plus" /> {p.nombre}
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
      {error && <div className="mz-small text-danger mt-2">{error}</div>}
      <button
        type="submit"
        className="btn btn-primary btn-sm mt-2 w-100"
        disabled={modo === "personas" && elegidas.length === 0}
      >
        Crear grupo
      </button>
    </form>
  );
}

/** La pestaña «Grupos»: el canal general y los grupos, y desde aquí se crea
 * uno nuevo. */
export function Grupos({ onElegir, activa }) {
  const [creando, setCreando] = useState(false);
  if (creando) {
    return (
      <div>
        <div className="chat-grupos__acciones">
          <button
            type="button"
            className="btn btn-link btn-sm p-0"
            onClick={() => setCreando(false)}
          >
            <Icon name="arrow-left" /> Volver a los grupos
          </button>
        </div>
        <NuevoGrupo
          onCreado={(id) => {
            setCreando(false);
            onElegir(id);
          }}
        />
      </div>
    );
  }
  return (
    <div>
      <div className="chat-grupos__acciones">
        <button
          type="button"
          className="btn btn-primary btn-sm w-100"
          onClick={() => setCreando(true)}
        >
          <Icon name="plus-lg" /> Crear grupo
        </button>
      </div>
      <ListaConversaciones onElegir={onElegir} activa={activa} soloGrupales />
    </div>
  );
}
