/* eslint-disable jsx-a11y/no-redundant-roles, jsx-a11y/no-interactive-element-to-noninteractive-role --
 * Roles de tabla explícitos a propósito: en teléfono las tablas se apilan con
 * `display: block` (`.ie-apilable`) y Chrome y Safari dejan entonces de
 * exponerlas como tabla al lector de pantalla. Repetir table/rowgroup/row/
 * columnheader/rowheader/cell conserva la semántica (auditoría UX/UI). */
/*
 * Lo que solo ve quien administra los informes (`informes_gh.administrar`):
 * la bitácora de un informe (generado, abierto, exportado…) y los incidentes
 * de integridad que anotó el motor al generarlo. El servidor vuelve a pedir
 * el permiso en cada petición.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { errorDeInformes, informesService } from "../../../api/informesService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import { fechaHora } from "../comunes";
import { rutaDeInforme, valorLegible } from "./informesComunes";

const POR_PAGINA = 20;

/** Carga con reintento y sin carreras (la respuesta vieja no pisa a la
 * nueva). */
function useCarga(pedir, dependencias, porDefecto) {
  const [estado, setEstado] = useState({
    datos: null,
    error: null,
    cargando: true,
  });
  const [vez, setVez] = useState(0);
  useEffect(() => {
    let vigente = true;
    setEstado((e) => ({ ...e, error: null, cargando: true }));
    pedir()
      .then((datos) => {
        if (vigente) setEstado({ datos, error: null, cargando: false });
      })
      .catch((err) => {
        if (vigente)
          setEstado({
            datos: null,
            error: errorDeInformes(err, porDefecto).mensaje,
            cargando: false,
          });
      });
    return () => {
      vigente = false;
    };
    // `pedir` cambia en cada render: lo que manda son las dependencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencias, vez]);
  return { ...estado, recargar: () => setVez((v) => v + 1) };
}

/** Lo que dice cada evento además de su acción. */
function detalleDelEvento(e) {
  const partes = [];
  if (e.step) partes.push(`Paso: ${e.step}`);
  if (e.message) partes.push(e.message);
  if (e.collaborator_count !== null && e.collaborator_count !== undefined)
    partes.push(
      `${e.collaborator_count} ${e.collaborator_count === 1 ? "colaborador" : "colaboradores"}`,
    );
  if (e.generation_ms !== null && e.generation_ms !== undefined)
    partes.push(`${e.generation_ms} ms`);
  return partes.join(" · ") || "—";
}

export function BitacoraInforme({ reportId }) {
  const carga = useCarga(
    () => informesService.bitacora(reportId),
    [reportId],
    "No se pudo cargar la bitácora del informe.",
  );
  const eventos = carga.datos?.events ?? [];
  return (
    <section className="mz-card" aria-labelledby="ie-bitacora-titulo">
      <div className="mz-card-head">
        <h3 id="ie-bitacora-titulo">Bitácora del informe</h3>
      </div>
      <div className="mz-card-body">
        <EstadoDeCarga
          cargando={carga.cargando}
          error={carga.error}
          onReintentar={carga.recargar}
          vacio={!carga.cargando && !carga.error && eventos.length === 0}
          textoVacio="Este informe no tiene eventos en su bitácora."
        />
        {eventos.length > 0 && (
          <div className="ie-tabla-marco">
            <table className="ie-tabla ie-apilable" role="table">
              <caption className="visually-hidden">
                Eventos del informe {reportId}, del más antiguo al más reciente
              </caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">
                    Fecha
                  </th>
                  <th scope="col" role="columnheader">
                    Acción
                  </th>
                  <th scope="col" role="columnheader">
                    Persona
                  </th>
                  <th scope="col" role="columnheader">
                    Detalle
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {eventos.map((e) => (
                  <tr role="row" key={e.id}>
                    <td role="cell" data-etiqueta="Fecha">
                      {fechaHora(e.created_at)}
                    </td>
                    <th scope="row" role="rowheader" data-etiqueta="Acción">
                      {e.action_label || e.action}
                    </th>
                    <td role="cell" data-etiqueta="Persona">
                      {e.user?.name || "—"}
                    </td>
                    <td role="cell" data-etiqueta="Detalle">
                      {detalleDelEvento(e)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Los incidentes de integridad. Con `reportId`, los de ese informe; sin él,
 * los de toda la empresa (con enlace a cada informe).
 */
export function IncidentesDeIntegridad({ reportId }) {
  const [pagina, setPagina] = useState(1);
  const carga = useCarga(
    () =>
      informesService.incidentes({
        page: pagina,
        pageSize: POR_PAGINA,
        reportId,
      }),
    [reportId, pagina],
    "No se pudieron cargar los incidentes de integridad.",
  );
  const incidentes = carga.datos?.incidents ?? [];
  const total = carga.datos?.total ?? 0;
  return (
    <section className="mz-card" aria-labelledby="ie-incidentes-titulo">
      <div className="mz-card-head">
        <h3 id="ie-incidentes-titulo">Incidentes de integridad</h3>
      </div>
      <div className="mz-card-body">
        <p className="mz-desc">
          Diferencias que el motor detectó entre los cálculos al generar un
          informe. Un informe con incidentes queda con integridad parcial.
        </p>
        <EstadoDeCarga
          cargando={carga.cargando}
          error={carga.error}
          onReintentar={carga.recargar}
          vacio={!carga.cargando && !carga.error && incidentes.length === 0}
          textoVacio={
            reportId
              ? "Este informe no tiene incidentes de integridad."
              : "No hay incidentes de integridad registrados."
          }
        />
        {incidentes.length > 0 && (
          <>
            <div className="ie-tabla-marco">
              <table className="ie-tabla ie-apilable" role="table">
                <caption className="visually-hidden">
                  Incidentes de integridad
                </caption>
                <thead role="rowgroup">
                  <tr role="row">
                    <th scope="col" role="columnheader">
                      Detectado
                    </th>
                    {!reportId && (
                      <th scope="col" role="columnheader">
                        Informe
                      </th>
                    )}
                    <th scope="col" role="columnheader">
                      Campo
                    </th>
                    <th scope="col" role="columnheader">
                      Esperado
                    </th>
                    <th scope="col" role="columnheader">
                      Obtenido
                    </th>
                    <th scope="col" role="columnheader">
                      Origen
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {incidentes.map((i) => (
                    <tr role="row" key={i.id}>
                      <td role="cell" data-etiqueta="Detectado">
                        {fechaHora(i.detected_at)}
                      </td>
                      {!reportId && (
                        <td role="cell" data-etiqueta="Informe">
                          <Link
                            to={rutaDeInforme(i.report_id)}
                            className="ie-mono"
                          >
                            {i.report_id}
                          </Link>
                        </td>
                      )}
                      <th scope="row" role="rowheader" data-etiqueta="Campo">
                        <code>{i.field_path}</code>
                      </th>
                      <td role="cell" data-etiqueta="Esperado">
                        {valorLegible(i.expected_value)}
                      </td>
                      <td role="cell" data-etiqueta="Obtenido">
                        {valorLegible(i.actual_value)}
                      </td>
                      <td role="cell" data-etiqueta="Origen">
                        {i.source === "kpis_team" ? "KPI del equipo" : i.source}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacion
              total={total}
              pagina={pagina}
              hasPrevious={pagina > 1}
              hasNext={pagina * POR_PAGINA < total}
              onCambiarPagina={setPagina}
              etiqueta={total === 1 ? "incidente" : "incidentes"}
            />
          </>
        )}
      </div>
    </section>
  );
}
