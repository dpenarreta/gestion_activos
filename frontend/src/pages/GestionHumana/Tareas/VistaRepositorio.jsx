/*
 * Repositorio de tareas (`RepositoryView` de Nexo): los meses cerrados con
 * sus tareas archivadas (las suyas y las de su equipo según el organigrama),
 * de solo lectura. Quien administra Tareas corrige una archivada (horas
 * reales o estado final); la corrección queda marcada y en el cierre.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { errorDeTareas, tareasService } from "../../../api/tareasService";
import {
  Campo,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { Aviso, ErrorEnLinea, MenuDeAcciones } from "../comunes";
import { PreviaHoras, PillEstado, PillPrioridad } from "./Indicadores";
import {
  AYUDA_HORAS,
  ESTADO,
  ESTADOS,
  FRECUENCIA,
  HORAS_INVALIDAS,
  claseDeColor,
  fechaCorta,
  horas,
  horasATexto,
  horasValidas,
  mesLargo,
  nombreDe,
  objetivoOficial,
  objetivoValidado,
  textoAHoras,
} from "./tareasComunes";

function CorregirArchivada({ tarea, onCerrar, onCorregida }) {
  const [real, setReal] = useState(horasATexto(tarea.real_hours));
  const [estado, setEstado] = useState(tarea.status);
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);
  const panel = useRef(null);

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    if (!horasValidas(real)) {
      setErrores({ real_hours: HORAS_INVALIDAS });
      enfocarPrimerError(panel.current);
      return;
    }
    const cuerpo = {};
    if (real !== horasATexto(tarea.real_hours))
      cuerpo.real_hours = textoAHoras(real);
    if (estado !== tarea.status) cuerpo.status = estado;
    if (!Object.keys(cuerpo).length) {
      setErrores({});
      setError("No hay cambios para guardar.");
      return;
    }
    enCurso.current = true;
    setGuardando(true);
    setErrores({});
    setError(null);
    try {
      onCorregida(await tareasService.corregirArchivada(tarea.id, cuerpo));
    } catch (err) {
      const fallo = errorDeTareas(err, "No se pudo guardar la corrección.");
      setErrores(fallo.campos);
      setError(fallo.mensaje);
      setGuardando(false);
      enCurso.current = false;
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo="Corregir tarea archivada"
      subtitulo={`${tarea.title}. La corrección queda marcada en la tarea y registrada en el cierre del mes.`}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar="Guardar corrección"
      isSaving={guardando}
    >
      <div ref={panel}>
        <Campo
          id="gt-corregir-horas"
          etiqueta="Horas reales (HH.MM)"
          ayuda={AYUDA_HORAS}
          error={errores.real_hours}
        >
          <input
            className="form-control"
            inputMode="decimal"
            placeholder="Ej.: 6.30"
            value={real}
            onChange={(e) => setReal(e.target.value)}
          />
        </Campo>
        <PreviaHoras texto={real} />
        <Campo
          id="gt-corregir-estado"
          etiqueta="Estado final"
          error={errores.status}
          className="mt-3"
        >
          <select
            className="form-select"
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
          >
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {ESTADO[e]}
              </option>
            ))}
          </select>
        </Campo>
        <ErrorEnLinea mensaje={error} className="mt-3" />
      </div>
    </ModalDialog>
  );
}

function DetalleDelMes({ mes, administra, onVolver }) {
  const [tareas, setTareas] = useState(null);
  const [error, setError] = useState(null);
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [aviso, setAviso] = useState(null);
  const volver = useRef(null);

  const cargar = useCallback(() => {
    setError(null);
    setTareas(null);
    tareasService
      .repositorioDelMes(mes.year, mes.month)
      .then((lista) => setTareas(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setError(
          errorDeTareas(err, "No se pudieron cargar las tareas del mes.")
            .mensaje,
        ),
      );
  }, [mes.year, mes.month]);

  useEffect(() => {
    cargar();
    volver.current?.focus();
  }, [cargar]);

  const porcentaje = mes.total_tasks
    ? Math.round((mes.completed_tasks / mes.total_tasks) * 100)
    : 0;

  return (
    <div className="gh-page">
      <div>
        <button
          ref={volver}
          type="button"
          className="btn btn-link px-0"
          onClick={onVolver}
        >
          <Icon name="arrow-left" /> Volver al repositorio
        </button>
      </div>
      <h3 className="h5 mb-0">
        {mesLargo(mes.year, mes.month)}{" "}
        <span className="mz-small mz-faint">· solo lectura</span>
      </h3>
      <div className="mz-kpi-grid">
        <div className="mz-kpi">
          <div className="mz-kpi-label">Tareas</div>
          <div className="mz-kpi-value">{mes.total_tasks}</div>
        </div>
        <div className="mz-kpi">
          <div className="mz-kpi-label">Completadas</div>
          <div className="mz-kpi-value">{porcentaje} %</div>
        </div>
        <div className="mz-kpi">
          <div className="mz-kpi-label">Horas registradas</div>
          <div className="mz-kpi-value">{horas(mes.total_hours)}</div>
        </div>
      </div>
      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />
      <EstadoDeCarga
        cargando={tareas === null && !error}
        error={error}
        onReintentar={cargar}
        vacio={tareas?.length === 0}
        textoVacio="No tiene tareas archivadas visibles en este mes."
      />
      {tareas?.length > 0 && (
        <div className="mz-table-wrap gt-tabla-wrap">
          <table className="mz-table gt-tabla">
            <caption className="visually-hidden">
              Tareas archivadas de {mesLargo(mes.year, mes.month)}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="gt-fija">
                  Tarea
                </th>
                <th scope="col">Responsable</th>
                <th scope="col">Frecuencia</th>
                <th scope="col">Estado</th>
                <th scope="col">Prioridad</th>
                <th scope="col">Fin</th>
                <th scope="col" className="num">
                  T. objetivo
                </th>
                <th scope="col" className="num">
                  H. reales
                </th>
                <th scope="col" className="num">
                  Avance
                </th>
                {administra && (
                  <th scope="col">
                    <span className="visually-hidden">Acciones</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {tareas.map((t) => (
                <tr key={t.id} className={claseDeColor(t.color)}>
                  <th scope="row" className="gt-fija">
                    <span className="gt-fija__texto">
                      <span className="gt-fija__titulo">{t.title}</span>
                      {t.corrected && (
                        <span className="mz-pill mz-pill--warn">
                          <Icon name="pencil" /> Corregida
                        </span>
                      )}
                    </span>
                  </th>
                  <td>{nombreDe(t.assigned_to)}</td>
                  <td>{FRECUENCIA[t.frequency] ?? t.frequency}</td>
                  <td>
                    <PillEstado estado={t.status} />
                  </td>
                  <td>
                    <PillPrioridad prioridad={t.priority} />
                  </td>
                  <td>{fechaCorta(t.end_date)}</td>
                  <td className="num">
                    {horas(objetivoOficial(t))}
                    {objetivoValidado(t) && (
                      <span className="gt-texto--ok">
                        {" "}
                        <Icon name="check-circle" />
                        <span className="visually-hidden"> validado</span>
                      </span>
                    )}
                  </td>
                  <td className="num">{horas(t.real_hours)}</td>
                  <td className="num">{t.progress ?? 0} %</td>
                  {administra && (
                    <td>
                      <MenuDeAcciones
                        etiqueta={`Más acciones de «${t.title}»`}
                        acciones={[
                          {
                            texto: "Corregir",
                            onClick: () => setCorrigiendo(t),
                          },
                        ]}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {corrigiendo && (
        <CorregirArchivada
          tarea={corrigiendo}
          onCerrar={() => setCorrigiendo(null)}
          onCorregida={(nueva) => {
            setTareas((l) => l.map((x) => (x.id === nueva.id ? nueva : x)));
            setCorrigiendo(null);
            setAviso({ texto: `Tarea «${nueva.title}» corregida.` });
          }}
        />
      )}
    </div>
  );
}

export function VistaRepositorio({ administra }) {
  const [meses, setMeses] = useState(null);
  const [error, setError] = useState(null);
  // El mes abierto va en la dirección (`?mes=2026-10`): «Atrás» del
  // navegador vuelve a la lista, y el foco regresa al mes que se abrió.
  const [parametros, setParametros] = useSearchParams();
  const clave = parametros.get("mes");
  const elegido =
    meses?.find(
      (m) => `${m.year}-${String(m.month).padStart(2, "0")}` === clave,
    ) ?? null;
  const ultimo = useRef(null);

  const elegir = (m) => {
    const siguiente = new URLSearchParams(parametros);
    if (m) {
      ultimo.current = `${m.year}-${String(m.month).padStart(2, "0")}`;
      siguiente.set("mes", ultimo.current);
    } else {
      siguiente.delete("mes");
    }
    setParametros(siguiente);
  };

  useEffect(() => {
    if (elegido || !ultimo.current || !meses) return undefined;
    const reloj = setTimeout(
      () => document.getElementById(`gt-mes-${ultimo.current}`)?.focus(),
      0,
    );
    return () => clearTimeout(reloj);
  }, [elegido, meses]);

  const cargar = useCallback(() => {
    setError(null);
    setMeses(null);
    tareasService
      .repositorio()
      .then((lista) => setMeses(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setError(
          errorDeTareas(err, "No se pudo cargar el repositorio.").mensaje,
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const porAnio = useMemo(() => {
    const mapa = new Map();
    for (const m of meses ?? []) {
      mapa.set(m.year, [...(mapa.get(m.year) ?? []), m]);
    }
    return [...mapa.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([anio, lista]) => [anio, lista.sort((a, b) => b.month - a.month)]);
  }, [meses]);

  if (elegido) {
    return (
      <DetalleDelMes
        mes={elegido}
        administra={administra}
        onVolver={() => elegir(null)}
      />
    );
  }

  return (
    <div className="gh-page">
      <EstadoDeCarga
        cargando={meses === null && !error}
        error={error}
        onReintentar={cargar}
        vacio={meses?.length === 0}
        textoVacio="Todavía no hay meses cerrados en el repositorio."
      />
      {porAnio.map(([anio, lista]) => (
        <section key={anio} aria-labelledby={`gt-repo-${anio}`}>
          <h3 id={`gt-repo-${anio}`} className="h6">
            {anio}
          </h3>
          <ul className="gt-meses">
            {lista.map((m) => {
              const pct = m.total_tasks
                ? Math.round((m.completed_tasks / m.total_tasks) * 100)
                : 0;
              return (
                <li key={m.month}>
                  <button
                    type="button"
                    id={`gt-mes-${m.year}-${String(m.month).padStart(2, "0")}`}
                    className="gt-mes"
                    onClick={() => elegir(m)}
                  >
                    <strong>{mesLargo(m.year, m.month)}</strong>
                    <span className="mz-small mz-faint">
                      {m.total_tasks} tareas · {pct} % completadas ·{" "}
                      {horas(m.total_hours)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
