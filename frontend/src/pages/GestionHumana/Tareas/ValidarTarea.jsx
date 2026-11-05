/*
 * Validación de una tarea por el líder (`ValidateActivityModal` de Nexo): el
 * Tiempo Objetivo y la Fecha Fin, cada uno con su propia decisión (se puede
 * validar uno y rechazar el otro). Nunca toca las horas reales. Nadie valida
 * una tarea propia, y hace falta `tareas.validar`: lo decide el servidor
 * (`can_validate`) y lo vuelve a revisar al guardar. Cada decisión queda en
 * el historial con el usuario, su rol y la fecha.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { errorDeTareas, tareasService } from "../../../api/tareasService";
import {
  Campo,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Aviso, ErrorEnLinea } from "../comunes";
import {
  PreviaHoras,
  Desviacion,
  EstadoFechaFin,
  Historial,
  PillValidado,
} from "./Indicadores";
import { Ventana } from "./Ventanas";
import {
  AYUDA_HORAS,
  HORAS_INVALIDAS,
  MOTIVO_TIEMPO_OBJETIVO,
  aMedianocheUTC,
  diaUTC,
  fechaCorta,
  horas,
  horasATexto,
  horasValidas,
  nombreDe,
  textoAHoras,
} from "./tareasComunes";

const DECISIONES = [
  ["APROBAR", "Aprobar la fecha propuesta"],
  ["MODIFICAR", "Modificar la fecha"],
  ["RECHAZAR", "Rechazar la fecha"],
];

const BOTON_DECISION = {
  APROBAR: "Aprobar fecha fin",
  MODIFICAR: "Modificar fecha fin",
  RECHAZAR: "Rechazar fecha fin",
};

function SeccionObjetivo({ tareaId, info, onHecho }) {
  const [valor, setValor] = useState(horasATexto(info.official_target));
  const [motivo, setMotivo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);
  const caja = useRef(null);

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const e = {};
    if (!horasValidas(valor) || textoAHoras(valor) <= 0)
      e.new_value = HORAS_INVALIDAS;
    if (!motivo) e.reason = "Elija el motivo del ajuste.";
    if (motivo === "OTRO" && !detalle.trim())
      e.reason_detail = "Indique el detalle cuando el motivo es «Otro».";
    setErrores(e);
    setError(null);
    if (Object.keys(e).length) {
      enfocarPrimerError(caja.current);
      return;
    }
    enCurso.current = true;
    setGuardando(true);
    try {
      await tareasService.validarTiempoObjetivo(tareaId, {
        new_value: textoAHoras(valor),
        reason: motivo,
        reason_detail: motivo === "OTRO" ? detalle.trim() : null,
      });
      setMotivo("");
      setDetalle("");
      onHecho("Tiempo objetivo validado.");
    } catch (err) {
      const fallo = errorDeTareas(
        err,
        "No se pudo validar el tiempo objetivo.",
      );
      setErrores(fallo.campos);
      setError(fallo.mensaje);
    } finally {
      enCurso.current = false;
      setGuardando(false);
    }
  }

  return (
    <form ref={caja} onSubmit={enviar} noValidate>
      <div className="gt-form-grid">
        <div>
          <Campo
            id="gt-val-objetivo"
            etiqueta="Nuevo tiempo objetivo (HH.MM)"
            obligatorio
            ayuda={AYUDA_HORAS}
            error={errores.new_value}
          >
            <input
              className="form-control"
              inputMode="decimal"
              placeholder="Ej.: 6.30"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </Campo>
          <PreviaHoras texto={valor} />
        </div>
        <Campo
          id="gt-val-motivo"
          etiqueta="Motivo"
          obligatorio
          error={errores.reason}
        >
          <select
            className="form-select"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          >
            <option value="">Elija el motivo</option>
            {Object.entries(MOTIVO_TIEMPO_OBJETIVO).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      {motivo === "OTRO" && (
        <Campo
          id="gt-val-detalle"
          etiqueta="Detalle del motivo"
          obligatorio
          error={errores.reason_detail}
          className="mt-3"
        >
          <textarea
            className="form-control"
            rows={2}
            maxLength={5000}
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
          />
        </Campo>
      )}
      <ErrorEnLinea mensaje={error} className="mt-2" />
      <div className="d-flex justify-content-end mt-3">
        <button type="submit" className="btn btn-primary" disabled={guardando}>
          {guardando ? "Guardando…" : "Validar tiempo objetivo"}
        </button>
      </div>
    </form>
  );
}

function SeccionFechaFin({ tareaId, info, inicio, onHecho }) {
  const [decision, setDecision] = useState("");
  const [nuevaFecha, setNuevaFecha] = useState(diaUTC(info.end_date));
  const [observaciones, setObservaciones] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);
  const caja = useRef(null);
  const diaInicio = inicio ? diaUTC(inicio) : "";

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current || !decision) return;
    const e = {};
    if (decision === "MODIFICAR") {
      if (!nuevaFecha) e.new_end_date = "Elija la nueva fecha fin.";
      else if (diaInicio && nuevaFecha < diaInicio)
        e.new_end_date = "No puede ser anterior a la fecha de inicio.";
    }
    setErrores(e);
    setError(null);
    if (Object.keys(e).length) {
      enfocarPrimerError(caja.current);
      return;
    }
    enCurso.current = true;
    setGuardando(true);
    try {
      await tareasService.decidirFechaFin(tareaId, {
        action: decision,
        new_end_date:
          decision === "MODIFICAR" ? aMedianocheUTC(nuevaFecha) : null,
        observaciones: observaciones.trim() || null,
      });
      setDecision("");
      setObservaciones("");
      onHecho(
        {
          APROBAR: "Fecha fin aprobada.",
          MODIFICAR: "Fecha fin modificada. Se avisó a la persona responsable.",
          RECHAZAR:
            "Fecha fin rechazada. Se avisó a la persona responsable para que proponga otra.",
        }[decision],
      );
    } catch (err) {
      const fallo = errorDeTareas(err, "No se pudo registrar la decisión.");
      setErrores(fallo.campos);
      setError(fallo.mensaje);
    } finally {
      enCurso.current = false;
      setGuardando(false);
    }
  }

  return (
    <form ref={caja} onSubmit={enviar} noValidate>
      <fieldset>
        <legend className="form-label gt-legend">Decisión</legend>
        <div className="gt-opciones">
          {DECISIONES.map(([valor, texto]) => (
            <label key={valor} className="gt-opcion">
              <input
                type="radio"
                name="gt-val-decision"
                value={valor}
                checked={decision === valor}
                onChange={() => setDecision(valor)}
              />
              <span>{texto}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {decision === "MODIFICAR" && (
        <Campo
          id="gt-val-fecha"
          etiqueta="Nueva fecha fin"
          obligatorio
          error={errores.new_end_date}
          className="mt-3"
        >
          <input
            type="date"
            className="form-control"
            min={diaInicio || undefined}
            value={nuevaFecha}
            onChange={(e) => setNuevaFecha(e.target.value)}
          />
        </Campo>
      )}
      {decision === "RECHAZAR" && (
        <div className="mz-alert mz-alert--warn mt-3" role="status">
          <span>
            La fecha actual no cambia: la persona responsable deberá proponer
            una nueva editando la tarea, y se le avisará.
          </span>
        </div>
      )}
      <Campo
        id="gt-val-observaciones"
        etiqueta="Observaciones"
        error={errores.observaciones}
        className="mt-3"
      >
        <textarea
          className="form-control"
          rows={2}
          maxLength={5000}
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
        />
      </Campo>
      <ErrorEnLinea mensaje={error} className="mt-2" />
      <div className="d-flex justify-content-end mt-3">
        <button
          type="submit"
          className={`btn ${decision === "RECHAZAR" ? "btn-danger" : "btn-primary"}`}
          disabled={!decision || guardando}
        >
          {guardando
            ? "Guardando…"
            : (BOTON_DECISION[decision] ?? "Elija una decisión")}
        </button>
      </div>
    </form>
  );
}

export function ValidarTarea({ tarea, onCerrar, onCambio }) {
  const [objetivo, setObjetivo] = useState(null);
  const [errorObjetivo, setErrorObjetivo] = useState(null);
  const [fecha, setFecha] = useState(null);
  const [errorFecha, setErrorFecha] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [version, setVersion] = useState(0);

  const cargarObjetivo = useCallback(() => {
    setErrorObjetivo(null);
    tareasService
      .tiempoObjetivo(tarea.id)
      .then(setObjetivo)
      .catch((err) =>
        setErrorObjetivo(
          errorDeTareas(err, "No se pudo cargar el Tiempo Objetivo.").mensaje,
        ),
      );
  }, [tarea.id]);

  const cargarFecha = useCallback(() => {
    setErrorFecha(null);
    tareasService
      .fechaFin(tarea.id)
      .then(setFecha)
      .catch((err) =>
        setErrorFecha(
          errorDeTareas(err, "No se pudo cargar la Fecha Fin.").mensaje,
        ),
      );
  }, [tarea.id]);

  useEffect(() => {
    cargarObjetivo();
    cargarFecha();
  }, [cargarObjetivo, cargarFecha]);

  function hecho(texto) {
    setAviso({ texto, tono: "ok" });
    setVersion((v) => v + 1);
    cargarObjetivo();
    cargarFecha();
    onCambio?.();
  }

  return (
    <Ventana
      titulo="Validar tarea"
      subtitulo={`${tarea.title} · Responsable: ${nombreDe(tarea.assigned_to)} · Inicio: ${fechaCorta(tarea.start_date)}`}
      onCerrar={onCerrar}
      ancha
    >
      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />

      <section className="gt-bloque" aria-labelledby="gt-val-sec-objetivo">
        <h4 id="gt-val-sec-objetivo" className="gt-bloque__titulo">
          Tiempo objetivo
        </h4>
        <EstadoDeCarga
          cargando={!objetivo && !errorObjetivo}
          error={errorObjetivo}
          onReintentar={cargarObjetivo}
        />
        {objetivo && (
          <>
            <dl className="gh-tarjeta-kv mb-2">
              <dt>Valor vigente</dt>
              <dd>
                {horas(objetivo.official_target)}{" "}
                <PillValidado validado={objetivo.is_validated} />
              </dd>
              {objetivo.real_hours > 0 && (
                <>
                  <dt>Desviación</dt>
                  <dd>
                    <Desviacion desviacion={objetivo.deviation} />
                  </dd>
                </>
              )}
              {objetivo.validated_by && (
                <>
                  <dt>Validado por</dt>
                  <dd>{nombreDe(objetivo.validated_by)}</dd>
                </>
              )}
            </dl>
            {objetivo.historical_deviation?.available && (
              <p className="mz-alert mz-alert--info mb-2">
                <span>{objetivo.historical_deviation.recommendation}</span>
              </p>
            )}
            {objetivo.can_validate ? (
              <SeccionObjetivo
                key={`o-${version}`}
                tareaId={tarea.id}
                info={objetivo}
                onHecho={hecho}
              />
            ) : (
              <p className="mz-small mz-faint mb-0">
                No puede validar el Tiempo Objetivo de esta tarea (es propia o
                no tiene el permiso).
              </p>
            )}
            <Historial tipo="objetivo" entradas={objetivo.audit_history} />
          </>
        )}
      </section>

      <section className="gt-bloque" aria-labelledby="gt-val-sec-fecha">
        <h4 id="gt-val-sec-fecha" className="gt-bloque__titulo">
          Fecha fin
        </h4>
        <EstadoDeCarga
          cargando={!fecha && !errorFecha}
          error={errorFecha}
          onReintentar={cargarFecha}
        />
        {fecha && (
          <>
            <p>
              Fecha propuesta: <strong>{fechaCorta(fecha.end_date)}</strong>{" "}
              <EstadoFechaFin estado={fecha.end_date_approval_status} />
            </p>
            {fecha.can_validate ? (
              <SeccionFechaFin
                key={`f-${version}`}
                tareaId={tarea.id}
                info={fecha}
                inicio={tarea.start_date}
                onHecho={hecho}
              />
            ) : (
              <p className="mz-small mz-faint mb-0">
                No puede decidir la Fecha Fin de esta tarea (es propia o no
                tiene el permiso).
              </p>
            )}
            <Historial tipo="fecha" entradas={fecha.audit_history} />
          </>
        )}
      </section>
      <p className="mz-small mz-faint mb-0">
        Cada decisión queda registrada con su usuario, su rol y la fecha; el
        historial no se borra.
      </p>
    </Ventana>
  );
}
