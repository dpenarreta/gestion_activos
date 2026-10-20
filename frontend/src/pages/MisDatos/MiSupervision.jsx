import { Icon } from "../../components/common/Icon/Icon";
import "./MiCargo.css";

function Personas({ personas, vacantes = 0 }) {
  if (!personas.length && !vacantes) return null;
  return (
    <ul className="mi-linea__personas">
      {personas.map((p) => (
        <li key={p.id} className={p.sin_cuenta ? "is-sin-cuenta" : undefined}>
          <Icon name={p.sin_cuenta ? "person-dash" : "person"} /> {p.nombre}
          {p.sin_cuenta && (
            <span className="mi-linea__etiqueta">sin cuenta</span>
          )}
        </li>
      ))}
      {vacantes > 0 && (
        <li className="mi-linea__vacante">
          {vacantes === 1 ? "1 plaza vacante" : `${vacantes} plazas vacantes`}
        </li>
      )}
    </ul>
  );
}

function Cargo({ cargo, nivel }) {
  return (
    <div className={`mi-linea__cargo mi-linea__cargo--${nivel}`}>
      <strong>{cargo.nombre}</strong>
      {cargo.unidad && <small className="mz-faint">{cargo.unidad}</small>}
      <Personas
        personas={cargo.personas}
        vacantes={nivel === "abajo" ? cargo.vacantes : 0}
      />
      {nivel === "arriba" && !cargo.personas.length && (
        <small className="mz-faint">Cargo vacante</small>
      )}
    </div>
  );
}

/**
 * «Mi perfil» → Mi línea de supervisión, según el organigrama: sus jefes (la
 * cadena dentro de su área y su jefe directo), quienes comparten su cargo y
 * los cargos que le reportan directamente, con quién los ocupa.
 */
export function MiSupervision({ linea, cargo }) {
  if (!linea) return null;
  return (
    <section className="mz-card mi-cargo" aria-labelledby="mi-linea-titulo">
      <div className="mz-card-body mz-stack">
        <div>
          <h3 id="mi-linea-titulo" className="h6 mb-1">
            <Icon name="diagram-3" /> Mi línea de supervisión
          </h3>
          <p className="mz-faint mz-small mb-0">
            Según el organigrama: a quién reporta y a quiénes supervisa
            directamente.
          </p>
        </div>

        <div className="mi-linea">
          <div className="mi-linea__grupo" aria-label="Sus jefes">
            <h4>
              <Icon name="arrow-up-circle" /> Reporta a
            </h4>
            {linea.jefes.length ? (
              <ol className="mi-linea__cadena">
                {linea.jefes.map((j) => (
                  <li key={j.id}>
                    <Cargo cargo={j} nivel="arriba" />
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mz-faint mb-0">
                Su cargo no reporta a nadie en el organigrama.
              </p>
            )}
          </div>

          <div className="mi-linea__usted">
            <span className="mz-small mz-faint">Usted</span>
            <strong>{cargo?.nombre}</strong>
            {linea.companeros.length > 0 && (
              <>
                <small className="mz-faint">Comparten su cargo:</small>
                <Personas personas={linea.companeros} />
              </>
            )}
          </div>

          <div className="mi-linea__grupo" aria-label="A quiénes supervisa">
            <h4>
              <Icon name="arrow-down-circle" /> Supervisa
            </h4>
            {linea.supervisa.length ? (
              <ul className="mi-linea__supervisa">
                {linea.supervisa.map((c) => (
                  <li key={c.id}>
                    <Cargo cargo={c} nivel="abajo" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mz-faint mb-0">
                Ningún cargo le reporta directamente.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
