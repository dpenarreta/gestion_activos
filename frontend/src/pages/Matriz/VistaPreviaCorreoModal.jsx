import { useEffect, useState } from "react";

import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";

export const TIPOS_DE_AVISO = [
  ["recordatorio", "Recordatorio"],
  ["vencimiento", "Día del vencimiento"],
  ["escalamiento", "Escalamiento"],
];

/**
 * El correo tal como saldría, sin enviarlo (§12.5): para, asunto y el cuerpo
 * HTML. El HTML va en un `iframe` con `sandbox` vacío: es contenido generado
 * por el servidor, pero lleva textos que escribieron personas —el nombre de
 * la obligación— y no tiene por qué poder ejecutar nada en la aplicación.
 */
export function VistaPreviaCorreoModal({ periodo, onCerrar }) {
  const [tipo, setTipo] = useState("recordatorio");
  const [correo, setCorreo] = useState(null);
  const [error, setError] = useState(null);
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });

  useEffect(() => {
    let vigente = true;
    setCorreo(null);
    setError(null);
    matrizService
      .vistaPrevia(periodo.id, tipo)
      .then((datos) => vigente && setCorreo(datos))
      .catch(
        (err) =>
          vigente &&
          setError(mensajeDeError(err, "No se pudo armar la vista previa.")),
      );
    return () => {
      vigente = false;
    };
  }, [periodo.id, tipo]);

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={panelRef}
        className="mz-modal mz-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vista-previa-titulo"
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <div>
            <h3 id="vista-previa-titulo">Vista previa del correo</h3>
            <div className="mz-small mz-faint">
              {periodo.codigo} · {periodo.obligacion.nombre}
            </div>
          </div>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body">
          <div
            className="mz-chips mb-3"
            role="group"
            aria-label="Tipo de aviso"
          >
            {TIPOS_DE_AVISO.map(([valor, nombre]) => (
              <button
                key={valor}
                type="button"
                className={tipo === valor ? "is-on" : ""}
                aria-pressed={tipo === valor}
                onClick={() => setTipo(valor)}
              >
                {nombre}
              </button>
            ))}
          </div>
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {!correo && !error && <div className="mz-empty">Cargando…</div>}
          {correo && (
            <>
              <div className="mz-kv">
                <span className="mz-kv-label">Para</span>
                {correo.to.length > 0
                  ? correo.to.join(", ")
                  : "Nadie: ninguno de los destinatarios tiene correo."}
              </div>
              <div className="mz-kv mb-3">
                <span className="mz-kv-label">Asunto</span>
                <strong>{correo.subject}</strong>
              </div>
              <iframe
                className="matriz-correo"
                title="Cuerpo del correo"
                sandbox=""
                srcDoc={correo.html}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
