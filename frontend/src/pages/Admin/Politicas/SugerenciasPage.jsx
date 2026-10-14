import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { politicasService } from "../../../api/politicasService";
import { NivelRenovacion } from "../../../components/activos/NivelRenovacion/NivelRenovacion";
import { Icon } from "../../../components/common/Icon/Icon";
import { usePermission } from "../../../hooks/usePermission";
import "./Politicas.css";

const ETIQUETAS_CRITERIO = {
  mantenimientos: "Intervenciones",
  componentes_criticos: "Piezas críticas",
  longevidad: "Antigüedad",
};

/**
 * Equipos que exceden sus umbrales (RF-07).
 *
 * El propósito declarado del requerimiento es dar al área financiera un
 * respaldo cuantitativo para justificar una compra, así que la pantalla se
 * organiza alrededor de las cifras: cada activo muestra qué criterio superó,
 * con qué valor y contra qué umbral. Un listado que solo dijera "conviene
 * renovar" no serviría para presentar el caso.
 */
export function SugerenciasPage() {
  const puedeConfigurar = usePermission("politicas.editar");
  const [datos, setDatos] = useState(null);
  const [nivel, setNivel] = useState("");
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const cargar = useCallback(() => {
    setIsLoading(true);
    politicasService
      .sugerencias(nivel ? { nivel } : undefined)
      .then(setDatos)
      .catch(() =>
        setError("No se pudieron cargar las sugerencias de renovación."),
      )
      .finally(() => setIsLoading(false));
  }, [nivel]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div className="politicas-page">
      <div className="mz-view-head">
        <div>
          <h2>Sugerencias de renovación</h2>
          <p className="mz-desc">
            Los equipos que superan algún umbral de su política, con las cifras
            que lo sostienen.
          </p>
        </div>
        {puedeConfigurar && (
          <div className="mz-view-actions">
            <Link
              to="/admin/politicas"
              className="btn btn-outline-secondary btn-sm"
            >
              <Icon name="sliders" /> Configurar umbrales
            </Link>
          </div>
        )}
      </div>

      <div className="mz-filter-bar">
        <select
          className="form-select form-select-sm"
          aria-label="Filtrar por nivel de sugerencia"
          value={nivel}
          onChange={(event) => setNivel(event.target.value)}
        >
          <option value="">Todos los niveles</option>
          <option value="recomendado">Reemplazo recomendado</option>
          <option value="evaluar">Evaluar reemplazo</option>
        </select>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {!isLoading && datos && datos.total === 0 && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="check2-circle" />
          {nivel
            ? "Ningún equipo está hoy en ese nivel."
            : "Ningún equipo excede hoy los umbrales configurados."}
        </div>
      )}

      {datos && datos.total > 0 && (
        <>
          <p className="mz-faint">
            {datos.total} equipo(s) superan al menos un umbral de su política
            {datos.por_nivel && !nivel && (
              <>
                {" "}
                — {datos.por_nivel.recomendado} con reemplazo recomendado y{" "}
                {datos.por_nivel.evaluar} a evaluar
              </>
            )}
            . Las cifras respaldan la solicitud de reemplazo ante el área
            financiera.
          </p>

          <div className="sugerencias-grid">
            {datos.resultados.map((activo) => (
              <article className="mz-card sugerencia-card" key={activo.id}>
                <div className="mz-card-body">
                  <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                    <div>
                      <h3 className="sugerencia-nombre">{activo.nombre}</h3>
                      <span className="mz-code">{activo.codigo_barras}</span>
                    </div>
                    <div className="text-end">
                      <NivelRenovacion
                        nivel={activo.nivel_renovacion}
                        etiqueta={activo.nivel_renovacion_display}
                      />
                      <Link
                        to={`/admin/activos/${activo.id}`}
                        className="btn btn-outline-primary btn-sm d-block mt-2"
                      >
                        Ficha
                      </Link>
                    </div>
                  </div>

                  <p className="mz-small mz-faint mb-3">
                    {activo.marca} {activo.modelo} · {activo.tipo}
                    <br />
                    {activo.departamento}
                    {activo.custodio && ` · ${activo.custodio}`}
                  </p>

                  <ul className="list-unstyled mb-0">
                    {activo.motivos.map((motivo) => (
                      <li key={motivo.criterio} className="sugerencia-motivo">
                        <span className="mz-faint">
                          {ETIQUETAS_CRITERIO[motivo.criterio] ||
                            motivo.criterio}
                        </span>
                        <span className="sugerencia-motivo__cifra">
                          {motivo.valor_actual}
                          <span className="mz-faint"> / {motivo.umbral}</span>
                        </span>
                      </li>
                    ))}
                  </ul>

                  {activo.politica_aplicada && (
                    <p className="mz-small mz-faint mt-3 mb-0">
                      Política: {activo.politica_aplicada}
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
