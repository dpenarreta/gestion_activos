import { useEffect, useState } from "react";

import { misDatosService } from "../../api/misDatosService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import "./MiCargo.css";

const TIPOS = [
  ["externa", "Herramientas externas", "globe2"],
  ["interna", "Herramientas internas", "building"],
];

function Editor({ catalogo, mias, base = [], onGuardado, onCerrar }) {
  const requeridas = new Set(base.map((h) => h.id));
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  // herramienta id → { cuenta, detalle }, para las marcadas.
  const [elegidas, setElegidas] = useState(
    () =>
      new Map(
        mias.map((h) => [
          h.id,
          { cuenta: h.cuenta ?? "", detalle: h.detalle ?? "" },
        ]),
      ),
  );
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  function alternar(id) {
    setElegidas((actual) => {
      const nuevas = new Map(actual);
      if (nuevas.has(id)) nuevas.delete(id);
      else nuevas.set(id, { cuenta: "", detalle: "" });
      return nuevas;
    });
  }

  function cambiar(id, campo, valor) {
    setElegidas((actual) =>
      new Map(actual).set(id, { ...actual.get(id), [campo]: valor }),
    );
  }

  async function guardar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      onGuardado(
        await misDatosService.guardarHerramientas(
          [...elegidas].map(([herramienta, { cuenta, detalle }]) => ({
            herramienta,
            cuenta,
            detalle,
          })),
        ),
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudieron guardar sus herramientas."));
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
        className="mz-modal mz-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mis-herramientas-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <div>
            <h3 id="mis-herramientas-titulo">Mis herramientas</h3>
            <p className="mz-desc">
              Marque las que usa para su trabajo y escriba su nombre de usuario
              en cada una. El detalle es opcional.
            </p>
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
        <form className="mz-panel-body mz-stack" onSubmit={guardar}>
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {TIPOS.map(([tipo, titulo, icono]) => {
            const lista = catalogo.filter((h) => h.tipo === tipo);
            if (!lista.length) return null;
            return (
              <fieldset key={tipo} className="mis-herramientas__grupo">
                <legend>
                  <Icon name={icono} /> {titulo}
                </legend>
                {lista.map((h) => {
                  const marcada = elegidas.has(h.id);
                  return (
                    <div key={h.id} className="mis-herramientas__fila">
                      <label className="form-check mb-0">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          checked={marcada}
                          onChange={() => alternar(h.id)}
                        />{" "}
                        <span className="form-check-label">
                          {h.nombre}
                          {requeridas.has(h.id) && (
                            <span className="mis-herramientas__requerida">
                              de su cargo
                            </span>
                          )}
                        </span>
                      </label>
                      {marcada && (
                        <div className="mis-herramientas__datos">
                          <input
                            className="form-control form-control-sm"
                            aria-label={`Su usuario en ${h.nombre}`}
                            placeholder="Su usuario en la herramienta (obligatorio)"
                            required
                            maxLength={150}
                            value={elegidas.get(h.id).cuenta}
                            onChange={(e) =>
                              cambiar(h.id, "cuenta", e.target.value)
                            }
                          />
                          <input
                            className="form-control form-control-sm"
                            aria-label={`Detalle de ${h.nombre}`}
                            placeholder="Detalle o descripción (opcional)"
                            maxLength={500}
                            value={elegidas.get(h.id).detalle}
                            onChange={(e) =>
                              cambiar(h.id, "detalle", e.target.value)
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
          <p className="mz-faint mz-small mb-0">
            ¿Falta alguna? Pídale a TI que la agregue al catálogo.
          </p>
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
              disabled={guardando}
            >
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Con qué debe venir su equipo según su cargo, y qué le falta registrar. */
function BaseDelCargo({ cargo, base, mias }) {
  const tiene = new Set(mias.map((h) => h.id));
  const faltan = base.filter((h) => !tiene.has(h.id));
  return (
    <div
      className="mis-herramientas__base"
      aria-label="Herramientas base de su cargo"
    >
      <span className="mz-small">
        <strong>Base de su cargo ({cargo.nombre}):</strong> su equipo debe venir
        configurado, como mínimo, con:
      </span>
      <ul className="base-cargo__chips">
        {base.map((h) => (
          <li
            key={h.id}
            className={`base-cargo__chip${tiene.has(h.id) ? " is-lista" : " is-falta"}`}
          >
            <Icon name={tiene.has(h.id) ? "check-lg" : "exclamation-lg"} />{" "}
            {h.nombre}
          </li>
        ))}
      </ul>
      {faltan.length > 0 && (
        <small className="mis-herramientas__faltan">
          No tiene registradas: {faltan.map((h) => h.nombre).join(", ")}. Si ya
          las usa, agréguelas con «Editar»; si no, pídalas a TI.
        </small>
      )}
    </div>
  );
}

/**
 * «Mi perfil» → Mis herramientas: las licencias y sistemas que la persona usa
 * para su trabajo (externos e internos), con su cuenta. Sirve para pedir su
 * desactivación, reasignación o licencias nuevas en una requisición.
 */
export function MisHerramientas() {
  const [datos, setDatos] = useState(null);
  const [editando, setEditando] = useState(false);
  const [aviso, setAviso] = useState(null);

  useEffect(() => {
    Promise.resolve(misDatosService.herramientas?.())
      .then((r) => setDatos(r ?? { mias: [], catalogo: [] }))
      .catch(() => setDatos({ mias: [], catalogo: [] }));
  }, []);

  if (!datos) return null;

  return (
    <section className="mz-card mi-cargo" aria-labelledby="mis-herr-titulo">
      <div className="mz-card-body mz-stack">
        <div className="d-flex align-items-start justify-content-between gap-3">
          <div>
            <h3 id="mis-herr-titulo" className="h6 mb-1">
              <Icon name="tools" /> Mis herramientas
            </h3>
            <p className="mz-faint mz-small mb-0">
              Las licencias y sistemas que usa para su trabajo en la empresa.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={() => {
              setAviso(null);
              setEditando(true);
            }}
            disabled={!datos.catalogo.length}
          >
            <Icon name="pencil" /> Editar
          </button>
        </div>
        {aviso && (
          <div className="mz-alert mz-alert--info" role="status">
            <Icon name="check2-circle" />
            {aviso}
          </div>
        )}
        {datos.cargo && datos.base?.length > 0 && (
          <BaseDelCargo
            cargo={datos.cargo}
            base={datos.base}
            mias={datos.mias}
          />
        )}
        {datos.mias.length === 0 ? (
          <p className="mz-faint mb-0">
            {datos.catalogo.length
              ? "Todavía no ha indicado qué herramientas usa."
              : "Todavía no hay herramientas en el catálogo de la empresa."}
          </p>
        ) : (
          <div className="mi-cargo__grilla mis-herramientas__vista">
            {TIPOS.map(([tipo, titulo, icono]) => {
              const lista = datos.mias.filter((h) => h.tipo === tipo);
              return (
                <div key={tipo} className="mi-cargo__bloque">
                  <h4>
                    <Icon name={icono} /> {titulo}
                  </h4>
                  {lista.length ? (
                    <ul className="mis-herramientas__lista">
                      {lista.map((h) => (
                        <li key={h.id}>
                          <strong>{h.nombre}</strong>
                          {h.cuenta ? (
                            <small className="mz-faint"> · {h.cuenta}</small>
                          ) : (
                            <small className="text-danger">
                              {" "}
                              · falta su usuario
                            </small>
                          )}
                          {h.detalle && (
                            <small className="mis-herramientas__detalle">
                              {h.detalle}
                            </small>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mz-faint mb-0">Ninguna.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {editando && (
        <Editor
          catalogo={datos.catalogo}
          base={datos.base}
          mias={datos.mias}
          onCerrar={() => setEditando(false)}
          onGuardado={(nuevos) => {
            setDatos(nuevos);
            setEditando(false);
            setAviso("Sus herramientas quedaron guardadas.");
          }}
        />
      )}
    </section>
  );
}
