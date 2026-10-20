import { useCallback, useEffect, useState } from "react";

import { capacitacionService } from "../../api/capacitacionService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";

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
  });
  const [archivo, setArchivo] = useState(null);
  const [quitarArchivo, setQuitarArchivo] = useState(false);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const fijar = (campo) => (e) =>
    setValores((v) => ({
      ...v,
      [campo]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  async function guardar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
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
      setGuardando(false);
    }
  }

  return (
    <Ventana
      titulo={inicial.id ? `Editar «${inicial.titulo}»` : "Nuevo material"}
      onCerrar={onCerrar}
    >
      <form className="row g-2" onSubmit={guardar}>
        {error && (
          <div className="col-12">
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          </div>
        )}
        <div className="col-12">
          <label className="form-label mz-small" htmlFor="mat-titulo">
            Título
          </label>
          <input
            id="mat-titulo"
            required
            maxLength={150}
            className="form-control form-control-sm"
            value={valores.titulo}
            onChange={fijar("titulo")}
          />
        </div>
        <div className="col-12">
          <label className="form-label mz-small" htmlFor="mat-descripcion">
            Descripción (opcional)
          </label>
          <input
            id="mat-descripcion"
            className="form-control form-control-sm"
            value={valores.descripcion}
            onChange={fijar("descripcion")}
          />
        </div>
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
          <div className="col-12 col-md-8">
            <label className="form-label mz-small" htmlFor="mat-unidad">
              Área
            </label>
            <select
              id="mat-unidad"
              required
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
          </div>
        )}
        {valores.alcance === "cargo" && (
          <div className="col-12 col-md-8">
            <label className="form-label mz-small" htmlFor="mat-cargo">
              Cargo
            </label>
            <select
              id="mat-cargo"
              required
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
          </div>
        )}
        <div className="col-12">
          <p className="mz-faint mz-small mb-1">
            El material puede combinar texto, un archivo y un video: llene lo
            que necesite (al menos uno).
          </p>
          <label className="form-label mz-small" htmlFor="mat-contenido">
            Contenido (texto)
          </label>
          <textarea
            id="mat-contenido"
            rows={7}
            className="form-control form-control-sm"
            value={valores.contenido}
            onChange={fijar("contenido")}
          />
        </div>
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
        <div className="col-12 col-md-6">
          <label className="form-label mz-small" htmlFor="mat-url">
            Enlace a un video (opcional)
          </label>
          <input
            id="mat-url"
            type="url"
            placeholder="https://…"
            className="form-control form-control-sm"
            value={valores.url}
            onChange={fijar("url")}
          />
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label mz-small" htmlFor="mat-nota">
            Nota mínima (sobre 100)
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

/** La evaluación de un material: preguntas de opción múltiple con su
 * respuesta correcta marcada. */
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
            ? lista
            : [{ texto: "", opciones: [{ texto: "" }, { texto: "" }] }],
        ),
      )
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar la evaluación.")),
      );
  }, [material.id]);

  const cambiar = (i, cambio) =>
    setPreguntas((ps) => ps.map((p, j) => (j === i ? cambio(p) : p)));

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
          Cada pregunta con sus opciones; marque la correcta. El puntaje es el
          porcentaje de preguntas acertadas.
        </p>
        {preguntas?.map((p, i) => (
          <fieldset key={i} className="onboarding-pregunta">
            <legend className="d-flex gap-2 align-items-center">
              <span>{i + 1}.</span>
              <input
                className="form-control form-control-sm"
                aria-label={`Pregunta ${i + 1}`}
                maxLength={500}
                placeholder="Escriba la pregunta"
                value={p.texto}
                onChange={(e) =>
                  cambiar(i, (x) => ({ ...x, texto: e.target.value }))
                }
              />
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                aria-label={`Quitar la pregunta ${i + 1}`}
                onClick={() =>
                  setPreguntas((ps) => ps.filter((_, j) => j !== i))
                }
              >
                <Icon name="trash" />
              </button>
            </legend>
            {p.opciones.map((o, k) => (
              <div key={k} className="onboarding-opcion">
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
                <input
                  className="form-control form-control-sm"
                  aria-label={`Opción ${k + 1} de la pregunta ${i + 1}`}
                  maxLength={300}
                  value={o.texto}
                  onChange={(e) =>
                    cambiar(i, (x) => ({
                      ...x,
                      opciones: x.opciones.map((op, m) =>
                        m === k ? { ...op, texto: e.target.value } : op,
                      ),
                    }))
                  }
                />
              </div>
            ))}
            <button
              type="button"
              className="btn btn-link btn-sm px-0"
              onClick={() =>
                cambiar(i, (x) => ({
                  ...x,
                  opciones: [...x.opciones, { texto: "" }],
                }))
              }
            >
              <Icon name="plus" /> Opción
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="btn btn-outline-primary btn-sm align-self-start"
          onClick={() =>
            setPreguntas((ps) => [
              ...(ps ?? []),
              { texto: "", opciones: [{ texto: "" }, { texto: "" }] },
            ])
          }
        >
          <Icon name="plus-lg" /> Agregar pregunta
        </button>
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
            disabled={!preguntas || guardando}
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

  const cargar = useCallback(
    () =>
      capacitacionService
        .materiales()
        .then(setMateriales)
        .catch((err) =>
          setError(
            mensajeDeError(err, "No se pudieron cargar los materiales."),
          ),
        ),
    [],
  );

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function eliminar(m) {
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
      {materiales && materiales.length === 0 && (
        <p className="mz-faint">Todavía no hay materiales de capacitación.</p>
      )}
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
                          {m.formatos.join(" + ") || "Sin contenido"} · nota{" "}
                          {m.nota_minima} · {m.intentos_max} intentos
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
