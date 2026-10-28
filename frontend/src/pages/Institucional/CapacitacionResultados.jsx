import { useCallback, useEffect, useState } from "react";

import { capacitacionService } from "../../api/capacitacionService";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";

function Ventana({ titulo, onCerrar, children }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
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
        aria-label={titulo}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>{titulo}</h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body">{children}</div>
      </div>
    </div>
  );
}

/** El detalle de una persona: cada material con su puntaje; devolver
 * intentos a quien los agotó. */
function DetallePersona({ fila, onDevuelto, onCerrar }) {
  const [error, setError] = useState(null);
  return (
    <Ventana
      titulo={`Onboarding de ${fila.usuario.nombre}`}
      onCerrar={onCerrar}
    >
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      <ul className="perfil-cargo-lista">
        {fila.materiales.map((m) => (
          <li key={m.id}>
            <span className="perfil-cargo-lista__nombre">
              <strong>{m.titulo}</strong>
              <small className="mz-faint">
                {" "}
                · {m.alcance_display}
                {m.de && ` (${m.de})`} · {m.intentos} intentos
              </small>
            </span>
            <span
              className={`perfil-cargo-estado ${m.aprobado ? "perfil-cargo-estado--completo" : m.mejor_puntaje !== null ? "perfil-cargo-estado--parcial" : "perfil-cargo-estado--vacio"}`}
            >
              {m.aprobado
                ? `Aprobado · ${m.mejor_puntaje}`
                : m.mejor_puntaje !== null
                  ? `Mejor: ${m.mejor_puntaje}`
                  : m.visto
                    ? "Visto"
                    : "Pendiente"}
            </span>
            {m.agotado && (
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={async () => {
                  try {
                    await capacitacionService.devolverIntentos(
                      fila.usuario.id,
                      m.id,
                    );
                    onDevuelto();
                  } catch (err) {
                    setError(mensajeDeError(err, "No se pudo."));
                  }
                }}
              >
                <Icon name="arrow-counterclockwise" /> Devolver intentos
              </button>
            )}
          </li>
        ))}
      </ul>
    </Ventana>
  );
}

/** Asignar el onboarding a cuentas que ya existían. */
function Asignar({ onAsignado, onCerrar }) {
  const [buscar, setBuscar] = useState("");
  const [resultados, setResultados] = useState([]);
  const [elegidas, setElegidas] = useState([]);
  const [dias, setDias] = useState(15);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (buscar.trim().length < 2) {
      setResultados([]);
      return undefined;
    }
    const espera = setTimeout(() => {
      capacitacionService
        .personas(buscar.trim())
        .then(setResultados)
        // Antes un fallo se veía como «nadie coincide» (auditoría UX/UI,
        // fase 2, 28/10/2026).
        .catch((err) => {
          setResultados([]);
          setError(mensajeDeError(err, "No se pudo buscar personas."));
        });
    }, 250);
    return () => clearTimeout(espera);
  }, [buscar]);

  async function asignar() {
    setError(null);
    try {
      const r = await capacitacionService.asignar(
        elegidas.map((p) => p.id),
        Number(dias),
      );
      onAsignado(r.asignados);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo asignar."));
    }
  }

  return (
    <Ventana titulo="Asignar onboarding" onCerrar={onCerrar}>
      <div className="mz-stack">
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        <p className="mz-faint mz-small mb-0">
          Las personas nuevas lo reciben solas al entrar a la empresa. Aquí se
          asigna a quien ya tenía cuenta.
        </p>
        <input
          type="search"
          className="form-control form-control-sm"
          aria-label="Buscar persona"
          placeholder="Nombre o correo…"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
        />
        {resultados.length > 0 && (
          <ul className="perfil-cargo-lista">
            {resultados.map((p) => (
              <li key={p.id}>
                <span className="perfil-cargo-lista__nombre">
                  {p.nombre} <small className="mz-faint">· {p.correo}</small>
                </span>
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  disabled={elegidas.some((e) => e.id === p.id)}
                  onClick={() => setElegidas((l) => [...l, p])}
                >
                  Agregar
                </button>
              </li>
            ))}
          </ul>
        )}
        {elegidas.length > 0 && (
          <div className="base-cargo__chips">
            {elegidas.map((p) => (
              <span key={p.id} className="base-cargo__chip">
                {p.nombre}
              </span>
            ))}
          </div>
        )}
        <div className="d-flex gap-2 align-items-end">
          <div>
            <label className="form-label mz-small" htmlFor="asig-dias">
              Días para completarlo
            </label>
            <input
              id="asig-dias"
              type="number"
              min={1}
              max={180}
              className="form-control form-control-sm"
              value={dias}
              onChange={(e) => setDias(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!elegidas.length}
            onClick={asignar}
          >
            Asignar a {elegidas.length}
          </button>
        </div>
      </div>
    </Ventana>
  );
}

/**
 * Editar estructura → Resultados de capacitación (`capacitacion.resultados`):
 * el avance y los puntajes de cada persona, y por material las preguntas que
 * más se fallan (oportunidades de mejora).
 */
export function CapacitacionResultados() {
  const [datos, setDatos] = useState(null);
  const [vista, setVista] = useState("personas");
  const [detalle, setDetalle] = useState(null);
  const [asignando, setAsignando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);

  const cargar = useCallback(
    () =>
      capacitacionService
        .resultados()
        .then((d) => {
          setError(null);
          setDatos(d);
          setDetalle((actual) =>
            actual
              ? (d.personas.find((p) => p.usuario.id === actual.usuario.id) ??
                null)
              : null,
          );
        })
        .catch((err) =>
          setError(
            mensajeDeError(err, "No se pudieron cargar los resultados."),
          ),
        ),
    [],
  );

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div className="mz-stack">
      <div className="d-flex flex-wrap gap-2 align-items-center justify-content-between">
        {/* Pestañas con flechas y su panel (auditoría UX/UI, fase 2,
            28/10/2026). */}
        <Pestanas
          etiqueta="Resultados de capacitación"
          idBase="cap-res"
          valor={vista}
          onCambio={setVista}
          opciones={[
            { id: "personas", etiqueta: "Por persona" },
            { id: "materiales", etiqueta: "Por material" },
          ]}
        />
        <button
          type="button"
          className="btn btn-outline-primary btn-sm"
          onClick={() => setAsignando(true)}
        >
          <Icon name="person-plus" /> Asignar onboarding
        </button>
      </div>
      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check-circle" />
          {aviso}
        </div>
      )}
      <PanelDePestana idBase="cap-res" valor={vista} className="mz-stack">
        <EstadoDeCarga
          cargando={datos === null}
          error={error}
          onReintentar={cargar}
          vacio={
            datos !== null &&
            (vista === "personas" ? datos.personas : datos.materiales)
              .length === 0
          }
          textoVacio={
            vista === "personas"
              ? "Todavía nadie tiene onboarding asignado."
              : "Todavía no hay materiales de capacitación."
          }
        />

        {datos?.personas.length > 0 && vista === "personas" && (
          <div className="mz-card">
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>Persona</th>
                    <th>Avance</th>
                    <th>Promedio</th>
                    <th>Estado</th>
                    <th>Por reforzar</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.personas.map((p) => (
                    <tr key={p.usuario.id}>
                      <td>
                        <button
                          type="button"
                          className="btn btn-link btn-sm p-0 text-start"
                          onClick={() => setDetalle(p)}
                        >
                          {p.usuario.nombre}
                        </button>
                      </td>
                      <td>
                        {p.aprobados} / {p.total}
                      </td>
                      <td>{p.promedio ?? "—"}</td>
                      <td>
                        {p.completado_en ? (
                          <span className="perfil-cargo-estado perfil-cargo-estado--completo">
                            Completo
                          </span>
                        ) : p.vencido ? (
                          <span className="sugerencia-estado sugerencia-estado--alto">
                            Vencido ({formatearFecha(p.fecha_limite)})
                          </span>
                        ) : (
                          <span className="perfil-cargo-estado perfil-cargo-estado--parcial">
                            Hasta {formatearFecha(p.fecha_limite)}
                          </span>
                        )}
                      </td>
                      <td className="mz-small">
                        {p.a_reforzar.join(", ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {datos?.materiales.length > 0 && vista === "materiales" && (
          <div className="herramientas-uso">
            {datos.materiales.map((m) => (
              <section key={m.id} className="mz-card">
                <div className="mz-card-body">
                  <h4 className="inicio-titulo">
                    {m.titulo}{" "}
                    <span className="mz-faint mz-small">
                      · {m.alcance_display}
                    </span>
                  </h4>
                  <p className="mz-small mb-2">
                    {m.personas} personas · {m.aprobaron} aprobaron · promedio{" "}
                    {m.promedio ?? "—"}
                  </p>
                  {m.mas_falladas.length > 0 ? (
                    <>
                      <strong className="mz-small">Lo que más se falla</strong>
                      <ul className="onboarding-reforzar">
                        {m.mas_falladas.map((f) => (
                          <li key={f.pregunta}>
                            {f.pregunta}{" "}
                            <small className="mz-faint">({f.veces})</small>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="mz-faint mz-small mb-0">
                      Sin fallos registrados.
                    </p>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </PanelDePestana>

      {detalle && (
        <DetallePersona
          fila={detalle}
          onCerrar={() => setDetalle(null)}
          onDevuelto={() => {
            setAviso("Intentos devueltos.");
            cargar();
          }}
        />
      )}
      {asignando && (
        <Asignar
          onCerrar={() => setAsignando(false)}
          onAsignado={(n) => {
            setAsignando(false);
            setAviso(`Onboarding asignado a ${n} persona(s).`);
            cargar();
          }}
        />
      )}
    </div>
  );
}
