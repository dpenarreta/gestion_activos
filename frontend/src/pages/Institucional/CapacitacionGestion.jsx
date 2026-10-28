import { useCallback, useEffect, useRef, useState } from "react";

import { capacitacionService } from "../../api/capacitacionService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
import { confirmar } from "../../components/common/Confirmar/confirmar";

const ALCANCES = [
  ["empresa", "De la empresa (todos)"],
  ["unidad", "De un área"],
  ["cargo", "De un cargo"],
];
const VACIO = {
  titulo: "",
  descripcion: "",
  alcance: "empresa",
  unidad: "",
  cargo: "",
  url: "",
  contenido: "",
  nota_minima: 70,
  intentos_max: 3,
  tiempo_limite: "",
  orden: 0,
  activo: true,
};

function Ventana({ titulo, onCerrar, children }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal mz-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>{titulo}</h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <div className="mz-panel-body">{children}</div>
      </div>
    </div>
  );
}

/** Crear o editar un material: alcance, contenido, nota e intentos. */
function EditorMaterial({ inicial, datos, onGuardado, onCerrar }) {
  const [valores, setValores] = useState({
    ...VACIO,
    ...inicial,
    unidad: inicial.unidad ?? "",
    cargo: inicial.cargo ?? "",
    tiempo_limite: inicial.tiempo_limite ?? "",
  });
  const [archivo, setArchivo] = useState(null);
  const [quitarArchivo, setQuitarArchivo] = useState(false);
  const [error, setError] = useState(null);
  // Errores del servidor junto a su campo y foco al primero (auditoría
  // UX/UI, fase 2, 28/10/2026).
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const formulario = useRef(null);
  const fijar = (campo) => (e) =>
    setValores((v) => ({
      ...v,
      [campo]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  async function guardar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    setErrores({});
    const campos = {
      titulo: valores.titulo,
      descripcion: valores.descripcion,
      alcance: valores.alcance,
      unidad: valores.alcance === "unidad" ? valores.unidad : "",
      cargo: valores.alcance === "cargo" ? valores.cargo : "",
      url: valores.url,
      contenido: valores.contenido,
      quitar_archivo: quitarArchivo && !archivo,
      nota_minima: valores.nota_minima,
      intentos_max: valores.intentos_max,
      // Vacío: sin límite.
      tiempo_limite: valores.tiempo_limite,
      orden: valores.orden,
      activo: valores.activo,
    };
    try {
      const guardado = await capacitacionService.guardarMaterial(
        inicial.id,
        campos,
        archivo,
      );
      onGuardado(guardado);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el material."));
      setErrores(erroresPorCampo(err));
      setGuardando(false);
      enfocarPrimerError(formulario.current);
    }
  }

  return (
    <Ventana
      titulo={inicial.id ? `Editar «${inicial.titulo}»` : "Nuevo material"}
      onCerrar={onCerrar}
    >
      <form ref={formulario} className="row g-2" onSubmit={guardar}>
        {error && (
          <div className="col-12">
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          </div>
        )}
        <div className="col-12">
          <LeyendaObligatorios />
        </div>
        <Campo
          id="mat-titulo"
          etiqueta="Título"
          obligatorio
          error={errores.titulo}
          className="col-12"
        >
          <input
            maxLength={150}
            className="form-control form-control-sm"
            value={valores.titulo}
            onChange={fijar("titulo")}
          />
        </Campo>
        <Campo
          id="mat-descripcion"
          etiqueta="Descripción (opcional)"
          error={errores.descripcion}
          className="col-12"
        >
          <input
            className="form-control form-control-sm"
            value={valores.descripcion}
            onChange={fijar("descripcion")}
          />
        </Campo>
        <div className="col-12 col-md-4">
          <label className="form-label mz-small" htmlFor="mat-alcance">
            Para quién
          </label>
          <select
            id="mat-alcance"
            className="form-select form-select-sm"
            value={valores.alcance}
            onChange={fijar("alcance")}
          >
            {ALCANCES.map(([id, texto]) => (
              <option key={id} value={id}>
                {texto}
              </option>
            ))}
          </select>
        </div>
        {valores.alcance === "unidad" && (
          <Campo
            id="mat-unidad"
            etiqueta="Área"
            obligatorio
            error={errores.unidad}
            className="col-12 col-md-8"
          >
            <select
              className="form-select form-select-sm"
              value={valores.unidad}
              onChange={fijar("unidad")}
            >
              <option value="">Elija el área</option>
              {datos.unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </Campo>
        )}
        {valores.alcance === "cargo" && (
          <Campo
            id="mat-cargo"
            etiqueta="Cargo"
            obligatorio
            error={errores.cargo}
            className="col-12 col-md-8"
          >
            <select
              className="form-select form-select-sm"
              value={valores.cargo}
              onChange={fijar("cargo")}
            >
              <option value="">Elija el cargo</option>
              {datos.cargos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                  {datos.unidades.find((u) => u.id === c.unidad)
                    ? ` · ${datos.unidades.find((u) => u.id === c.unidad).nombre}`
                    : ""}
                </option>
              ))}
            </select>
          </Campo>
        )}
        <p className="col-12 mz-faint mz-small mb-0">
          El material puede combinar texto, un archivo y un video: llene lo que
          necesite (al menos uno).
        </p>
        <Campo
          id="mat-contenido"
          etiqueta="Contenido (texto)"
          error={errores.contenido}
          className="col-12"
        >
          <textarea
            rows={7}
            className="form-control form-control-sm"
            value={valores.contenido}
            onChange={fijar("contenido")}
          />
        </Campo>
        <div className="col-12 col-md-6">
          <label className="form-label mz-small" htmlFor="mat-archivo">
            Archivo: PDF o presentación (.ppt, .pptx)
          </label>
          <input
            id="mat-archivo"
            type="file"
            accept=".pdf,.ppt,.pptx"
            className="form-control form-control-sm"
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          />
          {inicial.tiene_archivo && !archivo && (
            <div className="d-flex flex-wrap gap-2 align-items-center mt-1">
              <small className="mz-faint">
                Actual: {inicial.archivo_nombre || "archivo cargado"}
              </small>
              <label className="form-check mb-0">
                <input
                  type="checkbox"
                  className="form-check-input"
                  checked={quitarArchivo}
                  onChange={(e) => setQuitarArchivo(e.target.checked)}
                />{" "}
                <span className="form-check-label mz-small">Quitarlo</span>
              </label>
            </div>
          )}
          <small className="mz-faint d-block">Hasta 50 MB.</small>
        </div>
        <Campo
          id="mat-url"
          etiqueta="Enlace a un video (opcional)"
          error={errores.url}
          className="col-12 col-md-6"
        >
          <input
            type="url"
            placeholder="https://…"
            className="form-control form-control-sm"
            value={valores.url}
            onChange={fijar("url")}
          />
        </Campo>
        <div className="col-6 col-md-3">
          <label className="form-label mz-small" htmlFor="mat-nota">
            % para aprobar
          </label>
          <input
            id="mat-nota"
            type="number"
            min={1}
            max={100}
            className="form-control form-control-sm"
            value={valores.nota_minima}
            onChange={fijar("nota_minima")}
          />
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label mz-small" htmlFor="mat-intentos">
            Intentos
          </label>
          <input
            id="mat-intentos"
            type="number"
            min={1}
            max={10}
            className="form-control form-control-sm"
            value={valores.intentos_max}
            onChange={fijar("intentos_max")}
          />
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label mz-small" htmlFor="mat-tiempo">
            Tiempo límite (minutos)
          </label>
          <input
            id="mat-tiempo"
            type="number"
            min={1}
            max={600}
            placeholder="Sin límite"
            className="form-control form-control-sm"
            value={valores.tiempo_limite}
            onChange={fijar("tiempo_limite")}
          />
        </div>
        <div className="col-12 col-md-6 d-flex align-items-end">
          <label className="form-check mb-1">
            <input
              type="checkbox"
              className="form-check-input"
              checked={valores.activo}
              onChange={fijar("activo")}
            />{" "}
            <span className="form-check-label">
              Activo (forma parte de los planes)
            </span>
          </label>
        </div>
        <div className="col-12 mz-actions justify-content-end">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={onCerrar}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={guardando}
          >
            {guardando ? "Guardando…" : "Guardar material"}
          </button>
        </div>
      </form>
    </Ventana>
  );
}

/** Los tipos de pregunta (ver `apps/capacitacion/evaluacion.py`). */
const TIPOS = [
  ["unica", "Marcar la correcta"],
  ["multiple", "Opción múltiple"],
  ["completar", "Completar espacios"],
  ["unir", "Unir con su respuesta"],
];
const AYUDA_TIPO = {
  unica: "Una sola opción es la correcta.",
  multiple:
    "Marque todas las correctas. Se califica en proporción: cada opción errada marcada resta una acertada.",
  completar:
    "Escriba la frase o el párrafo y ponga entre corchetes dobles cada palabra a completar, por ejemplo: «El SRI exige el [[RUC]]». Para aceptar varias respuestas: [[electrónica|digital]].",
  unir: "Cada concepto con su respuesta; quien rinde verá las respuestas mezcladas. Se califica en proporción por pareja.",
};

const preguntaNueva = (tipo = "unica", puntos = "") => ({
  tipo,
  texto: "",
  puntos,
  opciones:
    tipo === "completar"
      ? []
      : [
          { texto: "", pareja: "" },
          { texto: "", pareja: "" },
        ],
});

/** La suma de los puntos, en centésimas para no arrastrar decimales. */
export function sumaDePuntos(preguntas) {
  const centesimas = (preguntas ?? []).reduce(
    (total, p) => total + Math.round((Number(p.puntos) || 0) * 100),
    0,
  );
  return centesimas / 100;
}

/** Reparte los 10 puntos en partes iguales (el resto, a la última). */
export function repartirPuntos(preguntas) {
  const n = preguntas.length;
  if (!n) return preguntas;
  const parte = Math.floor(1000 / n) / 100;
  const ultima = Math.round((10 - parte * (n - 1)) * 100) / 100;
  return preguntas.map((p, i) => ({
    ...p,
    puntos: String(i === n - 1 ? ultima : parte),
  }));
}

function Opciones({ pregunta: p, i, cambiar }) {
  const cambiarOpcion = (k, cambio) =>
    cambiar(i, (x) => ({
      ...x,
      opciones: x.opciones.map((op, m) => (m === k ? cambio(op) : op)),
    }));
  const quitar = (k) =>
    cambiar(i, (x) => ({
      ...x,
      opciones: x.opciones.filter((_, m) => m !== k),
    }));
  if (p.tipo === "completar") {
    const espacios = (p.texto.match(/\[\[[^[\]]+\]\]/g) ?? []).length;
    return (
      <p className="mz-small mb-0">
        {espacios
          ? `${espacios} espacio(s) a completar.`
          : "Aún no hay espacios: escriba la palabra entre [[ ]]."}
      </p>
    );
  }
  const unir = p.tipo === "unir";
  return (
    <>
      {p.opciones.map((o, k) => (
        <div key={k} className="onboarding-opcion">
          {p.tipo === "unica" && (
            <input
              type="radio"
              className="form-check-input"
              name={`correcta-${i}`}
              aria-label={`Opción ${k + 1} de la pregunta ${i + 1} es la correcta`}
              checked={Boolean(o.correcta)}
              onChange={() =>
                cambiar(i, (x) => ({
                  ...x,
                  opciones: x.opciones.map((op, m) => ({
                    ...op,
                    correcta: m === k,
                  })),
                }))
              }
            />
          )}
          {p.tipo === "multiple" && (
            <input
              type="checkbox"
              className="form-check-input"
              aria-label={`Opción ${k + 1} de la pregunta ${i + 1} es correcta`}
              checked={Boolean(o.correcta)}
              onChange={(e) =>
                cambiarOpcion(k, (op) => ({
                  ...op,
                  correcta: e.target.checked,
                }))
              }
            />
          )}
          <input
            className="form-control form-control-sm"
            aria-label={
              unir
                ? `Concepto ${k + 1} de la pregunta ${i + 1}`
                : `Opción ${k + 1} de la pregunta ${i + 1}`
            }
            placeholder={unir ? "Concepto" : undefined}
            maxLength={300}
            value={o.texto}
            onChange={(e) =>
              cambiarOpcion(k, (op) => ({ ...op, texto: e.target.value }))
            }
          />
          {unir && (
            <>
              <Icon name="arrow-right" />
              <input
                className="form-control form-control-sm"
                aria-label={`Respuesta del concepto ${k + 1} de la pregunta ${i + 1}`}
                placeholder="Su respuesta"
                maxLength={300}
                value={o.pareja ?? ""}
                onChange={(e) =>
                  cambiarOpcion(k, (op) => ({ ...op, pareja: e.target.value }))
                }
              />
            </>
          )}
          {p.opciones.length > 2 && (
            <button
              type="button"
              className="btn btn-link btn-sm text-danger px-1"
              aria-label={`Quitar ${unir ? "el concepto" : "la opción"} ${k + 1} de la pregunta ${i + 1}`}
              onClick={() => quitar(k)}
            >
              <Icon name="x-lg" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="btn btn-link btn-sm px-0 align-self-start"
        onClick={() =>
          cambiar(i, (x) => ({
            ...x,
            opciones: [...x.opciones, { texto: "", pareja: "" }],
          }))
        }
      >
        <Icon name="plus" /> {unir ? "Pareja" : "Opción"}
      </button>
    </>
  );
}

/** La evaluación de un material (22/10/2026): preguntas de cuatro tipos,
 * cada una con sus puntos; entre todas suman 10. */
function EditorPreguntas({ material, onGuardado, onCerrar }) {
  const [preguntas, setPreguntas] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    capacitacionService
      .preguntas(material.id)
      .then((lista) =>
        setPreguntas(
          lista.length
            ? lista.map((p) => ({ tipo: "unica", ...p }))
            : [preguntaNueva("unica", "10")],
        ),
      )
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar la evaluación.")),
      );
  }, [material.id]);

  const cambiar = (i, cambio) =>
    setPreguntas((ps) => ps.map((p, j) => (j === i ? cambio(p) : p)));

  const suma = sumaDePuntos(preguntas);
  const cuadra = Math.abs(suma - 10) < 0.001;

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await capacitacionService.guardarPreguntas(material.id, preguntas);
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la evaluación."));
      setGuardando(false);
    }
  }

  return (
    <Ventana titulo={`Evaluación de «${material.titulo}»`} onCerrar={onCerrar}>
      <div className="mz-stack">
        {error && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        <p className="mz-faint mz-small mb-0">
          Cada pregunta vale sus puntos y entre todas suman 10. La nota es sobre
          10 y se aprueba con el porcentaje mínimo del material
          {material.nota_minima != null ? ` (${material.nota_minima} %)` : ""}.
        </p>
        {/* Mientras llegan las preguntas (auditoría UX/UI, fase 2). */}
        {preguntas === null && !error && <EstadoDeCarga cargando />}
        {preguntas?.map((p, i) => (
          <fieldset key={i} className="onboarding-pregunta">
            <legend className="d-flex flex-wrap gap-2 align-items-center">
              <span>{i + 1}.</span>
              <select
                className="form-select form-select-sm w-auto"
                aria-label={`Tipo de la pregunta ${i + 1}`}
                value={p.tipo}
                onChange={(e) => {
                  const tipo = e.target.value;
                  cambiar(i, (x) => ({
                    ...x,
                    tipo,
                    opciones:
                      tipo === "completar"
                        ? []
                        : x.opciones.length >= 2
                          ? x.opciones.map((o) => ({
                              ...o,
                              correcta: tipo === "unir" ? false : o.correcta,
                            }))
                          : preguntaNueva(tipo).opciones,
                  }));
                }}
              >
                {TIPOS.map(([valor, nombre]) => (
                  <option key={valor} value={valor}>
                    {nombre}
                  </option>
                ))}
              </select>
              <label className="d-flex align-items-center gap-1 mz-small">
                <input
                  className="form-control form-control-sm onboarding-puntos"
                  aria-label={`Puntos de la pregunta ${i + 1}`}
                  type="number"
                  min="0.01"
                  max="10"
                  step="0.25"
                  value={p.puntos}
                  onChange={(e) =>
                    cambiar(i, (x) => ({ ...x, puntos: e.target.value }))
                  }
                />
                puntos
              </label>
              <button
                type="button"
                className="btn btn-outline-danger btn-sm ms-auto"
                aria-label={`Quitar la pregunta ${i + 1}`}
                onClick={() =>
                  setPreguntas((ps) => ps.filter((_, j) => j !== i))
                }
              >
                <Icon name="trash" />
              </button>
            </legend>
            {p.tipo === "completar" ? (
              <textarea
                className="form-control form-control-sm"
                aria-label={`Pregunta ${i + 1}`}
                rows={3}
                maxLength={2000}
                placeholder="El SRI exige el [[RUC]] para facturar."
                value={p.texto}
                onChange={(e) =>
                  cambiar(i, (x) => ({ ...x, texto: e.target.value }))
                }
              />
            ) : (
              <input
                className="form-control form-control-sm"
                aria-label={`Pregunta ${i + 1}`}
                maxLength={2000}
                placeholder={
                  p.tipo === "unir"
                    ? "Por ejemplo: Una cada sigla con su entidad"
                    : "Escriba la pregunta"
                }
                value={p.texto}
                onChange={(e) =>
                  cambiar(i, (x) => ({ ...x, texto: e.target.value }))
                }
              />
            )}
            <small className="mz-faint d-block">{AYUDA_TIPO[p.tipo]}</small>
            <Opciones pregunta={p} i={i} cambiar={cambiar} />
          </fieldset>
        ))}
        <div className="d-flex flex-wrap gap-2 align-items-center">
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={() =>
              setPreguntas((ps) => [...(ps ?? []), preguntaNueva()])
            }
          >
            <Icon name="plus-lg" /> Agregar pregunta
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={!preguntas?.length}
            onClick={() => setPreguntas((ps) => repartirPuntos(ps))}
          >
            <Icon name="distribute-horizontal" /> Repartir los 10 puntos por
            igual
          </button>
          <span
            className={`ms-auto mz-small ${cuadra ? "text-success" : "text-danger"}`}
            role="status"
          >
            Suma: {suma.toLocaleString("es-EC")} de 10 puntos
          </span>
        </div>
        <div className="mz-actions justify-content-end">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={onCerrar}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={
              !preguntas || guardando || (preguntas.length > 0 && !cuadra)
            }
            onClick={guardar}
          >
            {guardando ? "Guardando…" : "Guardar evaluación"}
          </button>
        </div>
      </div>
    </Ventana>
  );
}

/**
 * Editar estructura → Capacitación (pide `capacitacion.gestionar`): los
 * materiales de la empresa, de cada área y de cada cargo, con su evaluación.
 */
export function CapacitacionGestion({ datos }) {
  const [materiales, setMateriales] = useState(null);
  const [editando, setEditando] = useState(null);
  const [preguntas, setPreguntas] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);
  // El fallo al cargar va aparte, con «Reintentar» (auditoría UX/UI, fase 2,
  // 28/10/2026).
  const [errorCarga, setErrorCarga] = useState(null);

  const cargar = useCallback(() => {
    setErrorCarga(null);
    return capacitacionService
      .materiales()
      .then(setMateriales)
      .catch((err) =>
        setErrorCarga(
          mensajeDeError(err, "No se pudieron cargar los materiales."),
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function eliminar(m) {
    if (
      !(await confirmar({
        titulo: `¿Eliminar el material «${m.titulo}»?`,
        accion: "Eliminar",
      }))
    )
      return;
    setError(null);
    try {
      await capacitacionService.eliminarMaterial(m.id);
      setAviso(`«${m.titulo}» se eliminó.`);
      cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo eliminar."));
    }
  }

  return (
    <div className="mz-stack">
      <div className="d-flex flex-wrap gap-2 align-items-center justify-content-between">
        <p className="mz-faint mb-0">
          El plan de cada persona: lo de la empresa, lo de su área y lo de su
          cargo. Cada material lleva su evaluación.
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setEditando({ ...VACIO })}
        >
          <Icon name="plus-lg" /> Nuevo material
        </button>
      </div>
      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check-circle" />
          {aviso}
        </div>
      )}
      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      <EstadoDeCarga
        cargando={materiales === null}
        error={errorCarga}
        onReintentar={cargar}
        vacio={materiales?.length === 0}
        textoVacio="Todavía no hay materiales de capacitación."
      />
      {materiales &&
        ALCANCES.map(([alcance, titulo]) => {
          const lista = materiales.filter((m) => m.alcance === alcance);
          if (!lista.length) return null;
          return (
            <section key={alcance} className="mz-card">
              <div className="mz-card-body">
                <h4 className="inicio-titulo">{titulo}</h4>
                <ul className="perfil-cargo-lista">
                  {lista.map((m) => (
                    <li key={m.id}>
                      <span className="perfil-cargo-lista__nombre">
                        <strong>{m.titulo}</strong>
                        <small className="mz-faint">
                          {m.de && ` · ${m.de}`} ·{" "}
                          {m.formatos.join(" + ") || "Sin contenido"} · aprueba
                          con {m.nota_minima} % · {m.intentos_max} intentos
                          {m.tiempo_limite ? ` · ${m.tiempo_limite} min` : ""}
                        </small>
                      </span>
                      {!m.activo && (
                        <span className="perfil-cargo-estado perfil-cargo-estado--vacio">
                          Inactivo
                        </span>
                      )}
                      <span
                        className={`perfil-cargo-estado ${m.preguntas ? "perfil-cargo-estado--completo" : "perfil-cargo-estado--parcial"}`}
                      >
                        {m.preguntas
                          ? `${m.preguntas} preguntas`
                          : "Sin evaluación"}
                      </span>
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        aria-label={`Evaluación de ${m.titulo}`}
                        onClick={() => setPreguntas(m)}
                      >
                        <Icon name="ui-checks" /> Evaluación
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        aria-label={`Editar ${m.titulo}`}
                        onClick={() => setEditando(m)}
                      >
                        <Icon name="pencil" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm"
                        aria-label={`Eliminar ${m.titulo}`}
                        onClick={() => eliminar(m)}
                      >
                        <Icon name="trash" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          );
        })}
      {editando && (
        <EditorMaterial
          inicial={editando}
          datos={datos}
          onCerrar={() => setEditando(null)}
          onGuardado={(guardado) => {
            setEditando(null);
            setAviso(
              editando.id
                ? "Material guardado."
                : `«${guardado.titulo}» creado. Agregue ahora su evaluación.`,
            );
            cargar();
          }}
        />
      )}
      {preguntas && (
        <EditorPreguntas
          material={preguntas}
          onCerrar={() => setPreguntas(null)}
          onGuardado={() => {
            setPreguntas(null);
            setAviso("Evaluación guardada.");
            cargar();
          }}
        />
      )}
    </div>
  );
}
