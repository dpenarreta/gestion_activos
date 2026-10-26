import { useEffect, useMemo, useState } from "react";

import { nominaService } from "../../api/nominaService";
import { Icon } from "../../components/common/Icon/Icon";
import { VisorPdf } from "../../components/common/VisorPdf/VisorPdf";
import { useModalA11y } from "../../hooks/useModalA11y";
import { copiarTexto } from "../../utils/copiar";
import { descargarBlob } from "../../utils/descargas";
import { mensajeDeError } from "../../utils/errores";
import { ConstanciaRol } from "./ConstanciaRol";
import { mensajeDeDescarga } from "./DescargaMasivaRolPagos";

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

/** Los grupos de cada mes; los dos primeros son los pendientes. */
const VISTAS = [
  { id: "sin_abrir", nombre: "Sin abrir" },
  { id: "sin_aceptar", nombre: "Abiertos sin aceptar" },
  { id: "con_observacion", nombre: "Con observación" },
  { id: "aceptados", nombre: "Aceptados" },
];

const VACIO = {
  sin_abrir: "Todas las personas habilitadas ya abrieron su rol de este mes.",
  sin_aceptar: "Nadie tiene el rol abierto sin responder.",
  con_observacion: "Nadie dejó observaciones este mes.",
  aceptados: "Nadie ha aceptado todavía su rol de este mes.",
};

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

/** Ver el rol de pagos de la persona en ese mes, para validarlo: se vuelve
 * a generar desde nómina con la contraseña de quien lo abre
 * (`roles_pago.historial`), como el historial por empleado. */
function VerRol({ persona, anio, mes, onVer }) {
  const [abierto, setAbierto] = useState(false);
  const [clave, setClave] = useState("");
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(false);

  async function ver(e) {
    e.preventDefault();
    setTrabajando(true);
    setError(null);
    try {
      const blob = await nominaService.rolDelHistorial({
        codigo: persona.codigo,
        anio,
        mes,
        password: clave,
      });
      setAbierto(false);
      setClave("");
      onVer({
        blob,
        titulo: `Rol de pagos · ${persona.nombre} · ${MESES[mes - 1]} ${anio}`,
        nombre: `rol-de-pagos-${persona.codigo}-${anio}-${String(mes).padStart(2, "0")}.pdf`,
      });
    } catch (err) {
      setError(await mensajeDeDescarga(err));
    } finally {
      setTrabajando(false);
    }
  }

  if (!persona.codigo) return null;
  if (!abierto) {
    return (
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        aria-label={`Ver el rol de ${persona.nombre}`}
        onClick={() => setAbierto(true)}
      >
        <Icon name="file-earmark-pdf" /> Ver rol
      </button>
    );
  }
  return (
    <form className="descargas-regenerar" onSubmit={ver}>
      <input
        type="password"
        className="form-control form-control-sm"
        aria-label={`Su contraseña para ver el rol de ${persona.nombre}`}
        placeholder="Su contraseña"
        autoComplete="current-password"
        value={clave}
        onChange={(e) => setClave(e.target.value)}
        required
      />
      <button
        type="submit"
        className="btn btn-primary btn-sm"
        disabled={trabajando || !clave}
      >
        Ver
      </button>
      <button
        type="button"
        className="btn btn-link btn-sm"
        onClick={() => setAbierto(false)}
      >
        Cancelar
      </button>
      {error && <small className="text-danger d-block w-100">{error}</small>}
    </form>
  );
}

/** Por mes del año: cuántos lo abrieron, aceptaron, observaron y cuántos
 * están pendientes. Elegir una fila abre el detalle de ese mes. */
function ResumenPorMes({ anio, mesElegido, onElegir }) {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let vigente = true;
    setFilas(null);
    nominaService
      .resumenSeguimiento(anio)
      .then((d) => vigente && setFilas(d))
      .catch(
        (err) =>
          vigente &&
          setError(mensajeDeError(err, "No se pudo cargar el resumen.")),
      );
    return () => {
      vigente = false;
    };
  }, [anio]);

  if (error) return <p className="text-danger mz-small mb-0">{error}</p>;
  if (!filas) return <p className="mz-faint mz-small mb-0">Cargando…</p>;
  return (
    <div className="table-responsive">
      <table className="table table-sm align-middle mb-0 rol-seguimiento__resumen">
        <caption className="mz-small">
          Resumen de {anio}: elija un mes para ver el listado.
        </caption>
        <thead>
          <tr>
            <th>Mes</th>
            <th className="num">Habilitados</th>
            <th className="num">Abrieron</th>
            <th className="num">Aceptaron</th>
            <th className="num">Con observación</th>
            <th className="num">Abiertos sin aceptar</th>
            <th className="num">Sin abrir</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr
              key={f.mes}
              className={f.mes === mesElegido ? "is-elegido" : ""}
            >
              <td>
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0"
                  aria-pressed={f.mes === mesElegido}
                  onClick={() => onElegir(f.mes)}
                >
                  {MESES[f.mes - 1]}
                </button>
              </td>
              <td className="num">{f.habilitados}</td>
              <td className="num">{f.abiertos}</td>
              <td className="num">{f.aceptados}</td>
              <td className="num">{f.con_observacion}</td>
              <td
                className={`num ${f.sin_aceptar ? "rol-seguimiento__alerta" : ""}`}
              >
                {f.sin_aceptar}
              </td>
              <td
                className={`num ${f.sin_abrir ? "rol-seguimiento__alerta" : ""}`}
              >
                {f.sin_abrir}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Rol de pagos → Roles sin abrir (`roles_pago.seguimiento`, 26/10/2026): de
 * las personas habilitadas, por mes, cuántas abrieron y aceptaron su rol y
 * cuántas no, con el listado de las pendientes para llamarles la atención:
 * su código, su correo institucional y, si lo autorizaron, su teléfono. El
 * listado se exporta a Excel y se les puede mandar un recordatorio a la
 * campana. Con `roles_pago.historial` se ve el rol de cada persona para
 * validarlo. Abrirlo es haberlo consultado la persona misma.
 */
export function SeguimientoRolPagos({ onCerrar, puedeVerRol = false }) {
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
  const [aviso, setAviso] = useState(null);
  const [vista, setVista] = useState("sin_abrir");
  const [buscar, setBuscar] = useState("");
  const [correosCopiados, setCorreosCopiados] = useState(null);
  const [confirmandoAviso, setConfirmandoAviso] = useState(false);
  const [viendo, setViendo] = useState(null);

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
  const pendientes = datos
    ? datos.totales.sin_abrir + datos.totales.sin_aceptar
    : 0;

  async function copiarCorreos() {
    const correos = filas.map((p) => p.correo).filter(Boolean);
    setCorreosCopiados(
      correos.length ? await copiarTexto(correos.join("; ")) : false,
    );
    setTimeout(() => setCorreosCopiados(null), 2500);
  }

  async function exportar(estado) {
    setError(null);
    try {
      const blob = await nominaService.exportarSeguimiento(anio, mes, estado);
      descargarBlob(
        blob,
        `roles-${anio}-${String(mes).padStart(2, "0")}-${estado.replace("_", "-")}.xlsx`,
      );
    } catch (err) {
      setError(await mensajeDeDescarga(err));
    }
  }

  async function recordar() {
    setConfirmandoAviso(false);
    setError(null);
    try {
      const { enviadas } = await nominaService.recordarPendientes(anio, mes);
      setAviso(
        enviadas
          ? `Se envió el recordatorio a ${enviadas} persona(s).`
          : "Nadie nuevo a quien recordar: a los pendientes ya se les avisó en las últimas 12 horas.",
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo enviar el recordatorio."));
    }
  }

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
              De las personas habilitadas para ver su rol de pagos, cuántas lo
              abrieron y aceptaron cada mes, y quiénes no, para llamarles la
              atención. Cuenta solo si la persona lo abrió desde su cuenta. El
              teléfono aparece solo si la persona autorizó que la contacten por
              él.
            </p>
            <div className="row g-2">
              <div className="col-6 col-md-3">
                <label
                  className="form-label mz-small"
                  htmlFor="seguimiento-anio"
                >
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
                <label
                  className="form-label mz-small"
                  htmlFor="seguimiento-mes"
                >
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

            <ResumenPorMes anio={anio} mesElegido={mes} onElegir={setMes} />

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
            {!datos && !error && <p className="mz-faint mb-0">Cargando…</p>}

            {datos && (
              <>
                <h4 className="h6 mb-0">
                  {datos.periodo} · {datos.habilitados} persona(s) habilitada(s)
                  ·{" "}
                  <span className={pendientes ? "text-danger" : "text-success"}>
                    {pendientes} pendiente(s)
                  </span>
                </h4>
                <div className="rol-seguimiento__barra">
                  <div
                    className="btn-group btn-group-sm flex-wrap"
                    role="group"
                    aria-label="Qué personas ver"
                  >
                    {VISTAS.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        className={`btn ${vista === v.id ? "btn-primary" : "btn-outline-primary"}`}
                        aria-pressed={vista === v.id}
                        onClick={() => setVista(v.id)}
                      >
                        {v.nombre} ({datos.totales[v.id]})
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rol-seguimiento__barra">
                  <button
                    type="button"
                    className="btn btn-exportar btn-sm"
                    onClick={() => exportar("pendientes")}
                    disabled={!pendientes}
                    title="Sin abrir y abiertos sin aceptar"
                  >
                    <Icon name="file-earmark-spreadsheet" /> Exportar pendientes
                    ({pendientes})
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => exportar("todos")}
                    disabled={!datos.habilitados}
                  >
                    <Icon name="file-earmark-spreadsheet" /> Exportar todos
                  </button>
                  {filas.some((p) => p.correo) && (
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
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
                  {pendientes > 0 &&
                    (confirmandoAviso ? (
                      <span className="rol-seguimiento__confirmar">
                        <span className="mz-small">
                          ¿Enviar un recordatorio a la campana de las{" "}
                          {pendientes} persona(s) pendientes?
                        </span>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={recordar}
                        >
                          Sí, enviar
                        </button>
                        <button
                          type="button"
                          className="btn btn-link btn-sm"
                          onClick={() => setConfirmandoAviso(false)}
                        >
                          Cancelar
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm ms-auto"
                        onClick={() => {
                          setAviso(null);
                          setConfirmandoAviso(true);
                        }}
                      >
                        <Icon name="bell" /> Recordar a los pendientes
                      </button>
                    ))}
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
                            : "Constancia"}
                        </th>
                        {puedeVerRol && <th aria-label="Ver rol" />}
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
                              <ConstanciaRol rol={p} />
                            )}
                          </td>
                          {puedeVerRol && (
                            <td>
                              <VerRol
                                persona={p}
                                anio={anio}
                                mes={mes}
                                onVer={setViendo}
                              />
                            </td>
                          )}
                        </tr>
                      ))}
                      {filas.length === 0 && (
                        <tr>
                          <td
                            colSpan={puedeVerRol ? 5 : 4}
                            className="mz-faint"
                          >
                            {buscar.trim()
                              ? "Nadie con ese nombre."
                              : VACIO[vista]}
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
      {viendo && (
        <VisorPdf
          titulo={viendo.titulo}
          blob={viendo.blob}
          nombreArchivo={viendo.nombre}
          onCerrar={() => setViendo(null)}
        />
      )}
    </>
  );
}
