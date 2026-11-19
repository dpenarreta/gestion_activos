import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { actasEntregaService } from "../../../api/activosService";
import { descargarBlob } from "../../../utils/descargas";
import { mensajeDeError } from "../../../utils/errores";
import { formatearFecha } from "../../../utils/formato";
import { EstadoDeCarga } from "../../common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../common/Icon/Icon";
import { ActaEntregaDialog } from "../ActaEntregaDialog/ActaEntregaDialog";
import "./ActaDelEquipo.css";

/**
 * El acta de entrega AEE-LC-01 en la ficha de un equipo (19/11/2026).
 *
 * Pedido del usuario: al consultar cualquiera de los equipos de una entrega
 * se ve el acta original, con ese equipo y todos los demás que se
 * entregaron con él. La más reciente va primero; si el equipo pasó por
 * otras manos, sus actas anteriores siguen debajo.
 */
export function ActaDelEquipo({ activoId }) {
  const [actas, setActas] = useState(null);
  const [error, setError] = useState(null);
  const [descargando, setDescargando] = useState(null);
  const [errorDescarga, setErrorDescarga] = useState(null);
  const [abierta, setAbierta] = useState(null);

  const cargar = useCallback(() => {
    setError(null);
    actasEntregaService
      .delEquipo(activoId)
      .then(setActas)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo consultar el acta.")),
      );
  }, [activoId]);

  // Al pasar a otra ficha no queda a la vista el acta del equipo anterior,
  // y una respuesta que llega tarde no pisa la nueva (auditoría UX/UI).
  useEffect(() => {
    let vigente = true;
    setActas(null);
    setError(null);
    actasEntregaService
      .delEquipo(activoId)
      .then((datos) => vigente && setActas(datos))
      .catch(
        (err) =>
          vigente &&
          setError(mensajeDeError(err, "No se pudo consultar el acta.")),
      );
    return () => {
      vigente = false;
    };
  }, [activoId]);

  async function descargar(acta, formato) {
    setDescargando(`${acta.id}-${formato}`);
    setErrorDescarga(null);
    try {
      const blob = await actasEntregaService.documento(acta.id, formato);
      descargarBlob(blob, `acta-entrega-AEE-LC-01-${acta.id}.${formato}`);
    } catch (err) {
      setErrorDescarga(mensajeDeError(err, "No se pudo descargar el acta."));
    } finally {
      setDescargando(null);
    }
  }

  return (
    <section className="mz-card mt-4" aria-labelledby="acta-del-equipo">
      <div className="mz-card-head">
        <h3 id="acta-del-equipo">Acta de entrega</h3>
      </div>
      <div className="mz-card-body">
        <EstadoDeCarga
          cargando={actas === null && !error}
          error={error}
          onReintentar={cargar}
          vacio={actas !== null && actas.length === 0}
          textoVacio="Este equipo todavía no tiene acta de entrega. Se genera desde su asignación, en el historial de movimientos."
        />
        {errorDescarga && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {errorDescarga}
          </div>
        )}
        {actas?.map((acta, indice) => {
          const propio = acta.movimientos.find((m) => m.activo.id === activoId);
          return (
            <article
              key={acta.id}
              className={`acta-equipo${indice > 0 ? " acta-equipo--anterior" : ""}`}
              aria-label={`Acta N.º ${acta.id}`}
            >
              <div className="acta-equipo__cabecera">
                <div>
                  <span className="mz-strong">
                    Acta N.º {acta.id} · AEE-LC-01
                  </span>
                  {actas.length > 1 && (
                    <span className="mz-small mz-faint">
                      {indice === 0 ? " · la más reciente" : " · anterior"}
                    </span>
                  )}
                  <div className="mz-small">
                    {formatearFecha(acta.fecha)} · entregado a{" "}
                    <span className="mz-strong">{acta.custodio.nombre}</span>
                    {acta.custodio.cargo ? ` (${acta.custodio.cargo})` : ""}
                    {acta.tecnico && (
                      <span className="mz-faint">
                        {" "}
                        · técnico {acta.tecnico.nombre}
                      </span>
                    )}
                  </div>
                </div>
                <div className="acta-equipo__acciones">
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => descargar(acta, "pdf")}
                    disabled={Boolean(descargando)}
                  >
                    <Icon name="file-earmark-pdf" />{" "}
                    {descargando === `${acta.id}-pdf`
                      ? "Descargando…"
                      : "PDF para imprimir"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => descargar(acta, "docx")}
                    disabled={Boolean(descargando)}
                  >
                    <Icon name="file-earmark-word" />{" "}
                    {descargando === `${acta.id}-docx`
                      ? "Descargando…"
                      : "Word (editable)"}
                  </button>
                  {propio && (
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => setAbierta(propio.id)}
                    >
                      <Icon name="pencil" /> Ver o corregir
                    </button>
                  )}
                </div>
              </div>
              <div className="mz-table-wrap">
                <table className="mz-table">
                  <caption className="visually-hidden">
                    Equipos entregados en el acta N.º {acta.id}
                  </caption>
                  <thead>
                    <tr>
                      <th>Equipo</th>
                      <th>Marca</th>
                      <th>Código</th>
                      <th>Modelo</th>
                      <th>Serie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {acta.movimientos.map((m) => {
                      const esEste = m.activo.id === activoId;
                      return (
                        <tr
                          key={m.id}
                          className={esEste ? "acta-equipo__este" : undefined}
                          aria-current={esEste ? "true" : undefined}
                        >
                          <td data-label="Equipo">
                            {m.activo.tipo}
                            {esEste && (
                              <span className="mz-pill mz-pill--info acta-equipo__marca">
                                Este equipo
                              </span>
                            )}
                          </td>
                          <td data-label="Marca">{m.activo.marca || "—"}</td>
                          <td data-label="Código">
                            {esEste ? (
                              m.activo.codigo_barras
                            ) : (
                              <Link to={`/admin/activos/${m.activo.id}`}>
                                {m.activo.codigo_barras}
                              </Link>
                            )}
                          </td>
                          <td data-label="Modelo">{m.activo.modelo || "—"}</td>
                          <td data-label="Serie">
                            {m.activo.numero_serie || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          );
        })}
      </div>
      {abierta && (
        <ActaEntregaDialog
          movimientoId={abierta}
          onCerrar={() => {
            setAbierta(null);
            cargar();
          }}
        />
      )}
    </section>
  );
}
