import { useCallback, useEffect, useState } from "react";

import { nominaService } from "../../api/nominaService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";

/** Una persona: su código y si está habilitada; se guarda fila por fila. */
function Fila({ persona, onGuardada }) {
  const [codigo, setCodigo] = useState(persona.codigo);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function guardar(habilitado) {
    setGuardando(true);
    setError(null);
    try {
      onGuardada(
        await nominaService.habilitar({
          usuario: persona.id,
          habilitado,
          codigo: codigo.trim(),
        }),
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar."));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <tr>
      <td>
        <strong>{persona.nombre}</strong>
        <small className="mz-faint d-block">{persona.correo}</small>
      </td>
      <td>
        <input
          className="form-control form-control-sm"
          aria-label={`Código de empleado de ${persona.nombre}`}
          inputMode="numeric"
          maxLength={40}
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
        />
        {error && <small className="text-danger d-block">{error}</small>}
      </td>
      <td>
        <label className="form-check form-switch m-0">
          <input
            type="checkbox"
            role="switch"
            className="form-check-input"
            aria-label={`Habilitar a ${persona.nombre}`}
            checked={persona.habilitado}
            disabled={guardando}
            onChange={(e) => guardar(e.target.checked)}
          />{" "}
          <span className="form-check-label mz-small">
            {persona.habilitado ? "Habilitada" : "No habilitada"}
          </span>
        </label>
      </td>
      <td>
        <button
          type="button"
          className="btn btn-outline-primary btn-sm"
          disabled={guardando || codigo.trim() === persona.codigo}
          onClick={() => guardar(persona.habilitado)}
        >
          Guardar código
        </button>
      </td>
    </tr>
  );
}

/**
 * Rol de pagos → Usuarios habilitados (`roles_pago.habilitar`, 22/10/2026):
 * quiénes consultan su rol de pagos —las personas que aceptaron recibirlo y
 * validarlo en forma virtual— y con qué código de empleado. No va por rol ni
 * por cargo: se habilita persona por persona.
 */
export function HabilitadosRolPagos({ onCerrar }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const [buscar, setBuscar] = useState("");
  const [personas, setPersonas] = useState(null);
  const [error, setError] = useState(null);

  const cargar = useCallback((texto) => {
    nominaService
      .habilitados(texto)
      .then((datos) => {
        setPersonas(datos);
        setError(null);
      })
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar la lista.")),
      );
  }, []);

  useEffect(() => {
    const temporizador = setTimeout(() => cargar(buscar), 250);
    return () => clearTimeout(temporizador);
  }, [buscar, cargar]);

  const habilitadas = (personas ?? []).filter((p) => p.habilitado).length;

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal mz-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label="Usuarios habilitados"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>Usuarios habilitados</h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body mz-stack">
          <p className="mz-small mz-faint mb-0">
            Solo las personas habilitadas consultan su rol de pagos, cada una el
            suyo con su código de empleado. Para habilitar a alguien, escriba su
            código y active el interruptor.
          </p>
          <input
            className="form-control form-control-sm"
            type="search"
            placeholder="Buscar por nombre, correo o código"
            aria-label="Buscar personas"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
          />
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {personas && (
            <p className="mz-small mb-0">
              {habilitadas} habilitada(s) de {personas.length} en la lista.
            </p>
          )}
          <div className="table-responsive">
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Código de empleado</th>
                  <th>Rol de pagos</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {(personas ?? []).map((p) => (
                  <Fila
                    key={`${p.id}-${p.codigo}-${p.habilitado}`}
                    persona={p}
                    onGuardada={(fila) =>
                      setPersonas((lista) =>
                        lista.map((x) => (x.id === fila.id ? fila : x)),
                      )
                    }
                  />
                ))}
                {personas && personas.length === 0 && (
                  <tr>
                    <td colSpan={4} className="mz-faint">
                      Nadie con ese nombre.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
