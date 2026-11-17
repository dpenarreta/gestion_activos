import { sincronizacionNominaService } from "../../../api/sincronizacionNominaService";
import { Icon } from "../../../components/common/Icon/Icon";
import { useResultadosEnVivo } from "../../../hooks/useBusquedaEnVivo";
import "./CodigoDesdeNomina.css";

/**
 * Sugerir el código de empleado por nombres y apellidos (17/11/2026, pedido
 * del usuario): mientras se escriben, se buscan en nómina. Una coincidencia
 * se ofrece para usarla; varias se listan todas para elegir. Un código que
 * ya es de otra cuenta se muestra, pero no se puede elegir.
 */
/** Ocupa todo el ancho de la rejilla del formulario. */
function Fila({ children }) {
  return <div className="mz-field mz-field--full">{children}</div>;
}

export function CodigoDesdeNomina({ nombres, apellidos, codigo, onUsar }) {
  const clave = `${(nombres ?? "").trim()}|${(apellidos ?? "").trim()}`;
  const busqueda = useResultadosEnVivo(clave, (texto) => {
    const [n, a] = texto.split("|");
    if (!n || !a) return Promise.resolve(null);
    return sincronizacionNominaService
      .coincidencias(n, a)
      .catch(() => ({ configurada: true, resultados: [], error: true }));
  });
  const datos = busqueda.datos;
  if (!datos || datos.configurada === false) return null;
  if (datos.error) {
    return (
      <Fila>
        <p className="mz-small mz-faint mt-1 mb-0">
          No se pudo consultar nómina para sugerir el código.
        </p>
      </Fila>
    );
  }
  const resultados = datos.resultados ?? [];
  if (resultados.length === 0) {
    return (
      <Fila>
        <p className="mz-small mz-faint mt-1 mb-0" role="status">
          Nadie en nómina coincide con esos nombres y apellidos.
        </p>
      </Fila>
    );
  }
  const elegido = resultados.find((r) => r.codigo === (codigo ?? "").trim());
  if (elegido) {
    return (
      <Fila>
        <p className="mz-small mt-1 mb-0 text-success" role="status">
          <Icon name="check2-circle" /> Coincide con nómina: {elegido.nombres}{" "}
          {elegido.apellidos}.
        </p>
      </Fila>
    );
  }
  return (
    <Fila>
      <div className="codigo-nomina mt-2" role="status">
        <p className="mz-small mb-1">
          {resultados.length === 1
            ? "En nómina hay una persona con ese nombre:"
            : `En nómina hay ${resultados.length} personas con ese nombre; elija la que corresponde:`}
        </p>
        <ul className="codigo-nomina__lista">
          {resultados.map((r) => (
            <li key={r.codigo} className="codigo-nomina__fila">
              <span>
                <span className="mz-strong">
                  {r.nombres} {r.apellidos}
                </span>
                <span className="mz-faint mz-small d-block">
                  Código {r.codigo}
                  {r.correo ? ` · ${r.correo}` : ""}
                  {r.asignado_a
                    ? ` · ya es de la cuenta «${r.asignado_a}»`
                    : ""}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                disabled={Boolean(r.asignado_a)}
                onClick={() => onUsar(r.codigo)}
              >
                Usar este código
                <span className="visually-hidden">
                  {" "}
                  ({r.nombres} {r.apellidos})
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Fila>
  );
}
