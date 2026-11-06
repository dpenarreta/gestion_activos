/* eslint-disable jsx-a11y/no-redundant-roles, jsx-a11y/no-interactive-element-to-noninteractive-role --
 * Roles de tabla explícitos a propósito: en teléfono las tablas se apilan con
 * `display: block` (`.ie-apilable`) y Chrome y Safari dejan entonces de
 * exponerlas como tabla al lector de pantalla. Repetir table/rowgroup/row/
 * columnheader/rowheader/cell conserva la semántica (auditoría UX/UI). */
/*
 * Informes ejecutivos de Gestión Humana (`MonthlyReports` de Nexo): el
 * historial de informes congelados que la persona puede abrir, con filtros
 * por tipo y estado del período, y el asistente para generar uno nuevo.
 * Quien administra ve además los incidentes de integridad de toda la
 * empresa.
 *
 * Qué informes aparecen lo decide el servidor (alcance completo, autoría o
 * ver por el organigrama a todas las personas del informe).
 */
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { errorDeInformes, informesService } from "../../../api/informesService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { Paginacion } from "../../../components/common/Paginacion/Paginacion";
import {
  PanelDePestana,
  Pestanas,
} from "../../../components/common/Pestanas/Pestanas";
import { Aviso, fechaHora } from "../comunes";
import { Semaforo } from "../Desempeno/Componentes";
import { Encabezado } from "../Tareas/ContextoTareas";
import { IncidentesDeIntegridad } from "./Administracion";
import { AsistenteInforme } from "./AsistenteInforme";
import { ConAccesoInformes, useInformes } from "./ContextoInformes";
import {
  ESTADOS_PERIODO,
  ESTADO_PERIODO,
  INTEGRIDAD,
  TIPO,
  TIPOS,
  TONO_ESTADO_PERIODO,
  rutaDeInforme,
} from "./informesComunes";

const POR_PAGINA = 20;
const TITULO = "Informes ejecutivos";

export function Informes() {
  return (
    <ConAccesoInformes titulo={TITULO}>
      <PantallaInformes />
    </ConAccesoInformes>
  );
}

function PantallaInformes() {
  const { puedeGenerar, puedeAdministrar } = useInformes();
  const navigate = useNavigate();
  const location = useLocation();
  const [vista, setVista] = useState("informes");
  const [aviso, setAviso] = useState(location.state?.aviso ?? null);

  // El aviso viene en el estado de la navegación: se copia y se borra del
  // historial, si no reaparece al recargar la página.
  useEffect(() => {
    if (location.state?.aviso)
      navigate(location.pathname, { replace: true, state: null });
    // Solo al llegar: después el aviso ya vive en el estado de la pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [generando, setGenerando] = useState(false);

  return (
    <div className="gh-page">
      <Encabezado
        titulo={TITULO}
        descripcion="Informes del equipo congelados al generarse: se abren, imprimen y descargan siempre con los mismos datos."
      >
        {puedeGenerar && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setGenerando(true)}
          >
            <Icon name="plus-lg" /> Generar informe
          </button>
        )}
      </Encabezado>

      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />

      {puedeAdministrar && (
        <Pestanas
          etiqueta="Informes ejecutivos"
          idBase="ie-lista"
          valor={vista}
          onCambio={setVista}
          opciones={[
            { id: "informes", etiqueta: "Informes", icono: "files" },
            {
              id: "incidentes",
              etiqueta: "Incidentes de integridad",
              icono: "shield-exclamation",
            },
          ]}
        />
      )}
      <PanelDePestana
        idBase="ie-lista"
        valor={vista}
        sinPestanas={!puedeAdministrar}
        className="gh-page"
      >
        {vista === "incidentes" && puedeAdministrar ? (
          <IncidentesDeIntegridad />
        ) : (
          <Listado
            puedeGenerar={puedeGenerar}
            onGenerar={() => setGenerando(true)}
          />
        )}
      </PanelDePestana>

      {generando && (
        <AsistenteInforme
          onCerrar={() => setGenerando(false)}
          onGenerado={(informe, nuevo) => {
            setGenerando(false);
            navigate(rutaDeInforme(informe.report_id), {
              state: {
                aviso: {
                  tono: nuevo ? "ok" : "info",
                  texto: nuevo
                    ? `Informe ${informe.report_id} generado.`
                    : `Ya había pedido este mismo informe hace un momento: se abre ${informe.report_id} en vez de emitir otro.`,
                },
              },
            });
          }}
        />
      )}
    </div>
  );
}

function Listado({ puedeGenerar, onGenerar }) {
  const [tipo, setTipo] = useState("");
  const [estado, setEstado] = useState("");
  const [pagina, setPagina] = useState(1);
  const [carga, setCarga] = useState({
    datos: null,
    error: null,
    cargando: true,
  });
  const [vez, setVez] = useState(0);

  useEffect(() => {
    let vigente = true;
    setCarga((c) => ({ ...c, error: null, cargando: true }));
    informesService
      .listar({ page: pagina, pageSize: POR_PAGINA, tipo, estado })
      .then((datos) => {
        if (vigente) setCarga({ datos, error: null, cargando: false });
      })
      .catch((err) => {
        if (vigente)
          setCarga({
            datos: null,
            error: errorDeInformes(err, "No se pudieron cargar los informes.")
              .mensaje,
            cargando: false,
          });
      });
    return () => {
      vigente = false;
    };
  }, [tipo, estado, pagina, vez]);

  const informes = carga.datos?.reports ?? [];
  const total = carga.datos?.total ?? 0;
  const hayFiltros = Boolean(tipo || estado);

  // Cambiar un filtro vuelve a la primera página: la actual puede no existir.
  function filtrar(cambiar) {
    return (e) => {
      cambiar(e.target.value);
      setPagina(1);
    };
  }

  return (
    <>
      <form
        className="mz-filter-bar ie-filtros"
        role="search"
        aria-label="Filtrar informes"
        onSubmit={(e) => e.preventDefault()}
      >
        <select
          className="form-select form-select-sm"
          aria-label="Filtrar por tipo de informe"
          value={tipo}
          onChange={filtrar(setTipo)}
        >
          <option value="">Todos los tipos</option>
          {TIPOS.map((t) => (
            <option key={t} value={t}>
              {TIPO[t]}
            </option>
          ))}
        </select>
        <select
          className="form-select form-select-sm"
          aria-label="Filtrar por estado del período"
          value={estado}
          onChange={filtrar(setEstado)}
        >
          <option value="">Todos los estados</option>
          {ESTADOS_PERIODO.map((e) => (
            <option key={e} value={e}>
              {ESTADO_PERIODO[e]}
            </option>
          ))}
        </select>
      </form>

      <EstadoDeCarga
        cargando={carga.cargando && !carga.datos}
        error={carga.error}
        onReintentar={() => setVez((v) => v + 1)}
        vacio={!carga.cargando && !carga.error && informes.length === 0}
        hayFiltros={hayFiltros}
        onLimpiarFiltros={() => {
          setTipo("");
          setEstado("");
          setPagina(1);
        }}
        textoVacio={
          puedeGenerar
            ? "Todavía no hay informes. Genere el primero para tener el estado del equipo en un documento."
            : "Todavía no hay informes que pueda abrir. Cuando su jefatura genere uno sobre su equipo, aparecerá aquí."
        }
        accionVacio={
          puedeGenerar ? (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onGenerar}
            >
              Generar un informe
            </button>
          ) : null
        }
      />

      {informes.length > 0 && (
        <>
          <div className="ie-tabla-marco" aria-busy={carga.cargando}>
            <table className="ie-tabla ie-apilable" role="table">
              <caption className="visually-hidden">
                Informes ejecutivos, del más reciente al más antiguo
              </caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">
                    Período
                  </th>
                  <th scope="col" role="columnheader">
                    Tipo
                  </th>
                  <th scope="col" role="columnheader">
                    Estado del período
                  </th>
                  <th scope="col" role="columnheader">
                    Colaboradores
                  </th>
                  <th scope="col" role="columnheader">
                    Generado por
                  </th>
                  <th scope="col" role="columnheader">
                    Generado el
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {informes.map((r) => (
                  <FilaInforme key={r.report_id} informe={r} />
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
            etiqueta={total === 1 ? "informe" : "informes"}
          />
        </>
      )}
    </>
  );
}

function FilaInforme({ informe: r }) {
  const integridad = INTEGRIDAD[r.integrity_flag];
  return (
    <tr role="row">
      <th scope="row" role="rowheader" data-etiqueta="Período">
        <Link to={rutaDeInforme(r.report_id)} className="ie-enlace">
          {r.period_label || "Período no disponible"}
        </Link>
        <span className="d-block mz-small mz-faint ie-mono">{r.report_id}</span>
        {(r.integrity_flag === "PARTIAL" ||
          r.origin === "LEGACY_MIGRATION") && (
          <span className="mz-pill-row">
            {r.integrity_flag === "PARTIAL" && integridad && (
              <Semaforo tono={integridad.tono}>{integridad.texto}</Semaforo>
            )}
            {r.origin === "LEGACY_MIGRATION" && (
              <Semaforo tono="neutral">Migrado de Nexo</Semaforo>
            )}
          </span>
        )}
      </th>
      <td role="cell" data-etiqueta="Tipo">
        {r.type_label || TIPO[r.type] || r.type}
      </td>
      <td role="cell" data-etiqueta="Estado del período">
        <Semaforo tono={TONO_ESTADO_PERIODO[r.period_status] ?? "neutral"}>
          {r.period_status_label ||
            ESTADO_PERIODO[r.period_status] ||
            r.period_status}
        </Semaforo>
      </td>
      <td role="cell" data-etiqueta="Colaboradores">
        {r.collaborator_count ?? "—"}
      </td>
      <td role="cell" data-etiqueta="Generado por">
        {r.generated_by?.name || "—"}
      </td>
      <td role="cell" data-etiqueta="Generado el">
        {fechaHora(r.generated_at)}
      </td>
    </tr>
  );
}
