import { useCallback, useEffect, useState } from "react";

import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";
import { usePedirMotivo } from "../../components/common/PedirMotivo/PedirMotivo";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";

/** Revertir una versión: primero muestra qué va a cambiar y, si se
 * confirma, pide el motivo. */
function Revertir({ version, onRevertido, pedirMotivo }) {
  const [previa, setPrevia] = useState(null);
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(false);

  async function ver() {
    setError(null);
    try {
      setPrevia(await institucionalService.vistaPreviaRevertir(version.id));
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo preparar la reversión."));
    }
  }

  async function confirmar() {
    const motivo = await pedirMotivo(
      `Se revierte el cambio del ${version.fecha} a las ${version.hora}.`,
      { titulo: "¿Por qué se revierte?", textoConfirmar: "Revertir" },
    );
    if (!motivo) return;
    setTrabajando(true);
    setError(null);
    try {
      await institucionalService.revertirVersion(version.id, motivo);
      setPrevia(null);
      onRevertido();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo revertir."));
    } finally {
      setTrabajando(false);
    }
  }

  if (previa === null) {
    return (
      <>
        <button
          type="button"
          className="btn btn-outline-danger btn-sm"
          onClick={ver}
        >
          <Icon name="arrow-counterclockwise" /> Revertir este cambio
        </button>
        {error && <p className="text-danger mz-small mb-0">{error}</p>}
      </>
    );
  }
  return (
    <div className="bitacora-organigrama__previa">
      <strong className="mz-small">
        Al revertir, la estructura vuelve a como estaba antes de este cambio (y
        se deshace lo que se hizo después):
      </strong>
      {previa.length ? (
        <ul className="mz-small mb-0">
          {previa.map((linea) => (
            <li key={linea}>{linea}</li>
          ))}
        </ul>
      ) : (
        <p className="mz-small mz-faint mb-0">
          No hay nada que cambiar: la estructura ya está así.
        </p>
      )}
      {error && <p className="text-danger mz-small mb-0">{error}</p>}
      <div className="d-flex gap-2">
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={trabajando || !previa.length}
          onClick={confirmar}
        >
          <Icon name="arrow-counterclockwise" />{" "}
          {trabajando ? "Revirtiendo…" : "Sí, revertir"}
        </button>
        <button
          type="button"
          className="btn btn-link btn-sm"
          onClick={() => setPrevia(null)}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

/**
 * Estructura → «Bitácora de cambios» (26/10/2026): los 2 últimos cambios al
 * organigrama con quién los hizo, cuándo, desde qué IP, por qué (el motivo)
 * y qué cambió. Quien arma el organigrama (`institucional.editar`) puede
 * revertir cualquiera de los dos: la estructura vuelve a como estaba antes.
 * Lo anterior a esas 2 versiones se borra y no se puede recuperar.
 */
export function BitacoraOrganigrama({ puedeRevertir, onCerrar, onRevertido }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const [versiones, setVersiones] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [pedirMotivo, dialogoMotivo] = usePedirMotivo();

  const cargar = useCallback(
    () =>
      institucionalService
        .versionesOrganigrama()
        .then(setVersiones)
        .catch((err) =>
          setError(mensajeDeError(err, "No se pudo cargar la bitácora.")),
        ),
    [],
  );

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <>
      <div
        className="mz-overlay mz-overlay--center"
        onClick={handleBackdropClick}
        role="presentation"
      >
        <div
          className="mz-modal mz-modal--wide"
          role="dialog"
          aria-modal="true"
          aria-label="Bitácora de cambios del organigrama"
          ref={panelRef}
          tabIndex={-1}
        >
          <div className="mz-panel-head">
            <h3>Bitácora de cambios del organigrama</h3>
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
              Cada cambio a la estructura guarda quién lo hizo, cuándo, desde
              qué IP, por qué y qué cambió, con un respaldo de cómo estaba todo
              antes para poder revertirlo. Solo se guardan los 2 últimos
              cambios: los anteriores se borran y no se pueden recuperar.
            </p>
            {error && (
              <div className="mz-alert mz-alert--bad" role="alert">
                <Icon name="x-octagon" />
                {error}
              </div>
            )}
            {aviso && (
              <div className="mz-alert mz-alert--ok" role="status">
                <Icon name="check-circle" />
                {aviso}
              </div>
            )}
            {versiones === null && !error && (
              <p className="mz-faint mb-0">Cargando…</p>
            )}
            {versiones?.length === 0 && (
              <p className="mz-faint mb-0">
                Todavía no hay cambios registrados.
              </p>
            )}
            {versiones?.map((v, i) => (
              <article key={v.id} className="bitacora-organigrama__version">
                <header>
                  <strong>
                    {i === 0 ? "Último cambio" : "Cambio anterior"}
                  </strong>{" "}
                  <span className="mz-faint mz-small">
                    · {v.fecha} {v.hora} · {v.usuario}
                    {v.ip && ` · IP ${v.ip}`}
                  </span>
                  {v.revierte && (
                    <span className="mz-pill ms-2">Reversión</span>
                  )}
                </header>
                <p className="mb-1">
                  <span className="mz-faint">Motivo:</span> {v.motivo}
                </p>
                <ul className="mz-small mb-1">
                  {v.cambios.map((linea) => (
                    <li key={linea}>{linea}</li>
                  ))}
                </ul>
                {puedeRevertir && (
                  <Revertir
                    version={v}
                    pedirMotivo={pedirMotivo}
                    onRevertido={() => {
                      setAviso(
                        "Listo: la estructura volvió a como estaba. La reversión quedó en la bitácora.",
                      );
                      cargar();
                      onRevertido?.();
                    }}
                  />
                )}
              </article>
            ))}
          </div>
        </div>
      </div>
      {dialogoMotivo}
    </>
  );
}
