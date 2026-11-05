/*
 * Piezas de presentación de Desempeño (portadas de `AdvancedAnalytics.tsx`
 * de Nexo: `MaturityStars`, `HelpPopover`, `ConfidenceBadges`,
 * `ExplainModal`, `ScoreZoneBar`). El color nunca va solo: cada semáforo
 * lleva su texto.
 */
import { useEffect, useId, useRef, useState } from "react";

import { errorDeKpi } from "../../../api/kpiService";

import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { fechaHora } from "../comunes";
import { Ventana } from "../Tareas/Ventanas";
import {
  AYUDA,
  AYUDA_CALIDAD_DATO,
  AYUDA_CONFIABILIDAD,
  numero,
  porcentaje,
} from "./kpiComunes";

/** Una píldora de semáforo: tono de la identidad y su texto. */
export function Semaforo({ tono = "neutral", children, className = "" }) {
  return (
    <span className={`mz-pill mz-pill--${tono} ${className}`.trim()}>
      {children}
    </span>
  );
}

/** Madurez del dato (1 a 5 estrellas), dicha también en texto. */
export function Estrellas({ nivel, titulo }) {
  return (
    <span className="gk-estrellas" title={titulo}>
      <span aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={i <= nivel ? "gk-estrella--on" : undefined}>
            ★
          </span>
        ))}
      </span>
      <span className="visually-hidden">
        {titulo} ({nivel} de 5)
      </span>
    </span>
  );
}

/** Botón «?» que abre la ayuda de 4 partes de un indicador. */
export function Ayuda({ clave }) {
  const [abierta, setAbierta] = useState(false);
  const ayuda = AYUDA[clave];
  if (!ayuda) return null;
  return (
    <>
      <button
        type="button"
        className="gk-ayuda"
        aria-label={`Ayuda: ${ayuda.titulo}`}
        title={`Ayuda: ${ayuda.titulo}`}
        onClick={() => setAbierta(true)}
      >
        <Icon name="question-circle" />
      </button>
      {abierta && (
        <Ventana titulo={ayuda.titulo} onCerrar={() => setAbierta(false)}>
          <dl className="gk-ayuda__lista">
            <dt>Qué significa</dt>
            <dd>{ayuda.significa}</dd>
            <dt>Cómo se calcula</dt>
            <dd>{ayuda.calcula}</dd>
            <dt>Por qué importa</dt>
            <dd>{ayuda.importa}</dd>
            <dt>Buenas prácticas</dt>
            <dd>
              <ul className="mb-0">
                {ayuda.practicas.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </dd>
          </dl>
        </Ventana>
      )}
    </>
  );
}

const tonoDeConfianza = (pct) =>
  pct >= 90 ? "ok" : pct >= 70 ? "warn" : "bad";

/** Calidad del dato y confiabilidad del cálculo. */
export function Confianza({ calidad, confiabilidad, compacta = false }) {
  if (calidad === undefined && confiabilidad === undefined) return null;
  return (
    <dl
      className={
        compacta ? "gk-confianza gk-confianza--compacta" : "gk-confianza"
      }
    >
      {calidad !== undefined && (
        <div>
          <dt title={AYUDA_CALIDAD_DATO}>Calidad del dato</dt>
          <dd>
            <Semaforo tono={tonoDeConfianza(calidad)}>
              {porcentaje(calidad)}
            </Semaforo>
          </dd>
        </div>
      )}
      {confiabilidad !== undefined && (
        <div>
          <dt title={AYUDA_CONFIABILIDAD}>Confiabilidad del cálculo</dt>
          <dd>
            <Semaforo tono={tonoDeConfianza(confiabilidad)}>
              {porcentaje(confiabilidad)}
            </Semaforo>
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * Barra de zonas de un puntaje de 0 a 100. Los tramos son los umbrales
 * reales de la clasificación que usa el servidor (`tramos`: `[{ desde,
 * hasta, color, texto }]`), cada marca en su posición real, y el texto dice
 * la misma clasificación que envía el servidor (`clasificacion`).
 */
export function BarraDeZonas({ puntaje, tramos, clasificacion }) {
  const valor = Math.max(0, Math.min(100, Number(puntaje) || 0));
  const cortes = [...new Set(tramos.flatMap((t) => [t.desde, t.hasta]))].sort(
    (a, b) => a - b,
  );
  return (
    <div className="gk-zonas">
      <div className="gk-zonas__barra" aria-hidden="true">
        {tramos.map((t) => (
          <span
            key={t.desde}
            className={`gk-zonas__z gk-zonas__z--${t.color}`}
            style={{ left: `${t.desde}%`, width: `${t.hasta - t.desde}%` }}
            title={t.texto}
          />
        ))}
        <span className="gk-zonas__marca" style={{ left: `${valor}%` }} />
      </div>
      <div className="gk-zonas__escala" aria-hidden="true">
        {cortes.map((c) => (
          <span key={c} style={{ left: `${c}%` }}>
            {c}
          </span>
        ))}
      </div>
      <p className="visually-hidden">
        {numero(valor)} de 100{clasificacion ? `: ${clasificacion}` : ""}.
        Tramos:{" "}
        {tramos.map((t) => `${t.texto} de ${t.desde} a ${t.hasta}`).join("; ")}.
      </p>
    </div>
  );
}

/** Una sección con su tarjeta y su título. */
export function Seccion({
  id,
  titulo,
  ayuda,
  accion,
  children,
  className = "",
}) {
  return (
    <section
      id={id}
      className={`mz-card gk-seccion ${className}`.trim()}
      aria-labelledby={id ? `${id}-titulo` : undefined}
    >
      <div className="mz-card-head">
        <h3 id={id ? `${id}-titulo` : undefined}>
          {titulo}
          {ayuda && <Ayuda clave={ayuda} />}
        </h3>
        {accion}
      </div>
      <div className="mz-card-body">{children}</div>
    </section>
  );
}

/** Cargando o error con «Reintentar» de una sección. */
export function EstadoSeccion({ carga, textoVacio, vacio = false }) {
  return (
    <EstadoDeCarga
      cargando={carga.cargando && !carga.error}
      error={carga.error}
      onReintentar={carga.recargar}
      vacio={!carga.cargando && !carga.error && vacio}
      textoVacio={textoVacio}
    />
  );
}

/** Un indicador grande (`mz-kpi`). Si lleva color (`tono`), lleva también su
 * texto (`textoTono`): el color nunca va solo. */
export function Indicador({ etiqueta, valor, sub, tono, textoTono, extra }) {
  return (
    <div className={`mz-kpi${tono && textoTono ? ` mz-kpi--${tono}` : ""}`}>
      <div className="mz-kpi-top">
        <span className="mz-kpi-label">{etiqueta}</span>
        {extra}
      </div>
      <div className="mz-kpi-value">{valor}</div>
      {tono && textoTono && (
        <div>
          <Semaforo tono={tono}>{textoTono}</Semaforo>
        </div>
      )}
      {sub && <div className="mz-kpi-sub">{sub}</div>}
    </div>
  );
}

/** «▲ 5 % frente al mes anterior». */
export function FrenteAlAnterior({
  actual,
  anterior,
  unidad = " %",
  invertir = false,
}) {
  if (anterior === null || anterior === undefined) return null;
  const diferencia = Math.round(((actual ?? 0) - anterior) * 10) / 10;
  if (diferencia === 0)
    return (
      <span className="mz-small mz-faint">
        Sin cambio frente al mes anterior
      </span>
    );
  const mejor = invertir ? diferencia < 0 : diferencia > 0;
  return (
    <span className={`mz-small ${mejor ? "gt-texto--ok" : "gt-texto--bad"}`}>
      {diferencia > 0 ? "Subió" : "Bajó"} {numero(Math.abs(diferencia))}
      {unidad} frente al mes anterior
    </span>
  );
}

/**
 * «¿Cómo se obtuvo este resultado?» (`ExplainModal` de Nexo): fórmula,
 * datos utilizados, el desglose por factor (valor original → puntaje →
 * peso → aporte; sin un «nivel» propio que compita con la clasificación), el resultado, la confianza y el resumen de
 * auditoría.
 */
export function ExplicarCalculo({
  titulo,
  formula,
  pasos = [],
  factores,
  datos,
  resultado,
  interpretacion,
  version,
  versionFormulas,
  fecha,
  fuente,
  referencia,
  confianza,
  onCerrar,
}) {
  return (
    <Ventana titulo={`¿Cómo se obtuvo? ${titulo}`} onCerrar={onCerrar} ancha>
      {formula && (
        <p className="mz-small">
          Fórmula: <code className="gk-codigo">{formula}</code>
        </p>
      )}
      {datos?.length > 0 && (
        <div className="gh-recuadro mb-3">
          <p className="mz-small mz-strong mb-1">Datos utilizados</p>
          <ul className="mb-0 mz-small">
            {datos.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
      {factores?.length ? (
        <div className="mz-table-wrap mb-3">
          <table className="mz-table gk-tabla-factores">
            <caption className="visually-hidden">
              Desglose por factor de {titulo}
            </caption>
            <thead>
              <tr>
                <th scope="col">Factor</th>
                <th scope="col">Valor original</th>
                <th scope="col" className="num">
                  Puntaje
                </th>
                <th scope="col" className="num">
                  Peso
                </th>
                <th scope="col" className="num">
                  Aporte
                </th>
              </tr>
            </thead>
            <tbody>
              {factores.map((f) => (
                <tr key={f.nombre}>
                  <th scope="row">
                    {f.nombre}
                    {f.nota && (
                      <span className="mz-small gt-texto--warn d-block">
                        {f.nota}
                      </span>
                    )}
                  </th>
                  <td>{f.original}</td>
                  <td className="num">{numero(f.normalizado)}/100</td>
                  <td className="num">{numero(f.peso)} %</td>
                  <td className="num">{numero(f.puntos, 2)} pts</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        pasos.length > 0 && (
          <ol className="mz-small">
            {pasos.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
        )
      )}
      {(resultado !== undefined || interpretacion) && (
        <div className="gh-recuadro mb-3">
          <p className="mz-small mz-strong mb-1">Resultado final</p>
          <p className="mb-0">
            {resultado !== undefined && (
              <strong className="gk-grande">{numero(resultado)}</strong>
            )}{" "}
            {interpretacion}
          </p>
        </div>
      )}
      {confianza && (
        <Confianza
          calidad={confianza.data_quality_pct}
          confiabilidad={confianza.reliability_pct}
        />
      )}
      {(fecha || version || fuente || referencia) && (
        <dl className="gh-tarjeta-kv mt-3 mb-0">
          {fecha && (
            <>
              <dt>Fecha del cálculo</dt>
              <dd>{fechaHora(fecha)}</dd>
            </>
          )}
          {version && (
            <>
              <dt>Versión del motor</dt>
              <dd>v{version}</dd>
            </>
          )}
          {versionFormulas && (
            <>
              <dt>Versión de fórmulas</dt>
              <dd>v{versionFormulas}</dd>
            </>
          )}
          {fuente && (
            <>
              <dt>Fuente de datos</dt>
              <dd>{fuente}</dd>
            </>
          )}
          {referencia && (
            <>
              <dt>Referencia utilizada</dt>
              <dd>{referencia}</dd>
            </>
          )}
        </dl>
      )}
    </Ventana>
  );
}

/** El mensaje de una exportación que falló. Un 404 o un 403 aquí no es «ya
 * no existe»: el archivo no se pudo generar. */
export const ERROR_EXCEL =
  "No se pudo generar el Excel. Inténtelo de nuevo o avise a Soporte TI.";

/**
 * «Descargar Excel»: descarga con la sesión (`descargar` devuelve una
 * promesa con el nombre del archivo). Mientras descarga, el botón no se
 * deshabilita (el foco se iría a `<body>`): queda `aria-disabled`, con
 * «Descargando…» y un indicador, y un `useRef` evita el doble clic. Si
 * falla, el error va junto al botón y el foco pasa a «Reintentar».
 * `aviso`: una nota bajo el botón, unida a él con `aria-describedby`.
 */
export function BotonExcel({ descargar, aviso, etiqueta = "Descargar Excel" }) {
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState(null);
  const [listo, setListo] = useState(null);
  const enCurso = useRef(false);
  const reintentar = useRef(null);
  const idAviso = `${useId()}-aviso`;

  useEffect(() => {
    if (error) reintentar.current?.focus();
  }, [error]);

  async function bajar() {
    if (enCurso.current) return;
    enCurso.current = true;
    setDescargando(true);
    setError(null);
    setListo(null);
    try {
      const nombre = await descargar();
      setListo(`Descarga lista: ${nombre}.`);
    } catch (err) {
      const fallo = errorDeKpi(err, ERROR_EXCEL);
      setError(
        fallo.estado === 404 || fallo.estado === 403
          ? ERROR_EXCEL
          : fallo.mensaje,
      );
    } finally {
      enCurso.current = false;
      setDescargando(false);
    }
  }

  return (
    <div className="gk-excel">
      <button
        type="button"
        className={`btn btn-exportar btn-sm${descargando ? " gk-excel__boton--ocupado" : ""}`}
        onClick={bajar}
        aria-disabled={descargando ? "true" : undefined}
        aria-describedby={aviso ? idAviso : undefined}
      >
        {descargando ? (
          <span
            className="spinner-border spinner-border-sm"
            aria-hidden="true"
          />
        ) : (
          <Icon name="file-earmark-excel" />
        )}{" "}
        {descargando ? "Descargando…" : etiqueta}
      </button>
      {aviso && (
        <span id={idAviso} className="mz-small mz-faint">
          {aviso}
        </span>
      )}
      <span role="status" className="visually-hidden">
        {listo}
      </span>
      {error && (
        <div
          className="mz-alert mz-alert--bad mz-alert--accion gk-excel__error"
          role="alert"
        >
          <Icon name="x-octagon" />
          <span>{error}</span>
          <button
            ref={reintentar}
            type="button"
            className="btn btn-sm btn-outline-danger ms-auto"
            onClick={bajar}
            aria-disabled={descargando ? "true" : undefined}
          >
            <Icon name="arrow-clockwise" /> Reintentar
          </button>
        </div>
      )}
    </div>
  );
}

/** Aviso solo para quien administra el KPI: la validación de consistencia
 * del motor encontró problemas. */
export function AdvertenciasDeValidacion({ advertencias }) {
  if (!advertencias?.length) return null;
  return (
    <div className="mz-alert mz-alert--warn" role="status">
      <Icon name="exclamation-triangle" />
      <div>
        <p className="mb-1">
          Solo para quien administra el KPI: la validación de consistencia
          detectó {advertencias.length}{" "}
          {advertencias.length === 1 ? "problema" : "problemas"}.
        </p>
        <ul className="mb-0 mz-small">
          {advertencias.map((f, i) => (
            <li key={`${f.rule}-${i}`}>
              <code>{f.rule}</code>: {f.detail}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
