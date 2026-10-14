import { useCallback, useEffect, useState } from "react";

import { respaldosService } from "../../../api/respaldosService";
import { ConfirmDialog } from "../../../components/common/ConfirmDialog/ConfirmDialog";
import { Icon } from "../../../components/common/Icon/Icon";
import { mensajeDeError } from "../../../utils/errores";

const MOTIVO_PROTEGIDO =
  "Es el más reciente: se conserva siempre para que haya de dónde volver.";

export function formatearTamano(bytes) {
  if (!bytes) return "0 KB";
  const mb = bytes / 1024 / 1024;
  if (mb >= 1)
    return `${mb.toLocaleString("es-EC", { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fechaDe(respaldo, zona) {
  return new Date(respaldo.fecha).toLocaleString("es-EC", {
    timeZone: zona || undefined,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Qué lleva un respaldo, en píldoras: lo que falta se nota de un vistazo. */
function Partes({ respaldo }) {
  return (
    <span className="respaldo-partes">
      <span
        className={`mz-pill ${respaldo.tiene_base ? "mz-pill--ok" : "mz-pill--neutral"}`}
      >
        <Icon name="database" /> Base
      </span>
      <span
        className={`mz-pill ${respaldo.tiene_adjuntos ? "mz-pill--ok" : "mz-pill--neutral"}`}
      >
        <Icon name="paperclip" /> Adjuntos
      </span>
    </span>
  );
}

function resumen(respaldo) {
  const c = respaldo.contenido;
  if (!c) return "Sin manifiesto";
  return `${c.activos ?? 0} activos · ${c.adjuntos ?? 0} adjuntos`;
}

function AccionBorrar({ respaldo, puedeEditar, onBorrar }) {
  if (!puedeEditar) return null;
  const idMotivo = `respaldo-protegido-${respaldo.marca}`;
  if (respaldo.es_el_mas_reciente) {
    return (
      <div className="respaldo-accion">
        <button
          type="button"
          className="btn btn-outline-danger btn-sm"
          disabled
          aria-describedby={idMotivo}
        >
          <Icon name="trash" /> Borrar
        </button>
        <span id={idMotivo} className="mz-small mz-faint respaldo-motivo">
          <Icon name="shield-check" /> {MOTIVO_PROTEGIDO}
        </span>
      </div>
    );
  }
  return (
    <div className="respaldo-accion">
      <button
        type="button"
        className="btn btn-outline-danger btn-sm"
        onClick={() => onBorrar(respaldo)}
      >
        <Icon name="trash" /> Borrar
      </button>
    </div>
  );
}

/**
 * Los respaldos que hay en disco, con la opción de borrarlos.
 *
 * Borrar es para recuperar espacio: cada copia de la base pesa decenas de
 * megas y se acumulan. Un respaldo se borra entero —base, adjuntos y
 * manifiesto—, porque dejar una parte haría creer que hay de dónde volver. El
 * más reciente no se puede borrar: el botón está y se ve deshabilitado, con el
 * motivo escrito al lado, y el servidor lo rechaza igual si alguien lo intenta.
 *
 * `version` cambia cada vez que la tarea termina un respaldo, para que la lista
 * aparezca al día sin recargar la pantalla.
 */
export function RespaldosGuardados({ puedeEditar, zona, version }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [aBorrar, setABorrar] = useState(null);
  const [isBorrando, setIsBorrando] = useState(false);

  const cargar = useCallback(() => {
    respaldosService
      .archivos()
      .then((respuesta) => {
        setDatos(respuesta);
        setError(null);
      })
      .catch((err) =>
        setError(
          mensajeDeError(err, "No se pudo leer la carpeta de respaldos."),
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar, version]);

  async function confirmarBorrado() {
    setIsBorrando(true);
    try {
      await respaldosService.borrar(aBorrar.marca);
      setABorrar(null);
      cargar();
    } catch (err) {
      setABorrar(null);
      setError(mensajeDeError(err, "No se pudo borrar el respaldo."));
      cargar();
    } finally {
      setIsBorrando(false);
    }
  }

  const respaldos = datos?.respaldos ?? [];
  const total = respaldos.reduce((suma, r) => suma + r.bytes, 0);

  return (
    <section className="mz-card respaldos-guardados">
      <div className="mz-card-head">
        <h3>Respaldos guardados</h3>
        {datos && (
          <span className="mz-small mz-faint">
            {respaldos.length}{" "}
            {respaldos.length === 1 ? "respaldo" : "respaldos"} ·{" "}
            {formatearTamano(total)}
          </span>
        )}
      </div>

      {error && (
        <div className="mz-card-body pb-0">
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        </div>
      )}
      {datos && !datos.borra_la_base && (
        <div className="mz-card-body pb-0">
          <div className="mz-alert mz-alert--warn" role="status">
            <Icon name="exclamation-triangle" />
            Esta máquina no ve la carpeta donde SQL Server guarda las copias de
            la base (RESPALDOS_SQL_LOCAL): borrar un respaldo quita los adjuntos
            y el manifiesto, pero la copia de la base queda en el servidor.
          </div>
        </div>
      )}

      {!datos && !error && <div className="mz-empty">Cargando…</div>}
      {datos && respaldos.length === 0 && (
        <div className="mz-empty">
          <Icon name="archive" />
          <div>Todavía no hay respaldos en disco.</div>
        </div>
      )}

      {respaldos.length > 0 && (
        <>
          <div className="mz-table-wrap respaldos-tabla">
            <table className="mz-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Incluye</th>
                  <th>Contenido</th>
                  <th>Tamaño</th>
                  {puedeEditar && <th aria-label="Acciones" />}
                </tr>
              </thead>
              <tbody>
                {respaldos.map((respaldo) => (
                  <tr key={respaldo.marca}>
                    <td className="mz-strong">
                      {fechaDe(respaldo, zona)}
                      {respaldo.es_el_mas_reciente && (
                        <span className="mz-pill mz-pill--ok ms-2">
                          Más reciente
                        </span>
                      )}
                    </td>
                    <td>
                      <Partes respaldo={respaldo} />
                    </td>
                    <td className="mz-faint">{resumen(respaldo)}</td>
                    <td className="mz-mono">
                      {formatearTamano(respaldo.bytes)}
                    </td>
                    {puedeEditar && (
                      <td>
                        <AccionBorrar
                          respaldo={respaldo}
                          puedeEditar={puedeEditar}
                          onBorrar={setABorrar}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mz-cards respaldos-tarjetas">
            {respaldos.map((respaldo) => (
              <div key={respaldo.marca} className="mz-card-row">
                <div className="mz-row-between">
                  <strong>{fechaDe(respaldo, zona)}</strong>
                  <span className="mz-mono mz-small">
                    {formatearTamano(respaldo.bytes)}
                  </span>
                </div>
                <Partes respaldo={respaldo} />
                <div className="mz-card-meta">
                  <span>{resumen(respaldo)}</span>
                </div>
                <div className="mt-2">
                  <AccionBorrar
                    respaldo={respaldo}
                    puedeEditar={puedeEditar}
                    onBorrar={setABorrar}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <ConfirmDialog
        isOpen={Boolean(aBorrar)}
        title="Borrar respaldo"
        message={
          aBorrar
            ? `Se borrará el respaldo del ${fechaDe(aBorrar, zona)} —copia de la base, adjuntos y manifiesto— y no se podrá recuperar.`
            : ""
        }
        confirmLabel="Borrar respaldo"
        confirmVariant="danger"
        isLoading={isBorrando}
        onConfirm={confirmarBorrado}
        onCancel={() => setABorrar(null)}
      />
    </section>
  );
}
