import { useEffect, useState } from "react";

import { alertasService } from "../../../api/alertasService";
import { Icon } from "../../../components/common/Icon/Icon";
import { mensajeDeError } from "../../../utils/errores";
import "./Alertas.css";

/**
 * La configuración de las alertas del inventario (§19): umbrales, cuáles están
 * activas y el resumen por correo. Vive en Configuración → Notificaciones →
 * Alertas del inventario, junto a los demás avisos del sistema; la pantalla de
 * Alertas solo muestra lo que pide atención.
 */
export function ConfiguracionAlertas({ inicial, onGuardado }) {
  const [valores, setValores] = useState(inicial);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const umbrales = [
    {
      campo: "dias_sin_asignar",
      etiqueta: "Días en bodega sin asignar",
      ayuda: "Capital inmovilizado, no una urgencia.",
    },
    {
      campo: "dias_reparacion_pendiente",
      etiqueta: "Días en reparación sin cerrar",
      ayuda: "Pasado el plazo, o se atascó o alguien olvidó cerrarla.",
    },
    {
      campo: "dias_sin_actualizacion",
      etiqueta: "Días sin actualizar la ficha",
      ayuda: "No dice que el dato esté mal, dice que nadie lo ha confirmado.",
    },
  ];

  const interruptores = [
    {
      campo: "avisar_proximos_a_reemplazo",
      etiqueta: "Equipos próximos a reemplazo",
    },
    {
      campo: "avisar_garantias_por_vencer",
      etiqueta: "Garantías próximas a vencer",
    },
    {
      campo: "avisar_demasiadas_reparaciones",
      etiqueta: "Equipos con demasiadas reparaciones",
    },
    {
      campo: "avisar_reparaciones_pendientes",
      etiqueta: "Reparaciones sin cerrar",
    },
    { campo: "avisar_sin_asignar", etiqueta: "Activos sin asignar" },
    { campo: "avisar_sin_actualizacion", etiqueta: "Fichas sin actualizar" },
  ];

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const guardada = await alertasService.guardarConfiguracion(valores);
      onGuardado(guardada);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la configuración."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="mz-card alertas-configuracion" onSubmit={handleSubmit}>
      <div className="mz-card-head">
        <h3>Qué se avisa y a quién</h3>
      </div>
      <div className="mz-card-body">
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}

        <section className="mz-section">
          <h4>Umbrales de aviso</h4>
          {/* Tres campos por fila: la rejilla de Bootstrap se queda, como
              admite la guía, porque `mz-field-grid` es de dos columnas. */}
          <div className="row g-3">
            {umbrales.map(({ campo, etiqueta, ayuda }) => (
              <div className="col-md-4" key={campo}>
                <label className="form-label" htmlFor={`alerta-${campo}`}>
                  {etiqueta}
                </label>
                <input
                  id={`alerta-${campo}`}
                  type="number"
                  min="1"
                  className="form-control"
                  value={valores[campo]}
                  onChange={(event) =>
                    setValores({
                      ...valores,
                      [campo]: Number(event.target.value),
                    })
                  }
                />
                <div className="form-text">{ayuda}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="mz-section">
          <h4>Alertas activas</h4>
          <div className="mz-field-grid">
            {interruptores.map(({ campo, etiqueta }) => (
              <div className="form-check" key={campo}>
                <input
                  id={`alerta-${campo}`}
                  type="checkbox"
                  className="form-check-input"
                  checked={valores[campo]}
                  onChange={(event) =>
                    setValores({ ...valores, [campo]: event.target.checked })
                  }
                />
                <label className="form-check-label" htmlFor={`alerta-${campo}`}>
                  {etiqueta}
                </label>
              </div>
            ))}
          </div>
          <p className="form-text mb-0 mt-2">
            {/* Apagar es preferible a ignorar: una alerta que no se puede
                apagar acaba siendo ruido que se ignora en bloque, y con ella
                el resto. */}
            Una alerta apagada deja de calcularse y no aparece en Alertas.
          </p>
        </section>

        <NotificacionesPanel valores={valores} setValores={setValores} />

        <div className="mz-actions justify-content-end">
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={isSaving}
          >
            {isSaving ? "Guardando…" : "Guardar configuración"}
          </button>
        </div>
      </div>
    </form>
  );
}

const DIAS_SEMANA = [
  [0, "Lunes"],
  [1, "Martes"],
  [2, "Miércoles"],
  [3, "Jueves"],
  [4, "Viernes"],
  [5, "Sábado"],
  [6, "Domingo"],
];

/**
 * Envío del resumen por correo (§19).
 *
 * Solo aparecen como posibles destinatarios los usuarios que ya pueden abrir
 * esta pantalla: el correo enlaza a los listados del parque, y avisar a
 * alguien de algo que no puede consultar es filtrarle información. Sus
 * direcciones llegan enmascaradas desde el backend — aquí hace falta
 * reconocer a la persona, no copiar su correo.
 */
function NotificacionesPanel({ valores, setValores }) {
  const [candidatos, setCandidatos] = useState([]);
  const [envios, setEnvios] = useState([]);
  const [prueba, setPrueba] = useState(null);
  const [enviandoPrueba, setEnviandoPrueba] = useState(false);

  useEffect(() => {
    alertasService
      .destinatariosDisponibles()
      .then(setCandidatos)
      .catch(() => setCandidatos([]));
    alertasService
      .historialEnvios()
      .then(setEnvios)
      .catch(() => setEnvios([]));
  }, []);

  const seleccionados = valores.destinatarios ?? [];

  function alternarDestinatario(id) {
    setValores({
      ...valores,
      destinatarios: seleccionados.includes(id)
        ? seleccionados.filter((elegido) => elegido !== id)
        : [...seleccionados, id],
    });
  }

  async function handlePrueba() {
    setEnviandoPrueba(true);
    setPrueba(null);
    try {
      const respuesta = await alertasService.enviarPrueba();
      setPrueba({ ok: true, texto: respuesta.detail });
    } catch (err) {
      setPrueba({
        ok: false,
        texto: mensajeDeError(err, "No se pudo enviar el correo de prueba."),
      });
    } finally {
      setEnviandoPrueba(false);
    }
  }

  return (
    <section className="mz-section">
      <h4>Notificaciones por correo</h4>

      <div className="form-check form-switch mb-3">
        <input
          id="alerta-notificaciones_activas"
          type="checkbox"
          className="form-check-input"
          checked={valores.notificaciones_activas}
          onChange={(event) =>
            setValores({
              ...valores,
              notificaciones_activas: event.target.checked,
            })
          }
        />
        <label
          className="form-check-label"
          htmlFor="alerta-notificaciones_activas"
        >
          Enviar el resumen de alertas por correo
        </label>
      </div>

      <div className="mz-field-grid mb-3">
        <div className="mz-field">
          <label htmlFor="alerta-frecuencia">Frecuencia</label>
          <select
            id="alerta-frecuencia"
            className="form-select"
            value={valores.frecuencia}
            onChange={(event) =>
              setValores({ ...valores, frecuencia: event.target.value })
            }
          >
            <option value="diaria">Diaria</option>
            <option value="semanal">Semanal</option>
          </select>
        </div>

        {valores.frecuencia === "semanal" && (
          <div className="mz-field">
            <label htmlFor="alerta-dia_envio_semanal">Día del envío</label>
            <select
              id="alerta-dia_envio_semanal"
              className="form-select"
              value={valores.dia_envio_semanal}
              onChange={(event) =>
                setValores({
                  ...valores,
                  dia_envio_semanal: Number(event.target.value),
                })
              }
            >
              {DIAS_SEMANA.map(([numero, nombre]) => (
                <option key={numero} value={numero}>
                  {nombre}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="form-check mb-3">
        <input
          id="alerta-omitir_si_no_hay_pendientes"
          type="checkbox"
          className="form-check-input"
          checked={valores.omitir_si_no_hay_pendientes}
          onChange={(event) =>
            setValores({
              ...valores,
              omitir_si_no_hay_pendientes: event.target.checked,
            })
          }
        />
        <label
          className="form-check-label"
          htmlFor="alerta-omitir_si_no_hay_pendientes"
        >
          No enviar los días sin nada pendiente
        </label>
        <div className="form-text">
          {/* El correo que llega todos los días diciendo lo mismo deja de
              leerse, y arrastra consigo al que sí traía algo. */}
          Apagado, llega también el correo que dice «revisado, nada pendiente».
        </div>
      </div>

      <fieldset className="mb-3">
        <legend className="form-label">Destinatarios</legend>
        {candidatos.length === 0 ? (
          <p className="form-text mb-0">
            Ningún usuario puede recibir el resumen todavía: hace falta que
            tenga el permiso «Ver el centro de alertas» y un correo registrado.
          </p>
        ) : (
          <div className="mz-field-grid">
            {candidatos.map((candidato) => (
              <div className="form-check" key={candidato.id}>
                <input
                  id={`destinatario-${candidato.id}`}
                  type="checkbox"
                  className="form-check-input"
                  checked={seleccionados.includes(candidato.id)}
                  onChange={() => alternarDestinatario(candidato.id)}
                />
                <label
                  className="form-check-label"
                  htmlFor={`destinatario-${candidato.id}`}
                >
                  {candidato.nombre}{" "}
                  <small className="mz-faint">{candidato.correo}</small>
                </label>
              </div>
            ))}
          </div>
        )}
        <div className="form-text">
          Solo aparecen quienes pueden ver las alertas: el correo enlaza a los
          listados del parque. Las direcciones van en copia oculta.
        </div>
      </fieldset>

      <div className="mz-actions align-items-center mb-2">
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={handlePrueba}
          disabled={enviandoPrueba}
        >
          <Icon name="envelope" />{" "}
          {enviandoPrueba ? "Enviando…" : "Enviar una prueba a mi correo"}
        </button>
        {valores.ultimo_envio && (
          <small className="mz-faint">
            Último resumen enviado el {valores.ultimo_envio}.
          </small>
        )}
      </div>

      {prueba &&
        (prueba.ok ? (
          <div className="mz-alert mz-alert--info" role="status">
            <Icon name="check2-circle" />
            {prueba.texto}
          </div>
        ) : (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {prueba.texto}
          </div>
        ))}

      {envios.length > 0 && (
        <details className="mt-2">
          <summary className="mz-small mz-faint">Últimos envíos</summary>
          <ul className="list-unstyled mz-small mt-2 mb-0">
            {envios.map((envio) => (
              <li key={envio.id} className="mb-1">
                <span className="mz-faint">
                  {new Date(envio.created_at).toLocaleString()}
                </span>{" "}
                — {envio.resultado_display}
                {envio.resultado === "enviado"
                  ? ` a ${envio.total_destinatarios} destinatario(s)`
                  : ""}
                {/* El motivo es lo que distingue un día tranquilo de un envío
                    que falló: sin él, ambos se ven igual desde fuera. */}
                {envio.motivo && (
                  <span className="mz-faint"> · {envio.motivo}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
