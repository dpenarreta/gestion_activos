import { useCallback, useEffect, useState } from "react";

import { chatService } from "../../../api/chatService";
import { useModalA11y } from "../../../hooks/useModalA11y";
import { mensajeDeError } from "../../../utils/errores";
import { Icon } from "../../common/Icon/Icon";
import "./Presencia.css";

/** Los estados que se eligen (22/10/2026), con su ícono. */
export const ESTADOS = [
  ["disponible", "Disponible", "check-circle"],
  ["almuerzo", "Almuerzo", "cup-hot"],
  ["reunion", "En reunión", "people"],
  ["no_disponible", "No disponible", "dash-circle"],
  ["vacaciones", "Vacaciones", "airplane"],
];

/** AAAA-MM-DD → DD/MM/AAAA. */
function fechaCorta(iso) {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** HH:MM de hoy → la fecha y hora (ISO) para «hasta»; si ya pasó, vacío. */
function horaDeHoy(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  const fecha = new Date();
  fecha.setHours(h, m, 0, 0);
  return fecha.toISOString();
}

/** Si ahora cae dentro de su horario de almuerzo. */
export function enHoraDeAlmuerzo(inicio, minutos, ahora = new Date()) {
  if (!inicio) return false;
  const [h, m] = inicio.split(":").map(Number);
  const desde = h * 60 + m;
  const actual = ahora.getHours() * 60 + ahora.getMinutes();
  return actual >= desde && actual < desde + (minutos || 60);
}

/** La ventana para cambiar el estado, el horario de almuerzo o las
 * vacaciones. */
function VentanaEstado({ datos, onGuardado, onCerrar }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const sugeridas = datos.vacaciones_sugeridas;
  const [estado, setEstado] = useState(
    datos.vigente?.clave === "vacaciones" ? "vacaciones" : datos.estado,
  );
  const [mensaje, setMensaje] = useState(
    datos.vigente?.clave === "vacaciones"
      ? datos.mensaje_vacaciones
      : datos.mensaje,
  );
  const [hasta, setHasta] = useState("");
  const [inicio, setInicio] = useState(datos.almuerzo_inicio || "");
  const [minutos, setMinutos] = useState(datos.almuerzo_minutos || 60);
  const [desde, setDesde] = useState(
    datos.vacaciones_desde ?? sugeridas?.desde ?? "",
  );
  const [regreso, setRegreso] = useState(
    datos.vacaciones_hasta ?? sugeridas?.hasta ?? "",
  );
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(cambios) {
    setGuardando(true);
    setError(null);
    try {
      onGuardado(await chatService.guardarEstado(cambios));
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar su estado."));
    } finally {
      setGuardando(false);
    }
  }

  function enviar(evento) {
    evento.preventDefault();
    const cambios = {
      estado,
      mensaje,
      almuerzo_inicio: inicio || null,
      almuerzo_minutos: Number(minutos) || 60,
    };
    if (estado === "vacaciones") {
      cambios.vacaciones_desde = desde || null;
      cambios.vacaciones_hasta = regreso || null;
    }
    if (estado === "reunion" || estado === "no_disponible")
      cambios.hasta = horaDeHoy(hasta);
    guardar(cambios);
  }

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Mi estado en el chat"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>Mi estado</h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <form className="mz-panel-body mz-stack" onSubmit={enviar}>
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          <fieldset className="mi-estado__opciones">
            <legend className="mz-small mb-1">¿Cómo está?</legend>
            {ESTADOS.map(([id, nombre, icono]) => (
              <label
                key={id}
                className={`mi-estado__opcion mi-estado__opcion--${id}${
                  estado === id ? " is-active" : ""
                }`}
              >
                <input
                  type="radio"
                  name="mi-estado"
                  className="visually-hidden"
                  checked={estado === id}
                  onChange={() => setEstado(id)}
                />
                <Icon name={icono} /> {nombre}
              </label>
            ))}
          </fieldset>

          {estado === "almuerzo" && (
            <p className="mz-small mb-0">
              Durará {minutos} minutos desde ahora; después vuelve solo a
              «Disponible». Quien le escriba sabrá que está en almuerzo.
            </p>
          )}
          {(estado === "reunion" || estado === "no_disponible") && (
            <div>
              <label className="form-label mz-small" htmlFor="estado-hasta">
                Hasta (opcional)
              </label>
              <input
                id="estado-hasta"
                type="time"
                className="form-control form-control-sm"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
              <small className="mz-faint">
                Sin hora, dura hasta que lo cambie.
              </small>
            </div>
          )}
          {estado === "vacaciones" && (
            <div className="mz-stack">
              {sugeridas && (
                <div className="mz-alert mz-alert--info" role="status">
                  <Icon name="calendar-check" />
                  <span>
                    Fechas de su solicitud de vacaciones{" "}
                    {sugeridas.aprobada
                      ? "aprobada"
                      : "pendiente de aprobación"}
                    : del {fechaCorta(sugeridas.desde)} al{" "}
                    {fechaCorta(sugeridas.hasta)}. Confírmelas o cámbielas.
                  </span>
                </div>
              )}
              <div className="row g-2">
                <div className="col-6">
                  <label className="form-label mz-small" htmlFor="vac-desde">
                    Desde
                  </label>
                  <input
                    id="vac-desde"
                    type="date"
                    className="form-control form-control-sm"
                    required
                    value={desde ?? ""}
                    onChange={(e) => setDesde(e.target.value)}
                  />
                </div>
                <div className="col-6">
                  <label className="form-label mz-small" htmlFor="vac-hasta">
                    Hasta
                  </label>
                  <input
                    id="vac-hasta"
                    type="date"
                    className="form-control form-control-sm"
                    required
                    min={desde || undefined}
                    value={regreso ?? ""}
                    onChange={(e) => setRegreso(e.target.value)}
                  />
                </div>
              </div>
              <small className="mz-faint">
                Antes de salir, quien le escriba verá cuándo estará de
                vacaciones; mientras duren, que está de vacaciones.
              </small>
              {datos.vacaciones_desde && (
                <button
                  type="button"
                  className="btn btn-link btn-sm text-danger p-0 align-self-start"
                  disabled={guardando}
                  onClick={() => guardar({ quitar_vacaciones: true })}
                >
                  Quitar mis vacaciones
                </button>
              )}
            </div>
          )}
          {estado !== "disponible" && (
            <div>
              <label className="form-label mz-small" htmlFor="estado-mensaje">
                Mensaje para quien le escriba (opcional)
              </label>
              <input
                id="estado-mensaje"
                className="form-control form-control-sm"
                maxLength={140}
                placeholder={
                  estado === "vacaciones"
                    ? "Para lo urgente, escriba a…"
                    : "Vuelvo pronto"
                }
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
              />
            </div>
          )}

          <details className="mi-estado__almuerzo" open={estado === "almuerzo"}>
            <summary className="mz-small">Mi horario de almuerzo</summary>
            <div className="row g-2 mt-1">
              <div className="col-6">
                <label className="form-label mz-small" htmlFor="alm-inicio">
                  Salgo a las
                </label>
                <input
                  id="alm-inicio"
                  type="time"
                  className="form-control form-control-sm"
                  value={inicio}
                  onChange={(e) => setInicio(e.target.value)}
                />
              </div>
              <div className="col-6">
                <label className="form-label mz-small" htmlFor="alm-minutos">
                  Minutos
                </label>
                <input
                  id="alm-minutos"
                  type="number"
                  min={10}
                  max={180}
                  step={5}
                  className="form-control form-control-sm"
                  value={minutos}
                  onChange={(e) => setMinutos(e.target.value)}
                />
              </div>
            </div>
            <small className="mz-faint">
              A esa hora el chat le ofrecerá marcar que salió a almorzar.
            </small>
          </details>

          <div className="mz-actions justify-content-end">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onCerrar}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={guardando}
            >
              {guardando
                ? "Guardando…"
                : estado === "almuerzo"
                  ? "Salgo a almorzar"
                  : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Mi estado en el chat (22/10/2026): el botón con cómo estoy y, a la hora de
 * mi almuerzo, el atajo para marcar que salí. Los demás lo ven junto a mi
 * nombre y al escribirme.
 */
export function MiEstado() {
  const [datos, setDatos] = useState(null);
  const [abierta, setAbierta] = useState(false);
  const [ahora, setAhora] = useState(() => new Date());

  const cargar = useCallback(() => {
    Promise.resolve()
      .then(() => chatService.miEstado())
      .then((d) => d && setDatos(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    cargar();
    // Cada minuto: el almuerzo y las reuniones terminan solos.
    const intervalo = setInterval(() => {
      setAhora(new Date());
      cargar();
    }, 60_000);
    return () => clearInterval(intervalo);
  }, [cargar]);

  if (!datos) return null;
  const vigente = datos.vigente;
  const clave =
    vigente && vigente.clave !== "vacaciones_proximas"
      ? vigente.clave
      : "disponible";
  const [, nombre, icono] = ESTADOS.find(([id]) => id === clave) ?? ESTADOS[0];
  const ofrecerAlmuerzo =
    clave === "disponible" &&
    enHoraDeAlmuerzo(datos.almuerzo_inicio, datos.almuerzo_minutos, ahora);

  return (
    <span className="mi-estado">
      <button
        type="button"
        className={`mi-estado__boton mi-estado__boton--${clave}`}
        title={vigente?.detalle}
        onClick={() => setAbierta(true)}
      >
        <Icon name={icono} /> {nombre}
        <Icon name="chevron-down" />
      </button>
      {ofrecerAlmuerzo && (
        <button
          type="button"
          className="btn btn-link btn-sm p-0 ms-1"
          onClick={() =>
            chatService
              .guardarEstado({ estado: "almuerzo" })
              .then(setDatos)
              .catch(() => {})
          }
        >
          <Icon name="cup-hot" /> Salir a almorzar
        </button>
      )}
      {abierta && (
        <VentanaEstado
          datos={datos}
          onGuardado={(d) => {
            setDatos(d);
            setAbierta(false);
          }}
          onCerrar={() => setAbierta(false)}
        />
      )}
    </span>
  );
}
