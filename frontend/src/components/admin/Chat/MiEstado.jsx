import { useCallback, useEffect, useRef, useState } from "react";

import { chatService } from "../../../api/chatService";
import { useModalA11y } from "../../../hooks/useModalA11y";
import { erroresPorCampo, mensajeDeError } from "../../../utils/errores";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../common/Campo/Campo";
import {
  ReemplazoEnAusencia,
  YA_QUEDO_GUARDADO,
  useReemplazoEnAusencia,
} from "../../common/Ausencia/ReemplazoEnAusencia";
import { Icon } from "../../common/Icon/Icon";
import "./Presencia.css";

/** Los estados que se eligen (22/10/2026), con su ícono. */
export const ESTADOS = [
  ["disponible", "Disponible", "check-circle"],
  ["almuerzo", "Almuerzo", "cup-hot"],
  ["reunion", "En reunión", "people"],
  ["no_disponible", "No disponible", "dash-circle"],
  ["vacaciones", "Vacaciones", "airplane"],
  // Uno o varios días fuera, con su último día obligatorio; sus aprobaciones
  // pasan a su reemplazo (11/11/2026, US-001).
  ["fuera_oficina", "Fuera de la oficina", "box-arrow-right"],
];

/** Los estados que son una ausencia: piden quién aprueba por usted. */
const AUSENCIAS = ["vacaciones", "fuera_oficina"];

/** Hasta cuántos días adelante se puede marcar «Fuera de la oficina»: el
 * servidor pone el mismo tope de 6 meses (revisión de US-001, 11/11/2026). */
const DIAS_MAXIMOS_FUERA = 180;

const dos = (n) => String(n).padStart(2, "0");

/** La fecha local (AAAA-MM-DD) de un momento ISO, o de hoy. Una fecha sola
 * (AAAA-MM-DD) se deja como viene: `new Date` la leería en UTC y en Ecuador
 * caería el día anterior. */
function fechaLocal(iso) {
  if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const fecha = iso ? new Date(iso) : new Date();
  if (Number.isNaN(fecha.getTime())) return "";
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

/** Hoy más `dias`, como AAAA-MM-DD local. */
function enDias(dias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return fechaLocal(fecha.toISOString());
}

/** Lo que falta o está mal en el último día de «Fuera de la oficina», o
 * null. El servidor lo vuelve a revisar (400 en `hasta`). */
export function errorDeRegreso(
  regreso,
  hoy = fechaLocal(),
  maximo = enDias(DIAS_MAXIMOS_FUERA),
) {
  if (!regreso) return "Indique hasta cuándo estará fuera de la oficina.";
  if (regreso < hoy) return "Elija como último día hoy o una fecha posterior.";
  if (regreso > maximo)
    return "Elija una fecha dentro de los próximos 6 meses.";
  return null;
}

/** Lo que falta o está mal en las fechas de las vacaciones. */
function erroresDeVacaciones(desde, hasta) {
  const errores = {};
  if (!desde)
    errores.vacaciones_desde = "Indique desde cuándo estará de vacaciones.";
  if (!hasta)
    errores.vacaciones_hasta = "Indique hasta cuándo estará de vacaciones.";
  else if (desde && hasta < desde)
    errores.vacaciones_hasta = "«Hasta» no puede ser antes de «Desde».";
  return errores;
}

/** AAAA-MM-DD → DD/MM/AAAA. */
function fechaCorta(iso) {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Una fecha o un momento → DD/MM (local). */
function diaYMes(valor) {
  const fecha = fechaLocal(valor);
  if (!fecha) return "";
  const [, m, d] = fecha.split("-");
  return `${d}/${m}`;
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
  const vigente = datos.vigente;
  // Si lo que rige es una ausencia (también la de un permiso aprobado, que
  // no cambió su estado), la ventana abre en ella.
  const [estado, setEstado] = useState(
    AUSENCIAS.includes(vigente?.clave) ? vigente.clave : datos.estado,
  );
  // «Fuera de la oficina» por un permiso aprobado: no lo eligió la persona,
  // lo pone el sistema mientras dure el permiso (US-001, CA-2).
  const fueraPorPermiso =
    vigente?.clave === "fuera_oficina" && datos.estado !== "fuera_oficina";
  // Si eligió una opción a mano (también volver a pulsar «Fuera de la
  // oficina»). Mientras no lo haga, la ausencia del permiso no se toca: no
  // se pide fecha ni se manda `estado` (revisión UX/UI, ronda 2).
  const [eligio, setEligio] = useState(false);
  // El último día fuera: se manda la fecha sola y el servidor la toma hasta
  // el final de ese día.
  const [regresoFuera, setRegresoFuera] = useState(
    datos.estado === "fuera_oficina" && datos.hasta
      ? fechaLocal(datos.hasta)
      : "",
  );
  const [errores, setErrores] = useState({});
  const ausente = AUSENCIAS.includes(estado);
  const porPermiso = fueraPorPermiso && !eligio && estado === "fuera_oficina";
  const reemplazo = useReemplazoEnAusencia({ activo: ausente });
  const formulario = useRef(null);
  const [mensaje, setMensaje] = useState(
    vigente?.clave === "vacaciones" ? datos.mensaje_vacaciones : datos.mensaje,
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

  const limpiarError = (campo) =>
    setErrores((actuales) => ({ ...actuales, [campo]: undefined }));

  async function guardar(cambios, conReemplazo = false) {
    setGuardando(true);
    setError(null);
    setErrores({});
    // Primero quién aprueba por usted: al guardar el estado, lo pendiente
    // pasa a esa persona y tiene que encontrarla ya elegida.
    let reemplazoGuardado = false;
    if (conReemplazo) {
      const resultado = await reemplazo.guardar();
      if (!resultado.ok) {
        setError(resultado.mensaje);
        setGuardando(false);
        enfocarPrimerError(formulario.current);
        return;
      }
      reemplazoGuardado = resultado.guardado;
    }
    try {
      onGuardado(await chatService.guardarEstado(cambios));
    } catch (err) {
      const campos = erroresPorCampo(err);
      setErrores(campos);
      const base =
        campos.hasta || campos.vacaciones_desde || campos.vacaciones_hasta
          ? "Revise las fechas marcadas."
          : mensajeDeError(err, "No se pudo guardar su estado.");
      setError(reemplazoGuardado ? `${base} ${YA_QUEDO_GUARDADO}` : base);
      enfocarPrimerError(formulario.current);
    } finally {
      setGuardando(false);
    }
  }

  function enviar(evento) {
    evento.preventDefault();
    // Lo que se sabe sin ir al servidor: el error va junto a su campo y el
    // foco al primero.
    let propios = {};
    if (estado === "fuera_oficina" && !porPermiso) {
      const deRegreso = errorDeRegreso(regresoFuera);
      if (deRegreso) propios.hasta = deRegreso;
    }
    if (estado === "vacaciones") propios = erroresDeVacaciones(desde, regreso);
    const deReemplazo = ausente && reemplazo.validar();
    if (Object.keys(propios).length || deReemplazo) {
      setError(null);
      setErrores(propios);
      enfocarPrimerError(formulario.current);
      return;
    }
    const almuerzo = {
      almuerzo_inicio: inicio || null,
      almuerzo_minutos: Number(minutos) || 60,
    };
    // Con la ausencia del permiso sin tocar: solo el almuerzo y, antes, el
    // reemplazo.
    if (porPermiso) {
      guardar(almuerzo, true);
      return;
    }
    const cambios = { estado, mensaje, ...almuerzo };
    if (estado === "vacaciones") {
      cambios.vacaciones_desde = desde || null;
      cambios.vacaciones_hasta = regreso || null;
    }
    if (estado === "reunion" || estado === "no_disponible")
      cambios.hasta = horaDeHoy(hasta);
    if (estado === "fuera_oficina") cambios.hasta = regresoFuera;
    guardar(cambios, ausente);
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
        <form
          ref={formulario}
          className="mz-panel-body mz-stack mi-estado__formulario"
          onSubmit={enviar}
          noValidate
        >
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
                  onChange={() => {
                    setEstado(id);
                    setEligio(true);
                    setErrores({});
                  }}
                  // Volver a pulsar la opción ya marcada no la cambia, pero
                  // dice que quiere fijar su propio «Fuera de la oficina».
                  onClick={() => setEligio(true)}
                />
                <Icon name={icono} /> {nombre}
              </label>
            ))}
          </fieldset>
          {ausente && <LeyendaObligatorios />}

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
                <Campo
                  id="vac-desde"
                  etiqueta="Desde"
                  obligatorio
                  error={errores.vacaciones_desde}
                  className="col-6"
                >
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    value={desde ?? ""}
                    onChange={(e) => {
                      setDesde(e.target.value);
                      limpiarError("vacaciones_desde");
                    }}
                  />
                </Campo>
                <Campo
                  id="vac-hasta"
                  etiqueta="Hasta"
                  obligatorio
                  error={errores.vacaciones_hasta}
                  className="col-6"
                >
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    min={desde || undefined}
                    value={regreso ?? ""}
                    onChange={(e) => {
                      setRegreso(e.target.value);
                      limpiarError("vacaciones_hasta");
                    }}
                  />
                </Campo>
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
          {estado === "fuera_oficina" && fueraPorPermiso && (
            <div className="mz-alert mz-alert--info" role="note">
              <Icon name="calendar-check" />
              <span>
                Tiene un permiso aprobado hasta el {diaYMes(vigente.hasta)}:
                mientras dure, quien le escriba verá «Fuera de la oficina».
              </span>
            </div>
          )}
          {porPermiso && (
            <p className="mz-small mb-0">
              <strong>Hasta el {diaYMes(vigente.hasta)}</strong>, por su permiso
              aprobado.
            </p>
          )}
          {estado === "fuera_oficina" && !porPermiso && (
            // El backend toma la fecha como el último día fuera: vale hasta
            // las 23:59 de ese día (revisión UX/UI de US-001, 11/11/2026).
            <Campo
              id="fuera-regreso"
              etiqueta="Último día fuera de la oficina"
              obligatorio
              ayuda="Desde el día siguiente vuelve a «Disponible». Quien le escriba verá «Fuera de la oficina hasta el…»."
              error={errores.hasta}
            >
              <input
                type="date"
                className="form-control form-control-sm"
                min={fechaLocal()}
                max={enDias(DIAS_MAXIMOS_FUERA)}
                value={regresoFuera}
                onChange={(e) => {
                  setRegresoFuera(e.target.value);
                  limpiarError("hasta");
                }}
              />
            </Campo>
          )}
          {/* Con la ausencia del permiso no se guarda un mensaje propio:
              para dejarlo, se elige «Fuera de la oficina» a mano. */}
          {estado !== "disponible" && !porPermiso && (
            <div>
              <label className="form-label mz-small" htmlFor="estado-mensaje">
                Mensaje para quien le escriba (opcional)
              </label>
              <input
                id="estado-mensaje"
                className="form-control form-control-sm"
                maxLength={140}
                placeholder={
                  ausente ? "Para lo urgente, escriba a…" : "Vuelvo pronto"
                }
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
              />
            </div>
          )}
          {/* Después de la fecha y el mensaje, separado y con su
              encabezado: quién aprueba por usted. */}
          {ausente && (
            <ReemplazoEnAusencia
              reemplazo={reemplazo}
              deshabilitado={guardando}
            />
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
        {/* El detalle (hasta cuándo) también para teclado y lector: el
            `title` no les llega. */}
        {vigente?.detalle && (
          <span className="visually-hidden">: {vigente.detalle}</span>
        )}
        <Icon name="chevron-down" />
      </button>
      {ofrecerAlmuerzo && (
        <button
          type="button"
          className="btn btn-link btn-sm ms-1 mi-estado__atajo"
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
