import { useEffect, useMemo, useState } from "react";

import { nominaService } from "../../api/nominaService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { copiarTexto } from "../../utils/copiar";
import { mensajeDeError } from "../../utils/errores";

const MESES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

/** El mes anterior: el último rol de pagos que ya debería estar abierto. */
function mesAnterior(hoy) {
  return hoy.getMonth() === 0
    ? { anio: hoy.getFullYear() - 1, mes: 12 }
    : { anio: hoy.getFullYear(), mes: hoy.getMonth() };
}

/** Un correo o un teléfono: se selecciona entero con un clic y tiene su
 * botón de copiar. */
function Copiable({ valor, etiqueta, icono }) {
  const [copiado, setCopiado] = useState(null);

  useEffect(() => {
    if (copiado === null) return undefined;
    const espera = setTimeout(() => setCopiado(null), 2000);
    return () => clearTimeout(espera);
  }, [copiado]);

  return (
    <div className="rol-seguimiento__dato">
      <Icon name={icono} />
      <span className="rol-seguimiento__valor">{valor}</span>
      <button
        type="button"
        className="btn btn-link btn-sm p-0"
        aria-label={`Copiar ${etiqueta}`}
        title={copiado === false ? "No se pudo copiar: selecciónelo" : "Copiar"}
        onClick={async () => setCopiado(await copiarTexto(valor))}
      >
        <Icon name={copiado ? "check2" : "copy"} />
      </button>
    </div>
  );
}

function Contacto({ persona }) {
  if (!persona.correo && !persona.telefono)
    return <span className="mz-faint mz-small">Sin datos de contacto</span>;
  return (
    <>
      {persona.correo && (
        <Copiable
          valor={persona.correo}
          etiqueta={`el correo de ${persona.nombre}`}
          icono="envelope"
        />
      )}
      {persona.telefono && (
        <Copiable
          valor={persona.telefono}
          etiqueta={`el teléfono de ${persona.nombre}`}
          icono="telephone"
        />
      )}
    </>
  );
}

/** Las mismas insignias del historial por empleado. */
const CONFORMIDAD = {
  conforme: "perfil-cargo-estado--completo",
  conforme_al_cerrar: "perfil-cargo-estado--parcial",
  observacion: "sugerencia-estado--alto",
};

/**
 * Rol de pagos → Roles sin abrir (`roles_pago.seguimiento`, 26/10/2026): de
 * las personas habilitadas, quiénes no han abierto su rol de pagos de un mes,
 * con su correo institucional y, si lo autorizaron, su teléfono, para que
 * Talento Humano se acerque a ellas y lo confirmen. Abrirlo es haberlo
 * consultado la persona misma.
 */
export function SeguimientoRolPagos({ onCerrar }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const hoy = new Date();
  const inicial = mesAnterior(hoy);
  const [anio, setAnio] = useState(inicial.anio);
  const [mes, setMes] = useState(inicial.mes);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [vista, setVista] = useState("sin_abrir");
  const [buscar, setBuscar] = useState("");
  const [correosCopiados, setCorreosCopiados] = useState(null);

  useEffect(() => {
    let vigente = true;
    setDatos(null);
    setError(null);
    nominaService
      .seguimiento(anio, mes)
      .then((d) => vigente && setDatos(d))
      .catch(
        (err) =>
          vigente &&
          setError(mensajeDeError(err, "No se pudo cargar la lista.")),
      );
    return () => {
      vigente = false;
    };
  }, [anio, mes]);

  const filas = useMemo(() => {
    const lista = datos?.[vista] ?? [];
    const texto = buscar.trim().toLowerCase();
    if (!texto) return lista;
    return lista.filter((p) =>
      [p.nombre, p.codigo, p.area, p.cargo, p.correo]
        .join(" ")
        .toLowerCase()
        .includes(texto),
    );
  }, [datos, vista, buscar]);

  const anios = Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i);
  const mesesDelAnio = anio === hoy.getFullYear() ? hoy.getMonth() + 1 : 12;

  async function copiarCorreos() {
    const correos = filas.map((p) => p.correo).filter(Boolean);
    setCorreosCopiados(
      correos.length ? await copiarTexto(correos.join("; ")) : false,
    );
    setTimeout(() => setCorreosCopiados(null), 2500);
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
        aria-label="Roles sin abrir"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>Roles sin abrir</h3>
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
            De las personas habilitadas para ver su rol de pagos, quiénes
            todavía no han abierto el del mes elegido, para acercarse a ellas y
            que lo confirmen. Cuenta solo si la persona lo abrió desde su
            cuenta. El teléfono aparece solo si la persona autorizó que la
            contacten por él.
          </p>
          <div className="row g-2">
            <div className="col-6 col-md-3">
              <label className="form-label mz-small" htmlFor="seguimiento-anio">
                Año
              </label>
              <select
                id="seguimiento-anio"
                className="form-select form-select-sm"
                value={anio}
                onChange={(e) => {
                  const nuevo = Number(e.target.value);
                  setAnio(nuevo);
                  if (nuevo === hoy.getFullYear() && mes > hoy.getMonth() + 1)
                    setMes(hoy.getMonth() + 1);
                }}
              >
                {anios.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label mz-small" htmlFor="seguimiento-mes">
                Mes
              </label>
              <select
                id="seguimiento-mes"
                className="form-select form-select-sm"
                value={mes}
                onChange={(e) => setMes(Number(e.target.value))}
              >
                {MESES.slice(0, mesesDelAnio).map((nombre, i) => (
                  <option key={nombre} value={i + 1}>
                    {nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12 col-md-6">
              <label
                className="form-label mz-small"
                htmlFor="seguimiento-buscar"
              >
                Buscar
              </label>
              <input
                id="seguimiento-buscar"
                className="form-control form-control-sm"
                type="search"
                placeholder="Nombre, código, área o correo"
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {!datos && !error && <p className="mz-faint mb-0">Cargando…</p>}

          {datos && (
            <>
              <div className="rol-seguimiento__barra">
                <div
                  className="btn-group btn-group-sm"
                  role="group"
                  aria-label="Qué personas ver"
                >
                  <button
                    type="button"
                    className={`btn ${vista === "sin_abrir" ? "btn-primary" : "btn-outline-primary"}`}
                    aria-pressed={vista === "sin_abrir"}
                    onClick={() => setVista("sin_abrir")}
                  >
                    Sin abrir ({datos.sin_abrir.length})
                  </button>
                  <button
                    type="button"
                    className={`btn ${vista === "abiertos" ? "btn-primary" : "btn-outline-primary"}`}
                    aria-pressed={vista === "abiertos"}
                    onClick={() => setVista("abiertos")}
                  >
                    Abiertos ({datos.abiertos.length})
                  </button>
                </div>
                <span className="mz-small mz-faint">
                  {datos.periodo} · {datos.habilitados} persona(s) habilitada(s)
                </span>
                {filas.some((p) => p.correo) && (
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm ms-auto"
                    onClick={copiarCorreos}
                  >
                    <Icon name={correosCopiados ? "check2" : "envelope"} />{" "}
                    {correosCopiados
                      ? "Correos copiados"
                      : correosCopiados === false
                        ? "No se pudo copiar"
                        : "Copiar los correos de la lista"}
                  </button>
                )}
              </div>

              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Persona</th>
                      <th>Código</th>
                      <th>Contacto</th>
                      <th>
                        {vista === "sin_abrir"
                          ? "Último rol que abrió"
                          : "Lo abrió"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.nombre}</strong>
                          {(p.cargo || p.area) && (
                            <small className="mz-faint d-block">
                              {[p.cargo, p.area].filter(Boolean).join(" · ")}
                            </small>
                          )}
                        </td>
                        <td>
                          {p.codigo || <span className="mz-faint">—</span>}
                        </td>
                        <td>
                          <Contacto persona={p} />
                        </td>
                        <td className="mz-small">
                          {vista === "sin_abrir" ? (
                            p.ultima_apertura ? (
                              `${p.ultima_apertura.fecha}`
                            ) : (
                              <span className="mz-faint">
                                Nunca ha abierto uno
                              </span>
                            )
                          ) : (
                            <>
                              {p.abierto.fecha} {p.abierto.hora.slice(0, 5)}
                              <span
                                className={`perfil-cargo-estado d-table mt-1 ${CONFORMIDAD[p.conformidad] ?? "perfil-cargo-estado--vacio"}`}
                              >
                                {p.conformidad_display || "Sin responder"}
                              </span>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filas.length === 0 && (
                      <tr>
                        <td colSpan={4} className="mz-faint">
                          {buscar.trim()
                            ? "Nadie con ese nombre."
                            : vista === "sin_abrir"
                              ? "Todas las personas habilitadas ya abrieron su rol de este mes."
                              : "Nadie ha abierto todavía su rol de este mes."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
