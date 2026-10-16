import { useEffect, useState } from "react";

import { correoService } from "../../../api/correoService";
import { Icon } from "../../../components/common/Icon/Icon";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";

function Dato({ etiqueta, children }) {
  return (
    <div className="mz-kv">
      <span className="mz-kv-label">{etiqueta}</span>
      {children ?? <span className="mz-faint">—</span>}
    </div>
  );
}

/**
 * Configuración → Notificaciones → Correo del sistema.
 *
 * Todos los avisos —resumen de alertas, recordatorios de la Matriz,
 * restablecer la contraseña— salen por el mismo servidor. Aquí se ve cuál y se
 * comprueba que funciona. Se configura en el servidor (`.env`), no aquí: la
 * clave del buzón no pasa por una pantalla.
 */
export function CorreoDelSistemaPage() {
  const puedeProbar = usePermission("configuracion.editar");
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState(null);
  const [prueba, setPrueba] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    correoService
      .estado()
      .then(setEstado)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo leer la configuración.")),
      );
  }, []);

  async function probar() {
    setEnviando(true);
    setPrueba(null);
    try {
      const respuesta = await correoService.enviarPrueba();
      setPrueba({ ok: !respuesta.simulado, texto: respuesta.detail });
    } catch (err) {
      const motivo = err?.response?.data?.motivo;
      setPrueba({
        ok: false,
        texto:
          mensajeDeError(err, "No se pudo enviar el correo de prueba.") +
          (motivo ? ` Motivo: ${motivo}` : ""),
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>Correo del sistema</h2>
          <p className="mz-desc">
            Por dónde salen todos los avisos: resumen de alertas, recordatorios
            de la Matriz y restablecimiento de contraseñas.
          </p>
        </div>
        {puedeProbar && (
          <div className="mz-view-actions">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={probar}
              disabled={enviando}
            >
              <Icon name="envelope" />{" "}
              {enviando ? "Enviando…" : "Enviar una prueba a mi correo"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {prueba && (
        <div
          className={`mz-alert ${prueba.ok ? "mz-alert--info" : "mz-alert--bad"}`}
          role={prueba.ok ? "status" : "alert"}
        >
          <Icon name={prueba.ok ? "check2-circle" : "x-octagon"} />
          {prueba.texto}
        </div>
      )}
      {!estado && !error && <div className="mz-empty">Cargando…</div>}

      {estado && (
        <section className="mz-card">
          <div className="mz-card-body">
            {!estado.envia_de_verdad && (
              <div className="mz-alert mz-alert--warn" role="note">
                <Icon name="exclamation-triangle" />
                Modo «{estado.backend}»: los avisos se dan por enviados pero no
                llegan a ningún buzón.
              </div>
            )}
            <div className="mz-field-grid">
              <Dato etiqueta="Modo">{estado.backend}</Dato>
              <Dato etiqueta="Remitente">{estado.remitente}</Dato>
              <Dato etiqueta="Servidor">
                {estado.servidor &&
                  `${estado.servidor}${estado.puerto ? `:${estado.puerto}` : ""}`}
              </Dato>
              <Dato etiqueta="Cifrado">{estado.cifrado}</Dato>
              <Dato etiqueta="Cuenta">{estado.usuario}</Dato>
              <Dato etiqueta="Espera máxima">
                {estado.espera_segundos != null &&
                  `${estado.espera_segundos} s`}
              </Dato>
              <Dato etiqueta="Enlace de los avisos">
                {estado.enlace_de_los_avisos}
              </Dato>
            </div>
            <p className="mz-small mz-faint mt-3 mb-0">
              Se configura en el servidor (archivo <code>.env</code>), no desde
              aquí: la clave del buzón no pasa por esta pantalla ni se guarda en
              la base. El enlace de los avisos es la dirección a la que llevan
              los botones de los correos.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
