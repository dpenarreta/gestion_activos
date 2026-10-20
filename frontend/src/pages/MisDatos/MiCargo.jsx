import { Icon } from "../../components/common/Icon/Icon";
import "./MiCargo.css";

function Lista({ titulo, icono, items }) {
  return (
    <div className="mi-cargo__bloque">
      <h4>
        <Icon name={icono} /> {titulo}
      </h4>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mz-faint mb-0">Todavía no se ha definido.</p>
      )}
    </div>
  );
}

/**
 * «Mi perfil» → Mi cargo: el objetivo, las funciones, las competencias y los
 * KPIs del cargo de la persona. Aparece en cuanto elige su cargo o se lo
 * asignan; el perfil lo escribe quien tiene `institucional.perfil_cargo`.
 */
export function MiCargo({ perfil }) {
  if (!perfil) return null;
  const vacio =
    !perfil.objetivo &&
    !perfil.funciones.length &&
    !perfil.competencias.length &&
    !perfil.kpis.length;
  return (
    <section className="mz-card mi-cargo" aria-labelledby="mi-cargo-titulo">
      <div className="mz-card-body mz-stack">
        <div>
          <h3 id="mi-cargo-titulo" className="h6 mb-1">
            <Icon name="briefcase" /> Mi cargo: {perfil.cargo.nombre}
          </h3>
          <p className="mz-faint mz-small mb-0">
            Lo que se espera de su cargo y cómo se mide.
          </p>
        </div>
        {vacio ? (
          <p className="mz-faint mb-0">
            El perfil de este cargo todavía no se ha cargado. Lo publica Talento
            Humano o la administración del sistema.
          </p>
        ) : (
          <>
            <div className="mi-cargo__objetivo">
              <h4>
                <Icon name="bullseye" /> Objetivo del cargo
              </h4>
              <p className="mb-0">
                {perfil.objetivo || (
                  <span className="mz-faint">Todavía no se ha definido.</span>
                )}
              </p>
            </div>
            <div className="mi-cargo__grilla">
              <Lista
                titulo="Funciones"
                icono="list-check"
                items={perfil.funciones}
              />
              <Lista
                titulo="Competencias"
                icono="stars"
                items={perfil.competencias}
              />
              <Lista
                titulo="KPIs y métricas de medición"
                icono="graph-up-arrow"
                items={perfil.kpis}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
