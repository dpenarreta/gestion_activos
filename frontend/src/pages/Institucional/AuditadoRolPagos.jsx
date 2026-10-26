import { useState } from "react";

import { nominaService } from "../../api/nominaService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { descargarBlob } from "../../utils/descargas";
import { mensajeDeError } from "../../utils/errores";
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

const clave = (anio, mes) => `${anio}-${String(mes).padStart(2, "0")}`;

function nombreDelArchivo(codigo, periodos) {
  const [primero] = periodos;
  if (periodos.length === 1) {
    return `Rol auditado - ${codigo} - ${clave(primero.anio, primero.mes)} ${MESES[primero.mes - 1]}.pdf`;
  }
  const ultimo = periodos[periodos.length - 1];
  return `Roles auditados - ${codigo} - ${clave(primero.anio, primero.mes)} a ${clave(ultimo.anio, ultimo.mes)}.zip`;
}

/**
 * Rol de pagos → Descargar rol auditado (`roles_pago.historial`,
 * 26/10/2026): se busca a la persona por su código y se eligen uno o varios
 * meses. Cada mes es un PDF sin clave: arriba el rol de pagos y abajo la
 * constancia de todo lo que pasó con él (apertura y términos, descargas,
 * envíos al correo, aceptación, observaciones, correcciones de Talento Humano
 * y su cierre). Un mes baja como PDF; varios, como un ZIP con un PDF por mes.
 */
export function AuditadoRolPagos({ onCerrar }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const hoy = new Date();
  const [codigo, setCodigo] = useState("");
  const [buscado, setBuscado] = useState(null);
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [soloConMovimientos, setSoloConMovimientos] = useState(false);
  const [elegidos, setElegidos] = useState(() => new Set());
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [listo, setListo] = useState(null);
  const [trabajando, setTrabajando] = useState(false);

  async function buscar(e) {
    e.preventDefault();
    const texto = codigo.trim();
    if (!texto) return;
    setError(null);
    setListo(null);
    try {
      const datos = await nominaService.personaAuditada(texto);
      setBuscado(datos);
      setElegidos(new Set());
      // Empieza en el año del último mes con movimientos.
      if (datos.con_movimientos.length) setAnio(datos.con_movimientos[0].anio);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo buscar ese código."));
    }
  }

  const conMovimientos = new Set(
    (buscado?.con_movimientos ?? []).map((p) => clave(p.anio, p.mes)),
  );
  const anios = Array.from(
    new Set([
      ...Array.from({ length: 6 }, (_, i) => hoy.getFullYear() - i),
      ...(buscado?.con_movimientos ?? []).map((p) => p.anio),
    ]),
  ).sort((a, b) => b - a);
  const ultimoMes = anio === hoy.getFullYear() ? hoy.getMonth() + 1 : 12;
  const meses = Array.from({ length: ultimoMes }, (_, i) => i + 1).filter(
    (m) => !soloConMovimientos || conMovimientos.has(clave(anio, m)),
  );
  const periodos = Array.from(elegidos)
    .sort()
    .map((k) => {
      const [a, m] = k.split("-").map(Number);
      return { anio: a, mes: m };
    });

  function alternar(mes) {
    setListo(null);
    setElegidos((actual) => {
      const nuevo = new Set(actual);
      const k = clave(anio, mes);
      if (nuevo.has(k)) nuevo.delete(k);
      else nuevo.add(k);
      return nuevo;
    });
  }

  function todosDelAnio(marcar) {
    setElegidos((actual) => {
      const nuevo = new Set(actual);
      meses.forEach((m) =>
        marcar ? nuevo.add(clave(anio, m)) : nuevo.delete(clave(anio, m)),
      );
      return nuevo;
    });
  }

  async function descargar(e) {
    e.preventDefault();
    setTrabajando(true);
    setError(null);
    setListo(null);
    try {
      const resultado = await nominaService.rolAuditado({
        codigo: buscado.codigo,
        periodos,
        password,
      });
      descargarBlob(resultado.blob, nombreDelArchivo(buscado.codigo, periodos));
      setListo(resultado);
      setPassword("");
    } catch (err) {
      setError(await mensajeDeDescarga(err));
    } finally {
      setTrabajando(false);
    }
  }

  const todosMarcados =
    meses.length > 0 && meses.every((m) => elegidos.has(clave(anio, m)));

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
        aria-label="Descargar rol auditado"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>Descargar rol auditado</h3>
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
            Cada mes es un PDF sin clave: arriba el rol de pagos y abajo todo lo
            que pasó con él, con fecha, hora, quién e IP (cuándo se abrió y se
            aceptaron los términos, cuándo se descargó, cuándo se envió al
            correo, cuándo se aceptó, cada observación y cada corrección de
            Talento Humano). Un mes baja como PDF; varios, como un ZIP con un
            PDF por mes.
          </p>

          <form className="rol-auditado__buscar" onSubmit={buscar}>
            <div>
              <label className="form-label mz-small" htmlFor="auditado-codigo">
                Código de empleado
              </label>
              <input
                id="auditado-codigo"
                className="form-control form-control-sm"
                inputMode="numeric"
                maxLength={40}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn btn-outline-primary btn-sm"
              disabled={!codigo.trim()}
            >
              <Icon name="search" /> Buscar
            </button>
          </form>

          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}

          {buscado && (
            <form className="mz-stack" onSubmit={descargar}>
              <p className="mb-0">
                {buscado.persona ? (
                  <>
                    <strong>{buscado.persona.nombre}</strong>{" "}
                    <span className="mz-faint">
                      · {buscado.persona.correo} · código {buscado.codigo}
                    </span>
                  </>
                ) : (
                  <span className="mz-faint">
                    Ninguna cuenta tiene el código {buscado.codigo}; igual se
                    puede generar desde nómina.
                  </span>
                )}
              </p>

              <div className="rol-auditado__filtros">
                <div>
                  <label
                    className="form-label mz-small"
                    htmlFor="auditado-anio"
                  >
                    Año
                  </label>
                  <select
                    id="auditado-anio"
                    className="form-select form-select-sm"
                    value={anio}
                    onChange={(e) => setAnio(Number(e.target.value))}
                  >
                    {anios.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="form-check m-0">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={soloConMovimientos}
                    onChange={(e) => setSoloConMovimientos(e.target.checked)}
                  />{" "}
                  <span className="form-check-label mz-small">
                    Solo meses con movimientos
                  </span>
                </label>
                {meses.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-link btn-sm p-0"
                    onClick={() => todosDelAnio(!todosMarcados)}
                  >
                    {todosMarcados
                      ? "Quitar los de este año"
                      : "Marcar todos los de este año"}
                  </button>
                )}
              </div>

              <fieldset className="rol-auditado__meses">
                <legend className="visually-hidden">Meses de {anio}</legend>
                {meses.map((m) => {
                  const k = clave(anio, m);
                  return (
                    <label
                      key={k}
                      className={`rol-auditado__mes ${elegidos.has(k) ? "is-elegido" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={elegidos.has(k)}
                        onChange={() => alternar(m)}
                      />
                      <span>{MESES[m - 1]}</span>
                      {conMovimientos.has(k) && (
                        <small title="La persona abrió este rol o hubo observaciones">
                          <Icon name="clock-history" /> Con movimientos
                        </small>
                      )}
                    </label>
                  );
                })}
                {meses.length === 0 && (
                  <p className="mz-faint mz-small mb-0">
                    Sin meses con movimientos en {anio}.
                  </p>
                )}
              </fieldset>

              {periodos.length > 0 && (
                <p className="mz-small mb-0">
                  <strong>{periodos.length}</strong> mes(es):{" "}
                  {periodos
                    .map((p) => `${MESES[p.mes - 1]} ${p.anio}`)
                    .join(", ")}
                  . Baja como {periodos.length === 1 ? "PDF" : "ZIP"}.
                </p>
              )}

              <div className="rol-auditado__confirmar">
                <div>
                  <label
                    className="form-label mz-small"
                    htmlFor="auditado-password"
                  >
                    Confirme su contraseña
                  </label>
                  <input
                    id="auditado-password"
                    type="password"
                    className="form-control form-control-sm"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={trabajando || !periodos.length || !password}
                >
                  <Icon name="file-earmark-pdf" />{" "}
                  {trabajando
                    ? "Generando…"
                    : periodos.length > 1
                      ? `Descargar ZIP (${periodos.length} PDF)`
                      : "Descargar PDF"}
                </button>
              </div>

              {listo && (
                <div className="mz-alert mz-alert--ok" role="status">
                  <Icon name="check-circle" />
                  Se descargó: {listo.incluidos} rol(es) auditado(s)
                  {listo.omitidos
                    ? ` · ${listo.omitidos} mes(es) sin rol ni movimientos (ver LEEME)`
                    : ""}
                  .
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
