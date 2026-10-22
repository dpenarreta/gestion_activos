import { useState } from "react";

import { nominaService } from "../../api/nominaService";
import { Icon } from "../../components/common/Icon/Icon";
import { VisorPdf } from "../../components/common/VisorPdf/VisorPdf";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import { AdjuntosObservacion } from "./AdjuntosObservacion";

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** «martes 21/10/2026 10:32:05». */
function cuando(momento) {
  if (!momento) return "—";
  return `${momento.dia} ${momento.fecha} ${momento.hora}`;
}

const CLASE_CONFORMIDAD = {
  conforme: "perfil-cargo-estado--completo",
  conforme_al_cerrar: "perfil-cargo-estado--parcial",
  observacion: "sugerencia-estado--alto",
};

/** Un período: sus consultas y, si hubo, la observación. */
function Periodo({ periodo, onVer, abriendo }) {
  return (
    <section className="historial-rol__periodo">
      <div className="historial-rol__cabecera">
        <div>
          <h4 className="text-capitalize">
            Rol de {MESES[periodo.mes - 1]} {periodo.anio}
          </h4>
          <small className="mz-faint">
            Del {periodo.desde} al {periodo.hasta}
          </small>
        </div>
        <button
          type="button"
          className="btn btn-outline-primary btn-sm"
          disabled={abriendo}
          onClick={() => onVer(periodo)}
        >
          <Icon name="file-earmark-pdf" /> {abriendo ? "Abriendo…" : "Ver rol"}
        </button>
      </div>
      <div className="table-responsive">
        <table className="table table-sm align-middle mb-0">
          <thead>
            <tr>
              <th>Consultó y aceptó los términos</th>
              <th>Por</th>
              <th>IP</th>
              <th>Conformidad con el rol</th>
              <th>Respondió</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {periodo.consultas.map((c) => (
              <tr key={c.id}>
                <td>{cuando(c.consultada)}</td>
                <td>
                  {c.por}
                  {!c.propia && (
                    <small className="mz-faint d-block">(Talento Humano)</small>
                  )}
                </td>
                <td className="mz-small">{c.ip || "—"}</td>
                <td>
                  {c.conformidad ? (
                    <span
                      className={`perfil-cargo-estado ${CLASE_CONFORMIDAD[c.conformidad] ?? ""}`}
                    >
                      {c.conformidad_display}
                    </span>
                  ) : (
                    <span className="mz-faint mz-small">
                      {c.propia ? "Sin responder" : "No aplica"}
                    </span>
                  )}
                </td>
                <td>{cuando(c.conformidad_en)}</td>
                <td className="mz-small">{c.conformidad_ip || "—"}</td>
              </tr>
            ))}
            {periodo.consultas.length === 0 && (
              <tr>
                <td colSpan={6} className="mz-faint">
                  Sin consultas registradas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {periodo.observacion && (
        <div className="historial-rol__observacion">
          <strong className="mz-small">
            Observación · {periodo.observacion.estado_display}
          </strong>
          <ol className="sugerencia-comentarios">
            {periodo.observacion.mensajes.map((m, i) => (
              <li key={i}>
                <strong>{m.tipo_display}</strong>{" "}
                <small className="mz-faint">
                  · {m.autor} · {cuando(m.momento)}
                </small>
                {m.texto && <p className="mb-0">{m.texto}</p>}
                <AdjuntosObservacion adjuntos={m.adjuntos} />
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

/**
 * Rol de pagos → Historial (`roles_pago.historial`): por código de empleado,
 * todos los roles consultados, cuándo se aceptaron los términos, la
 * conformidad de la persona y, si hubo, su observación con la corrección y la
 * confirmación. Nunca montos.
 */
export function HistorialRolPagos({ onCerrar }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const [codigo, setCodigo] = useState("");
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [buscando, setBuscando] = useState(false);
  // Ver un rol de otra persona pide su contraseña una vez por ventana; se
  // guarda solo en memoria mientras esta ventana está abierta.
  const [clave, setClave] = useState("");
  const [pidiendo, setPidiendo] = useState(null);
  const [abriendo, setAbriendo] = useState(null);
  const [pdf, setPdf] = useState(null);

  async function abrirRol(periodo, contrasena = clave) {
    if (!contrasena) {
      setPidiendo(periodo);
      return;
    }
    setAbriendo(`${periodo.anio}-${periodo.mes}`);
    setError(null);
    try {
      const blob = await nominaService.rolDelHistorial({
        codigo: datos.codigo,
        anio: periodo.anio,
        mes: periodo.mes,
        password: contrasena,
      });
      setClave(contrasena);
      setPidiendo(null);
      setPdf({ periodo, blob });
    } catch (err) {
      const estado = err?.response?.status;
      if (estado === 403) {
        setClave("");
        setPidiendo(periodo);
        setError("La contraseña no es correcta.");
      } else if (estado === 404) {
        setError(
          `No hay rol de pagos de ${MESES[periodo.mes - 1]} de ${periodo.anio} para ese código.`,
        );
      } else {
        setError(mensajeDeError(err, "No se pudo abrir el rol."));
      }
    } finally {
      setAbriendo(null);
    }
  }

  async function buscar(evento) {
    evento.preventDefault();
    setBuscando(true);
    setError(null);
    try {
      setDatos(await nominaService.historial(codigo.trim()));
    } catch (err) {
      setDatos(null);
      setError(mensajeDeError(err, "No se pudo consultar el historial."));
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal mz-modal--wide historial-rol"
        role="dialog"
        aria-modal="true"
        aria-label="Historial de roles de pagos"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>Historial de roles de pagos</h3>
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
          <form
            className="d-flex flex-wrap gap-2 align-items-end"
            onSubmit={buscar}
          >
            <div>
              <label className="form-label mz-small" htmlFor="historial-codigo">
                Código de empleado
              </label>
              <input
                id="historial-codigo"
                className="form-control form-control-sm"
                inputMode="numeric"
                maxLength={40}
                placeholder="Ej.: 20104758"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!codigo.trim() || buscando}
            >
              <Icon name="search" /> {buscando ? "Buscando…" : "Buscar"}
            </button>
          </form>
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {datos && (
            <>
              <p className="mb-0">
                <strong>
                  {datos.persona?.nombre ?? "Sin cuenta asociada"}
                </strong>{" "}
                <span className="mz-faint">
                  · código {datos.codigo}
                  {datos.persona?.correo && ` · ${datos.persona.correo}`} ·{" "}
                  {datos.periodos.length}{" "}
                  {datos.periodos.length === 1 ? "mes" : "meses"} con consultas
                </span>
              </p>
              {datos.periodos.length === 0 ? (
                <p className="mz-faint mb-0">
                  Ese código no tiene roles consultados.
                </p>
              ) : (
                datos.periodos.map((p) => (
                  <Periodo
                    key={`${p.anio}-${p.mes}`}
                    periodo={p}
                    abriendo={abriendo === `${p.anio}-${p.mes}`}
                    onVer={(periodo) => abrirRol(periodo)}
                  />
                ))
              )}
            </>
          )}
        </div>
        {pidiendo && (
          <PedirClave
            periodo={pidiendo}
            error={error}
            onCancelar={() => {
              setPidiendo(null);
              setError(null);
            }}
            onConfirmar={(contrasena) => abrirRol(pidiendo, contrasena)}
          />
        )}
      </div>
      {pdf && (
        <VisorPdf
          titulo={`Rol de pagos · ${datos?.persona?.nombre ?? datos?.codigo} · ${MESES[pdf.periodo.mes - 1]} ${pdf.periodo.anio}`}
          blob={pdf.blob}
          nombreArchivo={`rol-de-pagos-${datos?.codigo}-${pdf.periodo.anio}-${String(pdf.periodo.mes).padStart(2, "0")}.pdf`}
          onCerrar={() => setPdf(null)}
        />
      )}
    </div>
  );
}

/** La contraseña de quien abre el rol de otra persona. */
function PedirClave({ periodo, error, onCancelar, onConfirmar }) {
  const [valor, setValor] = useState("");
  return (
    <div className="visor-rol__aviso" role="presentation">
      <form
        className="mz-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="historial-clave"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirmar(valor);
        }}
      >
        <div className="mz-panel-body mz-stack">
          <h3 id="historial-clave" className="h6 mb-0">
            <Icon name="shield-lock" /> Confirme su contraseña
          </h3>
          <p className="mb-0 mz-small">
            Para ver el rol de {MESES[periodo.mes - 1]} de {periodo.anio}. Se
            vuelve a generar con los datos de nómina y queda registrado que lo
            abrió.
          </p>
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          <input
            type="password"
            aria-label="Su contraseña"
            autoComplete="current-password"
            className="form-control form-control-sm"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
          <div className="mz-actions justify-content-end">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onCancelar}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!valor}
            >
              Ver rol
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
