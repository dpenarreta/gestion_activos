import { useCallback, useEffect, useRef, useState } from "react";

import { soporteService } from "../../api/soporteService";
import { enfocarPrimerError } from "../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { useUnsavedChangesOpcional } from "../../context/UnsavedChangesContext";
import { mensajeDeError } from "../../utils/errores";
import { EditorDeAgenda, erroresDeAgenda } from "./EditorDeAgenda";
import "./Soporte.css";

/**
 * «Mi horario»: cada técnico define cuándo atiende y sus fechas libres. El
 * reparto de tickets usa este horario; los plazos (SLA) se miden con el
 * horario de la mesa.
 *
 * Auditoría UX/UI (30/10/2026): el texto decía que el SLA corría con este
 * horario, y la configuración, que con el de la mesa (que es lo cierto).
 * Ahora dice «Cargando…», valida las franjas antes de guardar y avisa si se
 * sale con cambios sin guardar.
 */
export function MiHorario() {
  const [agenda, setAgenda] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [error, setError] = useState(null);
  const [errores, setErrores] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const cambios = useUnsavedChangesOpcional();
  const tarjeta = useRef(null);
  const marcarSucio = cambios?.setIsDirty;

  const cargar = useCallback(() => {
    setErrorCarga(null);
    soporteService
      .miHorario()
      .then((tecnico) =>
        setAgenda({ horarios: tecnico.horarios, ausencias: tecnico.ausencias }),
      )
      .catch((err) =>
        setErrorCarga(mensajeDeError(err, "No se pudo cargar su horario.")),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Al salir de la pantalla, ya no hay nada pendiente.
  useEffect(() => () => marcarSucio?.(false), [marcarSucio]);

  function cambiar(nueva) {
    setAgenda(nueva);
    setAviso(null);
    marcarSucio?.(true);
    // Los errores se recalculan al corregir, para que se vayan solos.
    if (errores) setErrores(erroresDeAgenda(nueva.horarios, nueva.ausencias));
  }

  async function guardar() {
    setError(null);
    setAviso(null);
    const problemas = erroresDeAgenda(agenda.horarios, agenda.ausencias);
    setErrores(problemas);
    if (problemas) {
      setError("Revise las franjas o las fechas marcadas.");
      enfocarPrimerError(tarjeta.current);
      return;
    }
    setGuardando(true);
    try {
      const tecnico = await soporteService.guardarMiHorario(agenda);
      setAgenda({ horarios: tecnico.horarios, ausencias: tecnico.ausencias });
      marcarSucio?.(false);
      setAviso("Horario guardado. Desde ahora el reparto de tickets lo usa.");
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
            Define cuándo le llegan tickets: fuera de estas franjas, lo que
            llegue espera en la cola. Los plazos (SLA) se miden con el horario
            de la mesa de ayuda.
          </p>
        </div>
      </div>
      {!agenda && (
        <EstadoDeCarga
          cargando={!errorCarga}
          error={errorCarga}
          onReintentar={cargar}
        />
      )}
      {agenda && (
        <section className="mz-card" ref={tarjeta}>
          <div className="mz-card-body">
            <EditorDeAgenda
              horarios={agenda.horarios}
              ausencias={agenda.ausencias}
              errores={errores}
              onCambiar={cambiar}
            />
            {/* El resultado, junto al botón. */}
            {error && (
              <div className="mz-alert mz-alert--bad mt-3 mb-0" role="alert">
                <Icon name="x-octagon" />
                {error}
              </div>
            )}
            {aviso && (
              <div className="mz-alert mz-alert--ok mt-3 mb-0" role="status">
                <Icon name="check2-circle" />
                {aviso}
              </div>
            )}
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
