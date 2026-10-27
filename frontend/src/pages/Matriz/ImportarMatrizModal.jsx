import { useMemo, useState } from "react";

import { matrizService } from "../../api/matrizService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import { PERIODICIDADES } from "./formatoMatriz";

function Cifra({ valor, texto, tono }) {
  return (
    <div
      className={`mz-import-cifra${tono ? ` mz-import-cifra--${tono}` : ""}`}
    >
      <strong>{valor}</strong>
      <span>{texto}</span>
    </div>
  );
}

function fecha(iso) {
  if (!iso) return "—";
  const [anio, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${anio}`;
}

/**
 * Matriz → «Importar matriz legal» (27/10/2026): el Excel de Administración
 * (hojas CONSOLIDADO, CONTABILIDAD y ARRIENDOS). Primero se simula —qué se
 * crea, qué se actualiza, con qué tema, entidad, sede y vencimiento, y lo
 * que impide importar— y solo después se importa.
 */
export function ImportarMatrizModal({ onCerrar, onImportado }) {
  const [archivo, setArchivo] = useState(null);
  const [plan, setPlan] = useState(null);
  const [hecho, setHecho] = useState(null);
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(false);
  const [filtro, setFiltro] = useState("todas");
  // Mientras simula o importa no se cierra: la importación quedaría a medias
  // a la vista de quien la lanzó.
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
    guardClose: () => !trabajando,
  });

  const filas = useMemo(() => {
    const todas = plan?.obligaciones ?? [];
    if (filtro === "crear") return todas.filter((o) => o.accion === "crear");
    if (filtro === "confirmar") return todas.filter((o) => o.por_confirmar);
    return todas;
  }, [plan, filtro]);

  async function enviar(aplicar) {
    if (!archivo) return;
    setTrabajando(true);
    setError(null);
    try {
      const respuesta = await matrizService.importar(archivo, aplicar);
      setPlan(respuesta);
      if (aplicar) {
        setHecho(respuesta.aplicado);
        onImportado?.();
      }
    } catch (err) {
      const datos = err?.response?.data;
      // Si trae la lista de errores, esa lista lo explica: sin un aviso más.
      if (datos?.errores?.length) setPlan(datos);
      else setError(mensajeDeError(err, "No se pudo leer la matriz legal."));
    } finally {
      setTrabajando(false);
    }
  }

  const bloqueado = Boolean(plan?.errores?.length);

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
        aria-labelledby="importar-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <div>
            <h3 id="importar-titulo">Importar matriz legal</h3>
            <p className="mz-desc">
              El Excel de Administración (hojas CONSOLIDADO, CONTABILIDAD y
              ARRIENDOS). Primero se simula; nada se guarda hasta que pulse
              «Importar».
            </p>
          </div>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            disabled={trabajando}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body mz-stack" aria-busy={trabajando}>
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {hecho && (
            <div className="mz-alert mz-alert--ok" role="status">
              <Icon name="check-circle" />
              Listo: {hecho.creadas} obligaciones creadas y {hecho.actualizadas}{" "}
              actualizadas
              {hecho.entidades_nuevas
                ? `, ${hecho.entidades_nuevas} entidades nuevas`
                : ""}
              {hecho.sedes_nuevas ? `, ${hecho.sedes_nuevas} sedes nuevas` : ""}
              {hecho.temas_nuevos ? `, ${hecho.temas_nuevos} temas nuevos` : ""}
              .
            </div>
          )}

          {!hecho && (
            <div className="mz-import-archivo">
              <label className="form-label mz-small" htmlFor="importar-archivo">
                Archivo (.xlsx)
              </label>
              <div className="d-flex flex-wrap gap-2 align-items-center">
                <input
                  id="importar-archivo"
                  type="file"
                  accept=".xlsx"
                  className="form-control form-control-sm mz-import-input"
                  aria-describedby="importar-ayuda"
                  onChange={(e) => {
                    setArchivo(e.target.files?.[0] ?? null);
                    setPlan(null);
                    setError(null);
                  }}
                />
                <button
                  type="button"
                  className={`btn btn-sm ${plan ? "btn-outline-primary" : "btn-primary"}`}
                  disabled={!archivo || trabajando}
                  onClick={() => enviar(false)}
                >
                  {trabajando && !plan ? (
                    <span
                      className="spinner-border spinner-border-sm"
                      aria-hidden="true"
                    />
                  ) : (
                    <Icon name="search" />
                  )}{" "}
                  {trabajando && !plan
                    ? "Revisando…"
                    : plan
                      ? "Simular de nuevo"
                      : "Simular"}
                </button>
              </div>
              <p id="importar-ayuda" className="mz-small mz-faint mb-0 mt-1">
                Simule primero: verá qué se crea y qué se actualiza antes de
                guardar nada.
              </p>
            </div>
          )}

          {plan && !hecho && (
            <>
              <p className="visually-hidden" role="status">
                Simulación lista: {plan.filas} filas, {plan.crear} se crean y{" "}
                {plan.actualizar} se actualizan.
              </p>
              <div className="mz-import-cifras">
                <Cifra valor={plan.filas} texto="filas leídas" />
                <Cifra valor={plan.crear} texto="se crean" tono="ok" />
                <Cifra valor={plan.actualizar} texto="se actualizan" />
                <Cifra
                  valor={plan.por_confirmar}
                  texto="con fecha por confirmar"
                  tono="warn"
                />
              </div>

              {plan.errores?.length > 0 && (
                <div className="mz-alert mz-alert--bad" role="alert">
                  <Icon name="x-octagon" />
                  <div>
                    <strong>No se puede importar todavía:</strong>
                    <ul className="mb-0">
                      {plan.errores.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <dl className="mz-import-datos">
                <div>
                  <dt>Responsable</dt>
                  <dd>
                    {plan.responsable
                      ? `${plan.responsable.nombre} (${plan.responsable.correo})`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Suplente</dt>
                  <dd>
                    {plan.suplente
                      ? `${plan.suplente.nombre} (${plan.suplente.correo})`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Entidades nuevas</dt>
                  <dd>
                    {plan.entidades_nuevas?.length
                      ? plan.entidades_nuevas.join(" · ")
                      : "Ninguna"}
                  </dd>
                </div>
                <div>
                  <dt>Sedes nuevas</dt>
                  <dd>
                    {plan.sedes_nuevas?.length
                      ? plan.sedes_nuevas.join(" · ")
                      : "Ninguna"}
                  </dd>
                </div>
                <div className="mz-import-datos__ancho">
                  <dt>Temas nuevos</dt>
                  <dd>
                    {plan.temas_nuevos?.length
                      ? plan.temas_nuevos.join(" · ")
                      : "Ninguno"}
                  </dd>
                </div>
              </dl>

              {plan.avisos?.length > 0 && (
                <details className="mz-import-avisos">
                  <summary>
                    {plan.avisos.length} aviso
                    {plan.avisos.length === 1 ? "" : "s"} de la lectura
                  </summary>
                  <ul>
                    {plan.avisos.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </details>
              )}

              <div
                className="mz-import-filtro"
                role="group"
                aria-label="Mostrar"
              >
                {[
                  ["todas", `Todas (${plan.filas})`],
                  ["crear", `Nuevas (${plan.crear})`],
                  ["confirmar", `Por confirmar (${plan.por_confirmar})`],
                ].map(([valor, texto]) => (
                  <button
                    key={valor}
                    type="button"
                    className={`btn btn-sm ${filtro === valor ? "btn-secondary" : "btn-outline-secondary"}`}
                    aria-pressed={filtro === valor}
                    onClick={() => setFiltro(valor)}
                  >
                    {texto}
                  </button>
                ))}
              </div>
              <div className="mz-table-wrap mz-import-tabla">
                <table className="mz-table">
                  <thead>
                    <tr>
                      <th>Obligación</th>
                      <th>Tema</th>
                      <th>Entidad</th>
                      <th>Periodicidad</th>
                      <th>Vence</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.length === 0 && (
                      <tr>
                        <td colSpan={6} className="mz-faint">
                          No hay obligaciones en este filtro.
                        </td>
                      </tr>
                    )}
                    {filas.map((o) => (
                      <tr key={o.fila + o.nombre}>
                        <td>
                          {o.nombre}
                          <div className="mz-small mz-faint">{o.fila}</div>
                        </td>
                        <td>{o.tema}</td>
                        <td className="mz-small">{o.entidad}</td>
                        <td>
                          {PERIODICIDADES[o.periodicidad] ?? o.periodicidad}
                        </td>
                        <td className="text-nowrap">
                          {fecha(o.vencimiento)}
                          {o.por_confirmar && (
                            <div className="mz-small mz-import-confirmar">
                              por confirmar
                            </div>
                          )}
                        </td>
                        <td>
                          <span
                            className={`mz-pill ${o.accion === "crear" ? "mz-pill--ok" : "mz-pill--neutral"}`}
                          >
                            {o.accion === "crear" ? "Se crea" : "Se actualiza"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="mz-panel-foot">
          <button
            type="button"
            className="btn btn-cancelar"
            onClick={onCerrar}
            disabled={trabajando}
          >
            {hecho ? "Cerrar" : "Cancelar"}
          </button>
          {plan && !hecho && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={bloqueado || trabajando}
              onClick={() => enviar(true)}
            >
              {trabajando ? (
                <span
                  className="spinner-border spinner-border-sm"
                  aria-hidden="true"
                />
              ) : (
                <Icon name="upload" />
              )}{" "}
              {trabajando
                ? "Importando…"
                : `Importar (${plan.filas} obligaciones)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
