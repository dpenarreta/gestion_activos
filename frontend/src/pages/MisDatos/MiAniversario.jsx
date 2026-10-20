import { useState } from "react";

import { misDatosService } from "../../api/misDatosService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function fechaDeIngreso({ dia, mes, anio }) {
  return `${dia} de ${MESES[mes - 1]}${anio ? ` de ${anio}` : ""}`;
}

/** Activar: aceptar que sea público y dar el día y el mes de ingreso (y, si
 * lo recuerda, el año). */
function VentanaPublicar({ onPublicado, onCerrar }) {
  const [valores, setValores] = useState({ dia: "", mes: "", anio: "" });
  const [acepto, setAcepto] = useState(false);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const fijar = (campo) => (e) =>
    setValores((v) => ({ ...v, [campo]: e.target.value }));

  async function confirmar(evento) {
    evento.preventDefault();
    if (!valores.dia || !valores.mes) {
      setError("Indique al menos el día y el mes de su ingreso.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      onPublicado(
        await misDatosService.guardarAniversario({
          mostrar: true,
          acepto,
          dia: Number(valores.dia),
          mes: Number(valores.mes),
          anio: valores.anio ? Number(valores.anio) : null,
        }),
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar."));
      setGuardando(false);
    }
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
        aria-labelledby="aniversario-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="aniversario-titulo">
            <Icon name="award" /> Mostrar mi aniversario en la empresa
          </h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <form className="mz-panel-body mz-stack" onSubmit={confirmar}>
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          <p className="mb-0">
            Su aniversario aparecerá en el calendario de Inicio, que ve{" "}
            <strong>toda la empresa</strong>, como «Aniversario de» su nombre,
            todos los años. Si indica el año de ingreso, se mostrarán también
            los años que cumple en la empresa. Puede dejar de mostrarlo cuando
            quiera.
          </p>
          <fieldset className="row g-2">
            <legend className="form-label mb-1">Fecha de ingreso</legend>
            <div className="col-4">
              <label className="form-label mz-small" htmlFor="aniv-dia">
                Día
              </label>
              <select
                id="aniv-dia"
                className="form-select form-select-sm"
                value={valores.dia}
                onChange={fijar("dia")}
              >
                <option value="">Día</option>
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-4">
              <label className="form-label mz-small" htmlFor="aniv-mes">
                Mes
              </label>
              <select
                id="aniv-mes"
                className="form-select form-select-sm"
                value={valores.mes}
                onChange={fijar("mes")}
              >
                <option value="">Mes</option>
                {MESES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-4">
              <label className="form-label mz-small" htmlFor="aniv-anio">
                Año (opcional)
              </label>
              <input
                id="aniv-anio"
                type="number"
                min={1950}
                max={new Date().getFullYear()}
                placeholder="Año"
                className="form-control form-control-sm"
                value={valores.anio}
                onChange={fijar("anio")}
              />
            </div>
          </fieldset>
          <label className="form-check">
            <input
              type="checkbox"
              className="form-check-input"
              checked={acepto}
              onChange={(e) => setAcepto(e.target.checked)}
            />{" "}
            <span className="form-check-label">
              Acepto que mi aniversario en la empresa sea información pública
              dentro de la empresa.
            </span>
          </label>
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
              disabled={!acepto || guardando}
            >
              {guardando ? "Guardando…" : "Aceptar y mostrar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * «Mi perfil» → Mi aniversario en el calendario: cada persona decide si se
 * muestra. Activarlo pide aceptar que sea público y la fecha de ingreso (al
 * menos día y mes); desactivarlo lo retira y borra la fecha.
 */
export function MiAniversario({ inicial }) {
  const [estado, setEstado] = useState(
    inicial ?? { mostrar: false, dia: null, mes: null, anio: null },
  );
  const [ventana, setVentana] = useState(false);
  const [error, setError] = useState(null);
  const [mensaje, setMensaje] = useState(null);

  async function retirar() {
    setError(null);
    setMensaje(null);
    try {
      setEstado(await misDatosService.guardarAniversario({ mostrar: false }));
      setMensaje("Su aniversario ya no se muestra en el calendario.");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar."));
    }
  }

  return (
    <section className="mz-card" aria-labelledby="mi-aniv-titulo">
      <div className="mz-card-body mz-stack">
        <div className="d-flex align-items-start justify-content-between gap-3">
          <div>
            <h3 id="mi-aniv-titulo" className="h6 mb-1">
              <Icon name="award" /> Mi aniversario en el calendario
            </h3>
            <p className="mz-faint mz-small mb-0">
              {estado.mostrar
                ? `Se muestra cada ${estado.dia} de ${MESES[estado.mes - 1]} (ingresó el ${fechaDeIngreso(estado)}).`
                : "No se muestra. Si lo activa, toda la empresa verá su aniversario de ingreso."}
            </p>
          </div>
          <label className="form-check form-switch mb-0">
            <input
              type="checkbox"
              role="switch"
              className="form-check-input"
              aria-label="Mostrar mi aniversario en la empresa en el calendario"
              checked={estado.mostrar}
              onChange={(e) => {
                setMensaje(null);
                if (e.target.checked) setVentana(true);
                else retirar();
              }}
            />
          </label>
        </div>
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        {mensaje && (
          <div className="mz-alert mz-alert--info" role="status">
            <Icon name="check2-circle" />
            {mensaje}
          </div>
        )}
      </div>
      {ventana && (
        <VentanaPublicar
          onCerrar={() => setVentana(false)}
          onPublicado={(nuevo) => {
            setEstado(nuevo);
            setVentana(false);
            setMensaje(
              `Listo: su aniversario se muestra cada ${nuevo.dia} de ${MESES[nuevo.mes - 1]}.`,
            );
          }}
        />
      )}
    </section>
  );
}
