/*
 * Cierre de mes de Tareas (`CloseMonthModal` de Nexo, Motor de Cierre
 * Inteligente): se elige el mes (por defecto el anterior) y, si hace falta,
 * una fecha de corte anterior (cierre anticipado o regularización); se ve la
 * vista previa que calcula el servidor y se cierra.
 *
 * Al cerrar: las tareas que terminaron pasan al repositorio; las recurrentes
 * generan su tarea del mes siguiente; las recurrentes o de seguimiento sin
 * terminar siguen activas. El cierre es manual: nada lo dispara solo, por
 * eso se listan los meses que quedaron sin cerrar.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { errorDeTareas, tareasService } from "../../../api/tareasService";
import { confirmar } from "../../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  RUTA_GESTION_HUMANA,
  TAREAS_CERRAR_MES,
} from "../../../modulos/permisosGestionHumana";
import { ErrorEnLinea } from "../comunes";
import { ConAccesoTareas, Encabezado } from "./ContextoTareas";
import { fechaCorta, horas, mesLargo } from "./tareasComunes";

export function CierreDeMes() {
  return (
    <ConAccesoTareas titulo="Cierre de mes" permiso={TAREAS_CERRAR_MES}>
      <PantallaCierre />
    </ConAccesoTareas>
  );
}

const TIPO_CIERRE = {
  NORMAL: "Cierre normal",
  EARLY: "Cierre anticipado",
  MANUAL: "Corte regularizado manualmente",
};

const dos = (n) => String(n).padStart(2, "0");

function siguiente(year, month) {
  return month === 12
    ? { year: year + 1, month: 1 }
    : { year, month: month + 1 };
}

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

/** Lo que se escribe espera un poco antes de pedir la vista previa: no una
 * petición por cada cambio del selector de fecha. */
const ESPERA = 400;

function Kpi({ etiqueta, valor, tono, texto = false }) {
  return (
    <div className={`mz-kpi${tono ? ` mz-kpi--${tono}` : ""}`}>
      <div className="mz-kpi-label">{etiqueta}</div>
      <div className={`mz-kpi-value${texto ? " gt-kpi-texto" : ""}`}>
        {valor}
      </div>
    </div>
  );
}

function PantallaCierre() {
  const [parametros] = useSearchParams();
  const inicial = (() => {
    const y = Number(parametros.get("year"));
    const m = Number(parametros.get("month"));
    return y && m >= 1 && m <= 12 ? { year: y, month: m } : {};
  })();
  const [pedido, setPedido] = useState(inicial);
  const [vista, setVista] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [revisado, setRevisado] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [errorCierre, setErrorCierre] = useState(null);
  const [resultado, setResultado] = useState(null);
  const enCurso = useRef(false);
  // Lo elegido en los campos; se pide la vista previa tras `ESPERA`.
  const [borrador, setBorrador] = useState(null);

  const cargar = useCallback(() => {
    setCargando(true);
    setError(null);
    tareasService
      .vistaPreviaDelCierre(pedido)
      .then((d) => {
        setVista(d);
        setBorrador({ year: d.year, month: d.month, corte: d.cutoff_date });
        setRevisado(false);
      })
      .catch((err) =>
        setError(
          errorDeTareas(err, "No se pudo calcular la vista previa del cierre.")
            .mensaje,
        ),
      )
      .finally(() => setCargando(false));
  }, [pedido]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!borrador || !vista) return undefined;
    const mismoMes =
      borrador.year === vista.year && borrador.month === vista.month;
    if (mismoMes && borrador.corte === vista.cutoff_date) return undefined;
    const reloj = setTimeout(
      () =>
        setPedido(
          mismoMes && borrador.corte
            ? {
                year: borrador.year,
                month: borrador.month,
                cutoffDate: borrador.corte,
              }
            : { year: borrador.year, month: borrador.month },
        ),
      ESPERA,
    );
    return () => clearTimeout(reloj);
    // Solo cuando la persona cambia algo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [borrador]);

  const anioActual = new Date().getFullYear();
  const anios = [anioActual - 3, anioActual - 2, anioActual - 1, anioActual];

  const mes = vista ? { year: vista.year, month: vista.month } : null;
  const prox = mes ? siguiente(mes.year, mes.month) : null;
  const finDelMes = vista
    ? `${vista.year}-${dos(vista.month)}-${dos(vista.calendar_days_total)}`
    : undefined;

  async function cerrar() {
    if (!vista || enCurso.current || !revisado) return;
    const seguir = await confirmar({
      titulo: `¿Cerrar ${mesLargo(vista.year, vista.month)}?`,
      mensaje: `Afecta a toda la empresa. Se archivan ${vista.total} tarea(s) en el repositorio y se crean ${vista.to_duplicate} para ${mesLargo(prox.year, prox.month)}. Un mes cerrado no se vuelve a abrir.`,
      accion: "Cerrar mes",
    });
    if (!seguir) return;
    enCurso.current = true;
    setCerrando(true);
    setErrorCierre(null);
    try {
      setResultado(
        await tareasService.cerrarMes({
          year: vista.year,
          month: vista.month,
          cutoffDate: vista.cutoff_date,
        }),
      );
    } catch (err) {
      setErrorCierre(errorDeTareas(err, "No se pudo cerrar el mes.").mensaje);
      enCurso.current = false;
    } finally {
      setCerrando(false);
    }
  }

  if (resultado) {
    return (
      <div className="gh-page">
        <Encabezado titulo="Cierre de mes" />
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check2-circle" />
          <div>
            <strong>
              {mesLargo(resultado.year, resultado.month)} cerrado.
            </strong>{" "}
            {resultado.archived_count} tarea(s) archivada(s) y{" "}
            {resultado.duplicated_count} creada(s) para{" "}
            {mesLargo(resultado.next_year, resultado.next_month)}.
            {resultado.continued_active_count > 0 &&
              ` ${resultado.continued_active_count} sin terminar siguen activas con su avance.`}
            {resultado.closure_type !== "NORMAL" &&
              ` Fecha de corte: ${fechaCorta(resultado.cutoff_date)} (${TIPO_CIERRE[resultado.closure_type]?.toLowerCase()}).`}
          </div>
        </div>
        <div className="gh-barra__grupo">
          <Link
            className="btn btn-primary"
            to={`${RUTA_GESTION_HUMANA}/tareas?vista=repositorio`}
          >
            Ver el repositorio
          </Link>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => {
              enCurso.current = false;
              setResultado(null);
              setPedido({});
            }}
          >
            Cerrar otro mes
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gh-page">
      <Encabezado
        titulo="Cierre de mes"
        descripcion="Archiva las tareas que terminaron y genera las recurrentes del mes siguiente. El cierre es manual: nada lo hace solo."
      />

      {vista?.pending_closures?.length > 0 && (
        <div className="mz-alert mz-alert--warn" role="status">
          <Icon name="exclamation-triangle" />
          <div>
            <strong>Meses terminados sin cerrar:</strong>{" "}
            {vista.pending_closures.map((p, i) => (
              <span key={`${p.year}-${p.month}`}>
                {i > 0 && ", "}
                <button
                  type="button"
                  className="gh-enlace"
                  onClick={() => setPedido({ year: p.year, month: p.month })}
                >
                  {mesLargo(p.year, p.month)}
                </button>
              </span>
            ))}
            . Hasta cerrarlos, sus tareas no pasan al repositorio y las
            recurrentes no generan la del mes siguiente.
          </div>
        </div>
      )}

      <p className="mb-0">
        <Icon name="building" /> Afecta a las tareas de toda la empresa, no solo
        a las de su equipo.
      </p>
      <div
        className="gh-alcance"
        role="group"
        aria-label="Qué mes se cierra"
        aria-busy={cargando || undefined}
      >
        <div className="mz-campo">
          <label className="form-label" htmlFor="gt-cierre-mes">
            1 · Mes
          </label>
          <select
            id="gt-cierre-mes"
            className="form-select"
            value={borrador?.month ?? ""}
            disabled={cerrando || !borrador}
            onChange={(e) =>
              setBorrador((b) => ({
                ...b,
                month: Number(e.target.value),
                corte: "",
              }))
            }
            aria-describedby="gt-cierre-mes-ayuda"
          >
            {MESES.map((nombre, i) => (
              <option key={nombre} value={i + 1}>
                {nombre}
              </option>
            ))}
          </select>
          <div id="gt-cierre-mes-ayuda" className="form-text">
            Por defecto, el mes anterior al actual.
          </div>
        </div>
        <div className="mz-campo">
          <label className="form-label" htmlFor="gt-cierre-anio">
            Año
          </label>
          <select
            id="gt-cierre-anio"
            className="form-select"
            value={borrador?.year ?? ""}
            disabled={cerrando || !borrador}
            onChange={(e) =>
              setBorrador((b) => ({
                ...b,
                year: Number(e.target.value),
                corte: "",
              }))
            }
          >
            {[...new Set([...anios, borrador?.year].filter(Boolean))]
              .sort()
              .map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
          </select>
        </div>
        <div className="mz-campo">
          <label className="form-label" htmlFor="gt-cierre-corte">
            2 · Fecha de corte
          </label>
          <input
            id="gt-cierre-corte"
            type="date"
            className="form-control"
            value={borrador?.corte ?? ""}
            min={mes ? `${mes.year}-${dos(mes.month)}-01` : undefined}
            max={finDelMes}
            readOnly={cerrando || !borrador}
            onChange={(e) =>
              e.target.value &&
              setBorrador((b) => ({ ...b, corte: e.target.value }))
            }
            aria-describedby="gt-cierre-corte-ayuda"
          />
          <div id="gt-cierre-corte-ayuda" className="form-text">
            Por defecto, el último día del mes. Una fecha anterior es un cierre
            anticipado o una regularización; solo acota lo informativo, no qué
            tareas se archivan.
          </div>
        </div>
      </div>

      <EstadoDeCarga
        cargando={cargando && !error}
        error={error}
        onReintentar={cargar}
      />

      {vista && !cargando && !error && (
        <section className="mz-card" aria-labelledby="gt-cierre-vista">
          <div className="mz-card-body gh-page">
            <h3 id="gt-cierre-vista" className="h6 mb-0">
              3 · Vista previa: {mesLargo(vista.year, vista.month)}
            </h3>
            {vista.already_closed ? (
              <div className="mz-alert mz-alert--info" role="status">
                <Icon name="lock" />
                <span>
                  Este mes ya fue cerrado. Sus tareas están en el repositorio.
                </span>
              </div>
            ) : (
              <>
                {vista.closure_type !== "NORMAL" && (
                  <div className="mz-alert mz-alert--info" role="status">
                    <Icon name="info-circle" />
                    <span>
                      {TIPO_CIERRE[vista.closure_type]}: solo se considera la
                      información hasta el {fechaCorta(vista.cutoff_date)}.
                    </span>
                  </div>
                )}
                <div className="mz-kpi-grid">
                  <Kpi
                    texto
                    etiqueta="Cobertura"
                    valor={`${fechaCorta(`${vista.year}-${dos(vista.month)}-01`)} – ${fechaCorta(vista.cutoff_date)}`}
                  />
                  <Kpi
                    etiqueta="Días hábiles"
                    valor={vista.working_days_considered}
                  />
                  <Kpi
                    etiqueta="Horas base"
                    valor={horas(vista.working_hours_considered)}
                  />
                </div>
                <div className="mz-kpi-grid">
                  <Kpi etiqueta="Se archivan" valor={vista.total} />
                  <Kpi
                    etiqueta="Completadas"
                    valor={vista.completed}
                    tono="ok"
                  />
                  <Kpi
                    etiqueta="Pendientes"
                    valor={vista.pending}
                    tono="warn"
                  />
                  <Kpi
                    etiqueta="En progreso"
                    valor={vista.in_progress}
                    tono="info"
                  />
                  <Kpi
                    etiqueta="Siguen activas (no se archivan)"
                    valor={vista.continued_active}
                  />
                  <Kpi
                    etiqueta={`Se crean para ${mesLargo(prox.year, prox.month)}`}
                    valor={vista.to_duplicate}
                  />
                </div>
                <div className="gh-recuadro">
                  <p className="mb-1">
                    <strong>Qué pasa al cerrar:</strong>
                  </p>
                  <ul className="mb-0">
                    <li>
                      {vista.total} tarea(s) pasan al repositorio de{" "}
                      {mesLargo(vista.year, vista.month)}, de solo lectura.
                    </li>
                    <li>
                      Cada recurrente genera su tarea de{" "}
                      {mesLargo(prox.year, prox.month)} ({vista.to_duplicate} en
                      total).
                    </li>
                    {vista.continued_active > 0 && (
                      <li>
                        {vista.continued_active} recurrente(s) o de seguimiento
                        sin terminar no se archivan: siguen activas con su
                        avance.
                      </li>
                    )}
                    <li>Un mes cerrado no se vuelve a abrir.</li>
                  </ul>
                </div>
                <div className="form-check">
                  <input
                    id="gt-cierre-revisado"
                    className="form-check-input"
                    type="checkbox"
                    checked={revisado}
                    onChange={(e) => setRevisado(e.target.checked)}
                  />
                  <label
                    className="form-check-label"
                    htmlFor="gt-cierre-revisado"
                  >
                    Revisé la vista previa y entiendo lo que pasa al cerrar.
                  </label>
                </div>
                <ErrorEnLinea mensaje={errorCierre} />
                <div>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={!revisado || cerrando}
                    onClick={cerrar}
                  >
                    {cerrando
                      ? "Cerrando…"
                      : `Cerrar ${mesLargo(vista.year, vista.month)}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
