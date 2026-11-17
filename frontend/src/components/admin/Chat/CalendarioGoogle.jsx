import { useEffect, useState } from "react";

import { chatService } from "../../../api/chatService";
import { formatearFecha } from "../../../utils/formato";
import { mensajeDeError } from "../../../utils/errores";
import { confirmar } from "../../common/Confirmar/confirmar";
import { Icon } from "../../common/Icon/Icon";

/**
 * «Mi calendario de Google» en Mi estado (17/11/2026, decisión del usuario).
 *
 * Es voluntario: quien lo conecta ve su estado pasar solo a «En reunión»
 * mientras tiene una reunión en su calendario, y volver al terminar. Google
 * le pide aceptar solo «ver su disponibilidad»: la intranet no ve títulos,
 * invitados ni el contenido de sus reuniones, ni lee su correo. No aparece si
 * el servidor no tiene Google configurado o si su rol no tiene el permiso.
 */
export function CalendarioGoogle() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vigente = true;
    // Si no se puede consultar (sin permiso, sin red), no aparece.
    Promise.resolve()
      .then(() => chatService.calendario())
      .then((respuesta) => vigente && setDatos(respuesta))
      .catch(() => vigente && setDatos(null));
    return () => {
      vigente = false;
    };
  }, []);

  if (!datos || !datos.disponible) return null;

  async function conectar() {
    setError(null);
    setOcupado(true);
    try {
      const { url } = await chatService.conectarCalendario();
      window.location.assign(url);
    } catch (err) {
      setError(
        mensajeDeError(err, "No se pudo iniciar la conexión con Google."),
      );
      setOcupado(false);
    }
  }

  async function desconectar() {
    const si = await confirmar({
      titulo: "¿Desconectar su calendario de Google?",
      mensaje:
        "Su estado dejará de cambiar solo durante las reuniones. Puede volver a conectarlo cuando quiera.",
      accion: "Desconectar",
    });
    if (!si) return;
    setError(null);
    setOcupado(true);
    try {
      setDatos(await chatService.desconectarCalendario());
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo desconectar el calendario."));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <details className="mi-estado__almuerzo" open={!datos.conectado}>
      <summary className="mz-small">
        <Icon name="calendar-event" /> Mi calendario de Google
      </summary>
      <div className="mt-1">
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        {datos.conectado && datos.error ? (
          <>
            <p className="mz-small text-danger mb-2">{datos.error}</p>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={conectar}
              disabled={ocupado}
            >
              Volver a conectar
            </button>
          </>
        ) : datos.conectado ? (
          <>
            <p className="mz-small mb-2">
              <Icon name="check2-circle" /> Conectado desde el{" "}
              {formatearFecha(datos.conectado_en)}. Durante sus reuniones su
              estado pasa solo a «En reunión» y vuelve al terminar (puede tardar
              hasta 5 minutos).
            </p>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={desconectar}
              disabled={ocupado}
            >
              Desconectar
            </button>
          </>
        ) : (
          <>
            <p className="mz-small mb-2">
              Conéctelo y, mientras tenga una reunión en su calendario, su
              estado pasará solo a «En reunión». Google le pedirá aceptar solo
              «ver su disponibilidad»: la intranet no ve los títulos, los
              invitados ni el contenido de sus reuniones, ni lee su correo.
            </p>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={conectar}
              disabled={ocupado}
            >
              <Icon name="google" /> Conectar mi calendario de Google
            </button>
          </>
        )}
      </div>
    </details>
  );
}
