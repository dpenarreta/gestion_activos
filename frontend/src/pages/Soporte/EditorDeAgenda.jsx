import { confirmar } from "../../components/common/Confirmar/confirmar";
import { formatearFecha } from "../../utils/formato";
import { DIAS } from "./comunes";

/** El horario de siempre de la mesa (el mismo que su horario por defecto). */
const DESDE = "08:00";
const HASTA = "17:30";

/**
 * Lo que está mal en las franjas y las ausencias, por posición (auditoría
 * UX/UI, 30/10/2026: «Hasta» antes de «Desde» o dos franjas que se cruzan se
 * guardaban, y una ausencia sin fechas se descartaba en silencio).
 * `{ franjas: {i: mensaje}, ausencias: {i: mensaje} }`; vacío si está bien.
 */
export function erroresDeAgenda(horarios, ausencias) {
  const franjas = {};
  horarios.forEach((f, i) => {
    const desde = f.hora_inicio.slice(0, 5);
    const hasta = f.hora_fin.slice(0, 5);
    if (!desde || !hasta) {
      franjas[i] = "Ponga la hora de inicio y la de fin.";
    } else if (hasta <= desde) {
      franjas[i] = "«Hasta» debe ser después de «Desde».";
    } else {
      const cruza = horarios.findIndex(
        (otra, j) =>
          j !== i &&
          otra.dia_semana === f.dia_semana &&
          otra.hora_inicio.slice(0, 5) < hasta &&
          desde < otra.hora_fin.slice(0, 5),
      );
      if (cruza >= 0)
        franjas[i] =
          `Se cruza con otra franja del ${DIAS[f.dia_semana].toLowerCase()}.`;
    }
  });
  const fechas = {};
  ausencias.forEach((a, i) => {
    if (!a.desde || !a.hasta) fechas[i] = "Ponga las dos fechas.";
    else if (a.hasta < a.desde)
      fechas[i] = "«Hasta» no puede ser antes de «Desde».";
  });
  return Object.keys(franjas).length || Object.keys(fechas).length
    ? { franjas, ausencias: fechas }
    : null;
}

/**
 * Las franjas semanales y las ausencias de un técnico. Lo usan «Mi horario»
 * (cada técnico el suyo), la configuración de técnicos (quien coordina) y el
 * horario hábil de la mesa, con sus feriados.
 * Solo cuenta para el SLA y el reparto lo que esté aquí.
 */
export function EditorDeAgenda({
  horarios,
  ausencias,
  onCambiar,
  deshabilitado = false,
  textos = {},
  errores = null,
}) {
  const t = {
    horario: "Horario de atención semanal",
    sinFranjas: "Sin franjas: no recibirá tickets automáticamente.",
    ausencias: "Fechas sin atención (vacaciones, permisos, feriados)",
    ...textos,
  };
  function cambiarFranja(indice, campo, valor) {
    onCambiar({
      horarios: horarios.map((f, i) =>
        i === indice ? { ...f, [campo]: valor } : f,
      ),
      ausencias,
    });
  }

  async function usarAtajo() {
    // Reemplaza todo: si ya hay franjas, se pregunta (antes, sin aviso).
    if (
      horarios.length > 0 &&
      !(await confirmar({
        titulo: "¿Reemplazar el horario?",
        mensaje: `Las ${horarios.length} franjas actuales se cambian por lunes a viernes, ${DESDE}–${HASTA}.`,
        accion: "Reemplazar",
        peligro: false,
      }))
    )
      return;
    onCambiar({
      horarios: [0, 1, 2, 3, 4].map((dia) => ({
        dia_semana: dia,
        hora_inicio: DESDE,
        hora_fin: HASTA,
      })),
      ausencias,
    });
  }

  function cambiarAusencia(indice, campo, valor) {
    onCambiar({
      horarios,
      ausencias: ausencias.map((a, i) =>
        i === indice ? { ...a, [campo]: valor } : a,
      ),
    });
  }

  return (
    <div className="mz-stack">
      <fieldset>
        <legend className="form-label">{t.horario}</legend>
        {horarios.length === 0 && (
          <p className="mz-small mz-faint">{t.sinFranjas}</p>
        )}
        {horarios.map((franja, i) => (
          <div className="soporte-franja" key={`f-${i}`}>
            <div>
              <label className="form-label mz-small" htmlFor={`ag-dia-${i}`}>
                Día
              </label>
              <select
                id={`ag-dia-${i}`}
                className="form-select form-select-sm"
                disabled={deshabilitado}
                value={franja.dia_semana}
                onChange={(e) =>
                  cambiarFranja(i, "dia_semana", Number(e.target.value))
                }
              >
                {DIAS.map((dia, n) => (
                  <option key={dia} value={n}>
                    {dia}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label mz-small" htmlFor={`ag-ini-${i}`}>
                Desde
              </label>
              <input
                id={`ag-ini-${i}`}
                type="time"
                className="form-control form-control-sm"
                disabled={deshabilitado}
                value={franja.hora_inicio.slice(0, 5)}
                onChange={(e) =>
                  cambiarFranja(i, "hora_inicio", e.target.value)
                }
              />
            </div>
            <div>
              <label className="form-label mz-small" htmlFor={`ag-fin-${i}`}>
                Hasta
              </label>
              <input
                id={`ag-fin-${i}`}
                type="time"
                className={`form-control form-control-sm${errores?.franjas[i] ? " is-invalid" : ""}`}
                disabled={deshabilitado}
                value={franja.hora_fin.slice(0, 5)}
                aria-invalid={errores?.franjas[i] ? true : undefined}
                aria-describedby={
                  errores?.franjas[i] ? `ag-error-${i}` : undefined
                }
                onChange={(e) => cambiarFranja(i, "hora_fin", e.target.value)}
              />
            </div>
            {!deshabilitado && (
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                aria-label={`Quitar la franja del ${DIAS[franja.dia_semana]}`}
                onClick={() =>
                  onCambiar({
                    horarios: horarios.filter((_, n) => n !== i),
                    ausencias,
                  })
                }
              >
                Quitar
              </button>
            )}
            {errores?.franjas[i] && (
              <div id={`ag-error-${i}`} className="mz-field-error w-100">
                {errores.franjas[i]}
              </div>
            )}
          </div>
        ))}
        {!deshabilitado && (
          <div className="mz-actions mt-2">
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={() =>
                onCambiar({
                  horarios: [
                    ...horarios,
                    { dia_semana: 0, hora_inicio: DESDE, hora_fin: HASTA },
                  ],
                  ausencias,
                })
              }
            >
              Agregar franja
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={usarAtajo}
            >
              Lunes a viernes, {DESDE}–{HASTA}
            </button>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="form-label">{t.ausencias}</legend>
        {ausencias.length === 0 && (
          <p className="mz-small mz-faint">Ninguna.</p>
        )}
        {ausencias.map((ausencia, i) => (
          <div className="soporte-franja" key={`a-${i}`}>
            <div>
              <label className="form-label mz-small" htmlFor={`au-desde-${i}`}>
                Desde
              </label>
              <input
                id={`au-desde-${i}`}
                type="date"
                className="form-control form-control-sm"
                disabled={deshabilitado}
                value={ausencia.desde}
                onChange={(e) => cambiarAusencia(i, "desde", e.target.value)}
              />
            </div>
            <div>
              <label className="form-label mz-small" htmlFor={`au-hasta-${i}`}>
                Hasta
              </label>
              <input
                id={`au-hasta-${i}`}
                type="date"
                className={`form-control form-control-sm${errores?.ausencias[i] ? " is-invalid" : ""}`}
                disabled={deshabilitado}
                aria-invalid={errores?.ausencias[i] ? true : undefined}
                aria-describedby={
                  errores?.ausencias[i] ? `au-error-${i}` : undefined
                }
                value={ausencia.hasta}
                onChange={(e) => cambiarAusencia(i, "hasta", e.target.value)}
              />
            </div>
            <div>
              <label className="form-label mz-small" htmlFor={`au-motivo-${i}`}>
                Motivo
              </label>
              <input
                id={`au-motivo-${i}`}
                className="form-control form-control-sm"
                disabled={deshabilitado}
                maxLength={120}
                value={ausencia.motivo}
                onChange={(e) => cambiarAusencia(i, "motivo", e.target.value)}
              />
            </div>
            {!deshabilitado && (
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                aria-label={
                  ausencia.desde
                    ? `Quitar la ausencia desde el ${formatearFecha(ausencia.desde)}`
                    : `Quitar la ausencia ${i + 1}`
                }
                onClick={() =>
                  onCambiar({
                    horarios,
                    ausencias: ausencias.filter((_, n) => n !== i),
                  })
                }
              >
                Quitar
              </button>
            )}
            {errores?.ausencias[i] && (
              <div id={`au-error-${i}`} className="mz-field-error w-100">
                {errores.ausencias[i]}
              </div>
            )}
          </div>
        ))}
        {!deshabilitado && (
          <button
            type="button"
            className="btn btn-outline-primary btn-sm mt-2"
            onClick={() =>
              onCambiar({
                horarios,
                ausencias: [...ausencias, { desde: "", hasta: "", motivo: "" }],
              })
            }
          >
            Agregar fechas
          </button>
        )}
      </fieldset>
    </div>
  );
}
