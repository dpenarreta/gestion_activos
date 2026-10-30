import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import {
  Campo,
  enfocarPrimerError,
  LeyendaObligatorios,
} from "../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
import {
  aplica,
  CamposFormulario,
  validarCampos,
} from "./Publico/CamposFormulario";
import "./Soporte.css";

/** Cuántos archivos acepta el servidor por ticket. */
const MAX_ADJUNTOS = 3;

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
  const [omitidos, setOmitidos] = useState(0);
  const [error, setError] = useState(null);
  const [errorEnvio, setErrorEnvio] = useState(null);
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const formulario = useRef(null);
  const avisoError = useRef(null);
  const [creado, setCreado] = useState(null);
  const [buscando, setBuscando] = useState(true);

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
    // Mientras busca dice «Buscando…» (antes, «Nadie con ese nombre»).
    setBuscando(true);
    const temporizador = setTimeout(() => {
      soporteService
        .personas(busqueda)
        .then(setPersonas)
        .catch(() => setPersonas([]))
        .finally(() => setBuscando(false));
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

  /* Como en «Nuevo ticket» (auditoría UX/UI, 30/10/2026): lo que falta se
   * marca bajo cada campo y el error del servidor sale junto al botón; antes
   * se enviaba vacío y el error genérico salía arriba. */
  async function enviar(evento) {
    evento.preventDefault();
    setErrorEnvio(null);
    const propiosFaltan = validarCampos(datos.campos, valores, adicionales);
    if (faltan.includes("telefono") && !completar.telefono.trim())
      propiosFaltan.telefono = "Escriba el teléfono de la persona.";
    if (faltan.includes("area") && !completar.area)
      propiosFaltan.area = "Elija el área de la persona.";
    if (faltan.includes("agencia") && !completar.sede)
      propiosFaltan.sede = "Elija la agencia de la persona.";
    setErrores(propiosFaltan);
    if (Object.keys(propiosFaltan).length) {
      enfocarPrimerError(formulario.current);
      return;
    }
    setEnviando(true);
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
      const delServidor = erroresPorCampo(err);
      setErrores(delServidor);
      setErrorEnvio(
        Object.keys(delServidor).length
          ? "Revise los campos marcados."
          : mensajeDeError(err, "No se pudo registrar el ticket."),
      );
      requestAnimationFrame(() =>
        Object.keys(delServidor).length
          ? enfocarPrimerError(formulario.current)
          : avisoError.current?.focus(),
      );
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
        // Con salida: registrar otro o volver (antes, un aviso sin más).
        <section className="mz-card">
          <div className="mz-card-body">
            <div className="mz-alert mz-alert--ok" role="status">
              <Icon name="check2-circle" />
              <span>
                Ticket <strong className="mz-mono">{creado.numero}</strong>{" "}
                registrado; quedó en la cola. Quien lo pidió recibe el número
                por correo.
              </span>
            </div>
            <div className="mz-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setCreado(null);
                  setPersona(null);
                  setBusqueda("");
                  setValores((actual) =>
                    Object.fromEntries(
                      Object.keys(actual).map((clave) => [clave, ""]),
                    ),
                  );
                  setAdicionales({});
                  setArchivos([]);
                  setOmitidos(0);
                }}
              >
                Registrar otro
              </button>
              <Link
                className="btn btn-outline-secondary"
                to="/admin/soporte/bandeja"
              >
                Volver a la bandeja
              </Link>
            </div>
          </div>
        </section>
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
            <label className="form-label" htmlFor="rt-buscar">
              Busque a la persona por su nombre o correo
            </label>
            <input
              id="rt-buscar"
              type="search"
              className="form-control"
              placeholder="Ej.: Carla o carla@grupolaar.com"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
            <p className="visually-hidden" role="status">
              {buscando
                ? "Buscando…"
                : `${personas.length} ${personas.length === 1 ? "persona" : "personas"}`}
            </p>
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
                <li className="mz-small mz-faint p-2">
                  {buscando ? "Buscando…" : "Nadie con ese nombre o correo."}
                </li>
              )}
            </ul>
            <p className="mz-small mz-faint mb-0">
              Solo personas registradas. Si quien llama no tiene cuenta, pida a
              la administración que la cree.
            </p>
          </div>
        </section>
      ) : (
        <form ref={formulario} className="mz-card" onSubmit={enviar} noValidate>
          <div className="mz-card-body row g-3">
            <div className="col-12">
              <LeyendaObligatorios />
            </div>
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
              <Campo
                id="rt-telefono"
                etiqueta="Teléfono"
                obligatorio
                error={errores.telefono}
                className="col-12 col-md-4"
              >
                <input
                  className="form-control"
                  inputMode="tel"
                  value={completar.telefono}
                  onChange={(e) =>
                    setCompletar((v) => ({ ...v, telefono: e.target.value }))
                  }
                />
              </Campo>
            )}
            {faltan.includes("area") && (
              <Campo
                id="rt-area"
                etiqueta="Área"
                obligatorio
                error={errores.area}
                className="col-12 col-md-4"
              >
                <select
                  className="form-select"
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
              </Campo>
            )}
            {faltan.includes("agencia") && (
              <Campo
                id="rt-sede"
                etiqueta="Agencia"
                obligatorio
                error={errores.sede}
                className="col-12 col-md-4"
              >
                <select
                  className="form-select"
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
              </Campo>
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
              tercera
              campos={datos.campos}
              datos={datos}
              valores={valores}
              onBase={fijar}
              errores={errores}
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
                aria-describedby={
                  omitidos > 0 ? "rt-adjuntos-aviso" : undefined
                }
                onChange={(e) => {
                  const elegidos = Array.from(e.target.files ?? []);
                  setArchivos(elegidos.slice(0, MAX_ADJUNTOS));
                  setOmitidos(Math.max(0, elegidos.length - MAX_ADJUNTOS));
                }}
              />
              {/* Antes se recortaba a tres en silencio (revisión final
                  UX/UI, 28/10/2026). */}
              {omitidos > 0 && (
                <div
                  id="rt-adjuntos-aviso"
                  className="mz-small mz-faint mt-1"
                  role="status"
                >
                  Máx. {MAX_ADJUNTOS} archivos; se omitieron {omitidos}.
                </div>
              )}
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
            {errorEnvio && (
              <div className="col-12">
                <div
                  ref={avisoError}
                  className="mz-alert mz-alert--bad mb-0"
                  role="alert"
                  tabIndex={-1}
                >
                  <Icon name="x-octagon" />
                  {errorEnvio}
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
