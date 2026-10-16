import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { plantillasCorreoService } from "../../../api/plantillasCorreoService";
import { Icon } from "../../../components/common/Icon/Icon";
import { formatearFecha } from "../../../utils/formato";
import { mensajeDeError } from "../../../utils/errores";
import "./PlantillasCorreo.css";

/**
 * Configuración → Notificaciones → Plantillas de correo.
 *
 * Todos los correos que envía el sistema, agrupados por el módulo del que
 * salen, con cuándo se envía cada uno y si ya se personalizó. Cada uno se abre
 * en el editor.
 */
export function PlantillasCorreoPage() {
  const [plantillas, setPlantillas] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    plantillasCorreoService
      .list()
      .then(setPlantillas)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudieron cargar las plantillas.")),
      );
  }, []);

  const porModulo = new Map();
  for (const plantilla of plantillas ?? []) {
    const modulo = plantilla.modulo.split(" · ")[0];
    if (!porModulo.has(modulo)) porModulo.set(modulo, []);
    porModulo.get(modulo).push(plantilla);
  }

  return (
    <div className="plantillas-correo">
      <p className="mz-faint">
        Los correos que envía el sistema. Cada uno se puede editar o reemplazar
        por un diseño propio pegando su HTML, con variables para los datos de
        cada envío. Lo que no se personalice sale con el diseño por defecto.
      </p>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {!plantillas && !error && <div className="mz-empty">Cargando…</div>}

      {[...porModulo.entries()].map(([modulo, lista]) => (
        <section className="mz-card plantillas-correo__grupo" key={modulo}>
          <div className="mz-card-head">
            <h3>{modulo}</h3>
          </div>
          <div className="mz-table-wrap">
            <table className="mz-table">
              <thead>
                <tr>
                  <th>Correo</th>
                  <th>Cuándo se envía y a quién</th>
                  <th>Diseño</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {lista.map((plantilla) => (
                  <tr key={plantilla.clave}>
                    <td>
                      <span className="mz-strong">{plantilla.nombre}</span>
                      <div className="mz-small mz-faint">
                        {plantilla.modulo}
                      </div>
                    </td>
                    <td className="plantillas-correo__cuando">
                      {plantilla.descripcion}
                    </td>
                    <td>
                      {plantilla.personalizada ? (
                        <>
                          <span className="mz-pill mz-pill--ok">
                            Personalizado
                          </span>
                          {plantilla.actualizado_en && (
                            <div className="mz-small mz-faint">
                              {formatearFecha(plantilla.actualizado_en, true)}
                              {plantilla.actualizado_por &&
                                ` · ${plantilla.actualizado_por}`}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="mz-pill mz-pill--neutral">
                          Por defecto
                        </span>
                      )}
                    </td>
                    <td className="num">
                      <Link
                        className="btn btn-outline-primary btn-sm"
                        to={`/admin/configuracion/notificaciones/plantillas/${plantilla.clave}`}
                      >
                        Editar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
