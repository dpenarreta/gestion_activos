import { DIAS } from "./comunes";

/**
 * Las franjas semanales y las ausencias de un técnico. Lo usan «Mi horario»
 * (cada técnico el suyo) y la configuración de técnicos (quien coordina).
 * Solo cuenta para el SLA y el reparto lo que esté aquí.
 */
export function EditorDeAgenda({
  horarios,
  ausencias,
  onCambiar,
  deshabilitado = false,
}) {
  function cambiarFranja(indice, campo, valor) {
    onCambiar({
      horarios: horarios.map((f, i) =>
        i === indice ? { ...f, [campo]: valor } : f,
      ),
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
        <legend className="form-label">Horario de atención semanal</legend>
        {horarios.length === 0 && (
          <p className="mz-small mz-faint">
            Sin franjas: no recibirá tickets automáticamente.
          </p>
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
                className="form-control form-control-sm"
                disabled={deshabilitado}
                value={franja.hora_fin.slice(0, 5)}
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
                    { dia_semana: 0, hora_inicio: "08:00", hora_fin: "17:00" },
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
              onClick={() =>
                onCambiar({
                  horarios: [0, 1, 2, 3, 4].map((dia) => ({
                    dia_semana: dia,
                    hora_inicio: "08:00",
                    hora_fin: "17:00",
                  })),
                  ausencias,
                })
              }
            >
              Lunes a viernes, 08:00–17:00
            </button>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="form-label">
          Fechas sin atención (vacaciones, permisos, feriados)
        </legend>
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
                className="form-control form-control-sm"
                disabled={deshabilitado}
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
