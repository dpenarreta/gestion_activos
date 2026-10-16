import { useEffect, useState } from "react";

import { soporteService } from "../../api/soporteService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { EditorDeAgenda } from "./EditorDeAgenda";
import "./Soporte.css";

/**
 * «Mi horario»: cada técnico define cuándo atiende y sus fechas libres. El
 * reparto de tickets y el SLA cuentan solo dentro de este horario.
 */
export function MiHorario() {
  const [agenda, setAgenda] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    soporteService
      .miHorario()
      .then((tecnico) =>
        setAgenda({ horarios: tecnico.horarios, ausencias: tecnico.ausencias }),
      )
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar su horario.")),
      );
  }, []);

  async function guardar() {
    setGuardando(true);
    setError(null);
    setAviso(null);
    try {
      const tecnico = await soporteService.guardarMiHorario(agenda);
      setAgenda({ horarios: tecnico.horarios, ausencias: tecnico.ausencias });
      setAviso("Horario guardado. Desde ahora el reparto y el SLA lo usan.");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el horario."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="soporte-page">
      <div className="mz-view-head">
        <div>
          <h2>Mi horario de atención</h2>
          <p className="mz-desc">
            Recibe tickets y corre su SLA solo dentro de estas franjas. Fuera de
            ellas, lo que llegue espera en la cola.
          </p>
        </div>
      </div>
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="check2-circle" />
          {aviso}
        </div>
      )}
      {agenda && (
        <section className="mz-card">
          <div className="mz-card-body">
            <EditorDeAgenda
              horarios={agenda.horarios}
              ausencias={agenda.ausencias}
              onCambiar={setAgenda}
            />
            <div className="mz-actions justify-content-end mt-3">
              <button
                type="button"
                className="btn btn-primary"
                disabled={guardando}
                onClick={guardar}
              >
                {guardando ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
