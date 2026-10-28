import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { aplica, CamposFormulario } from "./Publico/CamposFormulario";
import "./Soporte.css";

const VACIO = {
  categoria: "",
  caso: "",
  descripcion: "",
  impacto: "",
  urgencia: "",
};

/**
 * Registrar un ticket en nombre de quien pide: lo que llega por teléfono,
 * WhatsApp o en persona también entra a la mesa («sin ticket no hay
 * atención»). Solo para personas registradas (20/10/2026): se elige a la
 * persona y sus datos salen de «Mi perfil»; lo que le falte se completa aquí,
 * solo para este ticket. Quien pidió recibe por correo el enlace a su ticket.
 */
export function RegistrarTicket() {
  const navigate = useNavigate();
  const [datos, setDatos] = useState(null);
  const [valores, setValores] = useState(VACIO);
  const [adicionales, setAdicionales] = useState({});
  const [canal, setCanal] = useState("telefono");
  const [busqueda, setBusqueda] = useState("");
  const [personas, setPersonas] = useState([]);
  const [persona, setPersona] = useState(null);
  const [completar, setCompletar] = useState({
    telefono: "",
    area: "",
    sede: "",
  });
  const [asignarme, setAsignarme] = useState(false);
  const [archivos, setArchivos] = useState([]);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [creado, setCreado] = useState(null);

  useEffect(() => {
    soporteService
      .formularioInterno()
      .then(setDatos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar el formulario.")),
      );
  }, []);

  useEffect(() => {
    if (persona) return undefined;
    const temporizador = setTimeout(() => {
      soporteService
        .personas(busqueda)
        .then(setPersonas)
        .catch(() => setPersonas([]));
    }, 250);
    return () => clearTimeout(temporizador);
  }, [busqueda, persona]);

  const faltan = persona?.faltan ?? [];

  function fijar(campo, valor) {
    setValores((actual) => ({
      ...actual,
      [campo]: valor,
      ...(campo === "categoria" ? { caso: "" } : {}),
    }));
  }

  async function enviar(evento) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const campos = {
        ...valores,
        solicitante: persona.id,
        canal,
        asignarme: asignarme ? "true" : "false",
      };
      if (faltan.includes("telefono")) campos.telefono = completar.telefono;
      if (faltan.includes("area")) campos.area = completar.area;
      if (faltan.includes("agencia")) campos.sede = completar.sede;
      delete campos.categoria;
      const propios = Object.fromEntries(
        (datos.campos ?? [])
          .filter((c) => !c.base && aplica(c, valores.categoria))
          .filter((c) => adicionales[c.clave] !== undefined)
          .map((c) => [c.clave, adicionales[c.clave]]),
      );
      campos.adicionales = JSON.stringify(propios);
      const ticket = await soporteService.registrar(campos, archivos);
      if (ticket.visible === false) setCreado(ticket);
      else navigate(`/admin/soporte/tickets/${ticket.id}`);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo registrar el ticket."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="soporte-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Registrar ticket</h2>
          <p className="mz-desc">
            Para lo que llega por teléfono, WhatsApp o en persona. Quien pidió
            recibe por correo su número y el enlace para seguirlo.
          </p>
        </div>
        <div className="mz-view-actions">
          <Link
            className="btn btn-outline-secondary btn-sm"
            to="/admin/soporte/bandeja"
          >
            Volver a la bandeja
          </Link>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {creado ? (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="check2-circle" />
          Ticket <strong className="mz-mono">{creado.numero}</strong>{" "}
          registrado; quedó en la cola.
        </div>
      ) : !datos ? (
        // Mientras llega el formulario, «Cargando…» y no una página vacía
        // (auditoría UX/UI, fase 2, 28/10/2026); su error ya sale arriba.
        <EstadoDeCarga cargando={!error} />
      ) : !persona ? (
        <section className="mz-card">
          <div className="mz-card-head">
            <h3>¿Quién pide?</h3>
          </div>
          <div className="mz-card-body">
            <input
              className="form-control"
              placeholder="Buscar por nombre o correo"
              aria-label="Buscar a la persona"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            <ul className="soporte-personas" aria-label="Personas registradas">
              {personas.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setPersona(p)}>
                    <strong>{p.nombre || p.correo}</strong>
                    <span className="mz-small mz-faint">
                      {[p.area?.nombre, p.agencia?.nombre, p.correo]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {p.faltan.length > 0 && (
                      <span className="mz-pill mz-pill--warn">
                        Datos incompletos
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {personas.length === 0 && (
                <li className="mz-small mz-faint p-2">Nadie con ese nombre.</li>
              )}
            </ul>
            <p className="mz-small mz-faint mb-0">
              Solo personas registradas. Si quien llama no tiene cuenta, pida a
              la administración que la cree.
            </p>
          </div>
        </section>
      ) : (
        <form className="mz-card" onSubmit={enviar}>
          <div className="mz-card-body row g-3">
            <div className="col-12">
              <div className="soporte-persona-elegida">
                <div className="mz-kv-grid">
                  <div className="mz-kv">
                    <span className="mz-kv-label">Pide</span>
                    {persona.nombre || persona.correo}
                  </div>
                  <div className="mz-kv">
                    <span className="mz-kv-label">Correo</span>
                    {persona.correo}
                  </div>
                  {persona.telefono && (
                    <div className="mz-kv">
                      <span className="mz-kv-label">Teléfono</span>
                      {persona.telefono}
                    </div>
                  )}
                  {persona.area && (
                    <div className="mz-kv">
                      <span className="mz-kv-label">Área</span>
                      {persona.area.nombre}
                    </div>
                  )}
                  {persona.agencia && (
                    <div className="mz-kv">
                      <span className="mz-kv-label">Agencia</span>
                      {persona.agencia.nombre}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-link btn-sm"
                  onClick={() => setPersona(null)}
                >
                  Cambiar de persona
                </button>
              </div>
            </div>
            {faltan.some((f) =>
              ["telefono", "area", "agencia"].includes(f),
            ) && (
              <div className="col-12">
                <div className="mz-alert mz-alert--warn mb-0" role="status">
                  <Icon name="exclamation-triangle" />A esta persona le faltan
                  datos: complételos para este ticket. Pídale que actualice «Mi
                  perfil».
                </div>
              </div>
            )}
            {faltan.includes("telefono") && (
              <div className="col-12 col-md-4">
                <label className="form-label" htmlFor="rt-telefono">
                  Teléfono
                </label>
                <input
                  id="rt-telefono"
                  className="form-control"
                  required
                  inputMode="tel"
                  value={completar.telefono}
                  onChange={(e) =>
                    setCompletar((v) => ({ ...v, telefono: e.target.value }))
                  }
                />
              </div>
            )}
            {faltan.includes("area") && (
              <div className="col-12 col-md-4">
                <label className="form-label" htmlFor="rt-area">
                  Área
                </label>
                <select
                  id="rt-area"
                  className="form-select"
                  required
                  value={completar.area}
                  onChange={(e) =>
                    setCompletar((v) => ({ ...v, area: e.target.value }))
                  }
                >
                  <option value="">Elija el área</option>
                  {datos.areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {faltan.includes("agencia") && (
              <div className="col-12 col-md-4">
                <label className="form-label" htmlFor="rt-sede">
                  Agencia
                </label>
                <select
                  id="rt-sede"
                  className="form-select"
                  required
                  value={completar.sede}
                  onChange={(e) =>
                    setCompletar((v) => ({ ...v, sede: e.target.value }))
                  }
                >
                  <option value="">Elija la agencia</option>
                  {datos.agencias.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="col-12 col-md-6">
              <label className="form-label" htmlFor="rt-canal">
                ¿Por dónde llegó?
              </label>
              <select
                id="rt-canal"
                className="form-select"
                value={canal}
                onChange={(e) => setCanal(e.target.value)}
              >
                {datos.canales.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </div>
            <CamposFormulario
              campos={datos.campos}
              datos={datos}
              valores={valores}
              onBase={fijar}
              adicionales={adicionales}
              onAdicional={(clave, valor) =>
                setAdicionales((actual) => ({ ...actual, [clave]: valor }))
              }
              prefijo="rt"
            />
            <div className="col-12">
              <label className="form-label" htmlFor="rt-adjuntos">
                Adjuntos (opcional, hasta 3)
              </label>
              <input
                id="rt-adjuntos"
                type="file"
                className="form-control"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
                onChange={(e) =>
                  setArchivos(Array.from(e.target.files ?? []).slice(0, 3))
                }
              />
            </div>
            {datos.soy_tecnico && (
              <div className="col-12">
                <div className="form-check">
                  <input
                    id="rt-asignarme"
                    type="checkbox"
                    className="form-check-input"
                    checked={asignarme}
                    onChange={(e) => setAsignarme(e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="rt-asignarme">
                    Me lo asigno (lo atiendo ahora)
                  </label>
                </div>
              </div>
            )}
            <div className="col-12 mz-actions justify-content-end">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={enviando}
              >
                {enviando ? "Registrando…" : "Registrar ticket"}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
