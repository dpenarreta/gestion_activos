import { useEffect, useState } from "react";

import { textosLegalesService } from "../../../api/textosLegalesService";
import { Icon } from "../../../components/common/Icon/Icon";
import { mensajeDeError } from "../../../utils/errores";
import { formatearFecha } from "../../../utils/formato";

/** Un texto con su editor: guardar sube la versión si el texto cambió. */
function EditorTexto({ inicial }) {
  const [vigente, setVigente] = useState(inicial);
  const [texto, setTexto] = useState(inicial.texto);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);
  const cambiado = texto.trim() !== vigente.texto;

  async function guardar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    setMensaje(null);
    try {
      const nuevo = await textosLegalesService.guardar(vigente.clave, texto);
      setMensaje(
        nuevo.version !== vigente.version
          ? `Guardado como versión ${nuevo.version}.`
          : "No hubo cambios.",
      );
      setVigente(nuevo);
      setTexto(nuevo.texto);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el texto."));
    } finally {
      setGuardando(false);
    }
  }

  const id = `texto-${vigente.clave}`;
  return (
    <section className="mz-card" aria-labelledby={`${id}-titulo`}>
      <form className="mz-card-body mz-stack" onSubmit={guardar}>
        <div>
          <h3 id={`${id}-titulo`} className="h6 mb-1">
            {vigente.nombre}
          </h3>
          <p className="mz-small mz-faint mb-0">{vigente.descripcion}</p>
        </div>
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        {mensaje && (
          <div className="mz-alert mz-alert--ok" role="status">
            <Icon name="check-circle" />
            {mensaje}
          </div>
        )}
        <div>
          <label className="form-label" htmlFor={id}>
            Texto que acepta la persona
          </label>
          <textarea
            id={id}
            className="form-control"
            rows={5}
            maxLength={4000}
            required
            minLength={20}
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setMensaje(null);
            }}
          />
          <div className="form-text">
            Versión {vigente.version} · actualizado el{" "}
            {formatearFecha(vigente.actualizado, true)}. Cada aceptación guarda
            la fecha y hora, la IP, el texto exacto y su versión.
          </div>
        </div>
        {cambiado && (
          <div className="mz-alert mz-alert--warn" role="note">
            <Icon name="exclamation-triangle" />
            Al guardar, el texto pasa a la versión {vigente.version + 1}. Quien
            aceptó la anterior deberá aceptarlo de nuevo la próxima vez que
            guarde su teléfono; su constancia anterior se conserva.
          </div>
        )}
        <div className="mz-actions justify-content-end">
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={!cambiado || guardando}
          >
            {guardando ? "Guardando…" : "Guardar texto"}
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * Configuración → Textos legales (`configuracion.textos_legales`, 26/10/2026):
 * los textos de tratamiento de datos personales que aceptan las personas, como
 * la autorización para guardar su teléfono. Son parametrizables y cada cambio
 * queda en la auditoría.
 */
export function TextosLegalesPage() {
  const [textos, setTextos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    textosLegalesService
      .listar()
      .then(setTextos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar los textos.")),
      );
  }, []);

  return (
    <div className="mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Textos legales</h2>
          <p className="mz-desc">
            Los textos de tratamiento de datos personales que aceptan las
            personas (Ley Orgánica de Protección de Datos Personales). Cada
            cambio crea una versión nueva y queda en la auditoría.
          </p>
        </div>
      </div>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {(textos ?? []).map((t) => (
        <EditorTexto key={t.clave} inicial={t} />
      ))}
    </div>
  );
}
