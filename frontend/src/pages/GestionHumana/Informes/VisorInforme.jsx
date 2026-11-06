/*
 * Visor de un informe ejecutivo: las once páginas congeladas dentro de la
 * intranet (sin descargar nada para leerlo), su estado (período, integridad,
 * calidad del dato, narrativa) y las salidas: Excel (lo arma el servidor) e
 * «Imprimir / Guardar PDF» (lo arma el navegador con la hoja de impresión de
 * `Informes.css`; se avisa al servidor para la bitácora). Quien administra
 * ve también la bitácora y los incidentes de integridad del informe.
 *
 * El servidor responde 404 tanto si el informe no existe como si no se
 * puede ver: no se revela que existe.
 */
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { errorDeInformes, informesService } from "../../../api/informesService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../../components/common/Pestanas/Pestanas";
import { fijarTituloPropio } from "../../../utils/tituloDocumento";
import { Aviso, fechaHora } from "../comunes";
import { BotonExcel, Semaforo } from "../Desempeno/Componentes";
import { Encabezado } from "../Tareas/ContextoTareas";
import { BitacoraInforme, IncidentesDeIntegridad } from "./Administracion";
import { ConAccesoInformes, useInformes } from "./ContextoInformes";
import { DocumentoInforme } from "./DocumentoInforme";
import {
  ESTADO_PERIODO,
  INTEGRIDAD,
  RUTA_INFORMES,
  TONO_ESTADO_PERIODO,
  tonoDeCalidad,
} from "./informesComunes";

export function VisorInforme() {
  return (
    <ConAccesoInformes titulo="Informe ejecutivo">
      <PantallaVisor />
    </ConAccesoInformes>
  );
}

const tituloDe = (informe) =>
  informe.period_label
    ? `Informe ejecutivo · ${informe.period_label}`
    : "Informe ejecutivo";

function Volver() {
  return (
    <Link to={RUTA_INFORMES} className="btn btn-outline-secondary">
      <Icon name="arrow-left" /> Volver a los informes
    </Link>
  );
}

function PantallaVisor() {
  const { reportId } = useParams();
  const { puedeAdministrar } = useInformes();
  const location = useLocation();
  const navigate = useNavigate();
  const [aviso, setAviso] = useState(location.state?.aviso ?? null);

  // El aviso viene en el estado de la navegación: se copia y se borra del
  // historial, si no reaparece al recargar la página.
  useEffect(() => {
    if (location.state?.aviso)
      navigate(location.pathname, { replace: true, state: null });
    // Solo al llegar: después el aviso ya vive en el estado de la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [carga, setCarga] = useState({
    datos: null,
    error: null,
    noEncontrado: false,
  });
  const [vez, setVez] = useState(0);
  const [vista, setVista] = useState("documento");
  const [imprimir, setImprimir] = useState(false);

  useEffect(() => {
    let vigente = true;
    setCarga({ datos: null, error: null, noEncontrado: false });
    informesService
      .obtener(reportId)
      .then((datos) => {
        if (vigente) setCarga({ datos, error: null, noEncontrado: false });
      })
      .catch((err) => {
        if (!vigente) return;
        const e = errorDeInformes(err, "No se pudo abrir el informe.");
        setCarga({
          datos: null,
          error: e.mensaje,
          noEncontrado: e.estado === 404,
        });
      });
    return () => {
      vigente = false;
    };
  }, [reportId, vez]);

  // Imprimir desde otra pestaña: primero se muestra el documento y, ya
  // pintado, se abre el diálogo de impresión del navegador.
  useEffect(() => {
    if (!imprimir || vista !== "documento") return;
    setImprimir(false);
    window.print();
  }, [imprimir, vista]);

  function pedirImpresion() {
    // La bitácora lo anota aunque luego se cancele el diálogo: el navegador
    // no dice si se imprimió. Un fallo aquí no impide imprimir.
    informesService.registrarPdf(reportId).catch(() => {});
    setVista("documento");
    setImprimir(true);
  }

  const informe = carga.datos;

  // La pestaña del navegador dice qué informe es (y el PDF lo toma como
  // nombre sugerido); al salir vuelve al título del menú.
  const titulo = informe ? tituloDe(informe) : null;
  useEffect(() => {
    if (!titulo) return undefined;
    fijarTituloPropio(titulo);
    return () => fijarTituloPropio(null);
  }, [titulo]);

  if (!informe) {
    return (
      <div className="gh-page">
        <Encabezado titulo="Informe ejecutivo">
          <Volver />
        </Encabezado>
        {carga.noEncontrado ? (
          <div className="mz-alert mz-alert--warn" role="alert">
            <Icon name="search" />
            <span>
              No se encontró el informe {reportId} o no tiene acceso a él.
            </span>
          </div>
        ) : (
          <EstadoDeCarga
            cargando={!carga.error}
            error={carga.error}
            onReintentar={() => setVez((v) => v + 1)}
          />
        )}
      </div>
    );
  }

  const sinIa = informe.data?.novaOrigen === "DETERMINISTA";

  return (
    <div className="gh-page">
      <Encabezado
        titulo={tituloDe(informe)}
        descripcion={`${informe.type_label ?? ""} · ${informe.report_id}`}
      >
        <Volver />
        <BotonExcel
          descargar={() => informesService.exportarExcel(informe.report_id)}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={pedirImpresion}
        >
          <Icon name="printer" /> Imprimir / Guardar PDF
        </button>
      </Encabezado>

      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />

      <FichaDeEstado informe={informe} sinIa={sinIa} />

      {puedeAdministrar && (
        <Pestanas
          etiqueta="Secciones del informe"
          idBase="ie-visor"
          valor={vista}
          onCambio={setVista}
          opciones={[
            {
              id: "documento",
              etiqueta: "Informe",
              icono: "file-earmark-text",
            },
            { id: "bitacora", etiqueta: "Bitácora", icono: "clock-history" },
            {
              id: "incidentes",
              etiqueta: "Incidentes de integridad",
              icono: "shield-exclamation",
            },
          ]}
        />
      )}
      <PanelDePestana
        idBase="ie-visor"
        valor={vista}
        sinPestanas={!puedeAdministrar}
      >
        {vista === "bitacora" && puedeAdministrar ? (
          <BitacoraInforme reportId={informe.report_id} />
        ) : vista === "incidentes" && puedeAdministrar ? (
          <IncidentesDeIntegridad reportId={informe.report_id} />
        ) : (
          <DocumentoInforme
            pages={informe.pages}
            reportId={informe.report_id}
            sinIa={sinIa}
            integridad={informe.integrity_flag}
            origen={informe.origin}
          />
        )}
      </PanelDePestana>
    </div>
  );
}

/** El estado del informe en una línea de semáforos, cada uno con su texto
 * (el color nunca va solo), y los problemas de calidad del dato si los hay. */
function FichaDeEstado({ informe, sinIa }) {
  const integridad = INTEGRIDAD[informe.integrity_flag];
  const calidad = informe.data_quality ?? {};
  const pct = Number(calidad.pct);
  const problemas = calidad.issues ?? [];
  return (
    <section className="mz-card ie-ficha" aria-label="Estado del informe">
      <div className="mz-card-body">
        <dl className="ie-ficha__datos">
          <div>
            <dt>Estado del período</dt>
            <dd>
              <Semaforo
                tono={TONO_ESTADO_PERIODO[informe.period_status] ?? "neutral"}
              >
                {informe.period_status_label ||
                  ESTADO_PERIODO[informe.period_status] ||
                  "—"}
              </Semaforo>
            </dd>
          </div>
          <div>
            <dt>Integridad</dt>
            <dd>
              {integridad ? (
                <Semaforo tono={integridad.tono}>{integridad.texto}</Semaforo>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>Calidad del dato</dt>
            <dd>
              {Number.isFinite(pct) ? (
                <Semaforo tono={tonoDeCalidad(pct)}>{pct}%</Semaforo>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt>Narrativa</dt>
            <dd>
              {sinIa ? (
                <Semaforo tono="info">Sin IA (texto determinista)</Semaforo>
              ) : informe.nova ? (
                <Semaforo tono="neutral">Generada con NOVA (IA)</Semaforo>
              ) : (
                "Sin narrativa"
              )}
              {informe.nova_degraded && (
                <Semaforo tono="warn" className="ms-1">
                  Narrativa degradada
                </Semaforo>
              )}
            </dd>
          </div>
          <div>
            <dt>Colaboradores</dt>
            <dd>{informe.collaborator_count ?? "—"}</dd>
          </div>
          <div>
            <dt>Generado</dt>
            <dd>
              {fechaHora(informe.generated_at)}
              {informe.generated_by?.name
                ? ` por ${informe.generated_by.name}`
                : ""}
            </dd>
          </div>
        </dl>
        {informe.integrity_flag === "PARTIAL" && (
          <p className="mz-small mb-0 mt-2">
            El motor detectó diferencias entre los cálculos al generar este
            informe: léalo con cautela.
          </p>
        )}
        {informe.origin === "LEGACY_MIGRATION" && (
          <p className="mz-small mz-faint mb-0 mt-2">
            Informe migrado de Nexo: algunos datos pueden faltar.
          </p>
        )}
        {problemas.length > 0 && (
          <details className="ie-ficha__problemas">
            <summary>
              {problemas.length === 1
                ? "1 problema de calidad del dato"
                : `${problemas.length} problemas de calidad del dato`}
            </summary>
            <ul className="mb-0 mz-small">
              {problemas.map((p) => (
                <li key={p.key ?? p.label}>
                  {p.label}
                  {p.count > 1 ? ` (${p.count})` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
