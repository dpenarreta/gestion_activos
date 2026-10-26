import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { guardarArchivo, proyectosService } from "../../api/proyectosService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import { ListaDeDestinos } from "./FlujosPermisoPage";
import { DESTINOS_APROBADOR } from "./licenciasComunes";
import "./Institucional.css";

export const TIPOS_DE_CAMPO = [
  ["texto", "Texto corto"],
  ["parrafo", "Párrafo"],
  ["numero", "Número"],
  ["fecha", "Fecha"],
  ["lista", "Lista de opciones"],
  ["casilla", "Casilla (sí / no)"],
  ["correo", "Correo"],
  ["telefono", "Teléfono"],
];

const NUEVO = {
  nombre: "",
  descripcion: "",
  activo: false,
  tiene_plantilla: false,
  campos: [
    { etiqueta: "Objetivo del proyecto", tipo: "parrafo", obligatorio: true },
  ],
  pasos: [
    { nombre: "Aprobación", aprobadores: [{ tipo: "jefe_inmediato" }] },
    { nombre: "Autorización", aprobadores: [{ tipo: "persona" }] },
    { nombre: "Revisión", aprobadores: [{ tipo: "persona" }] },
  ],
};

const ACEPTA = ".docx,.xlsx,.pdf";

function mover(lista, i, delta) {
  const j = i + delta;
  if (j < 0 || j >= lista.length) return lista;
  const nueva = [...lista];
  [nueva[i], nueva[j]] = [nueva[j], nueva[i]];
  return nueva;
}

/** Botones para subir, bajar y quitar una fila de una lista ordenada. */
function Orden({ nombre, i, total, onMover, onQuitar, minimo = 0 }) {
  return (
    <>
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        aria-label={`Subir ${nombre}`}
        disabled={i === 0}
        onClick={() => onMover(-1)}
      >
        <Icon name="arrow-up" />
      </button>
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm"
        aria-label={`Bajar ${nombre}`}
        disabled={i === total - 1}
        onClick={() => onMover(1)}
      >
        <Icon name="arrow-down" />
      </button>
      <button
        type="button"
        className="btn btn-outline-danger btn-sm"
        aria-label={`Quitar ${nombre}`}
        disabled={total <= minimo}
        onClick={onQuitar}
      >
        <Icon name="trash" />
      </button>
    </>
  );
}

/** Los campos del formulario: agregar, quitar, ordenar y decir si son
 * obligatorios. */
function EditorDeCampos({ campos, onCambio }) {
  const cambiar = (i, cambios) =>
    onCambio(campos.map((c, j) => (j === i ? { ...c, ...cambios } : c)));
  return (
    <div className="mz-stack">
      {campos.length === 0 && (
        <p className="mz-faint mz-small mb-0">
          Sin campos propios: solo se pide el nombre del proyecto y la plantilla
          llena.
        </p>
      )}
      <ol className="flujo-pasos">
        {campos.map((campo, i) => {
          const nombre = `el campo ${i + 1}`;
          return (
            <li key={campo.id ?? `nuevo-${i}`} className="flujo-paso">
              <div className="flujo-paso__cabecera">
                <span className="flujo-paso__numero">{i + 1}</span>
                <input
                  aria-label={`Nombre del campo ${i + 1}`}
                  className="form-control form-control-sm"
                  required
                  maxLength={120}
                  placeholder="Objetivo del proyecto"
                  value={campo.etiqueta}
                  onChange={(e) => cambiar(i, { etiqueta: e.target.value })}
                />
                <select
                  aria-label={`Tipo del campo ${i + 1}`}
                  className="form-select form-select-sm campo-proyecto__tipo"
                  value={campo.tipo}
                  onChange={(e) => cambiar(i, { tipo: e.target.value })}
                >
                  {TIPOS_DE_CAMPO.map(([id, texto]) => (
                    <option key={id} value={id}>
                      {texto}
                    </option>
                  ))}
                </select>
                <Orden
                  nombre={nombre}
                  i={i}
                  total={campos.length}
                  onMover={(delta) => onCambio(mover(campos, i, delta))}
                  onQuitar={() => onCambio(campos.filter((_, j) => j !== i))}
                />
              </div>
              <div className="row g-2">
                <div className="col-12 col-md-8">
                  <input
                    aria-label={`Ayuda del campo ${i + 1}`}
                    className="form-control form-control-sm"
                    maxLength={300}
                    placeholder="Ayuda para quien llena (opcional)"
                    value={campo.ayuda ?? ""}
                    onChange={(e) => cambiar(i, { ayuda: e.target.value })}
                  />
                </div>
                <div className="col-12 col-md-4 d-flex align-items-center">
                  <label className="form-check mb-0">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={Boolean(campo.obligatorio)}
                      onChange={(e) =>
                        cambiar(i, { obligatorio: e.target.checked })
                      }
                    />{" "}
                    <span className="form-check-label">Obligatorio</span>
                  </label>
                </div>
                {campo.tipo === "lista" && (
                  <div className="col-12">
                    <textarea
                      aria-label={`Opciones del campo ${i + 1}`}
                      className="form-control form-control-sm"
                      rows={3}
                      required
                      placeholder={"Una opción por línea\nAlta\nMedia\nBaja"}
                      value={(campo.opciones ?? []).join("\n")}
                      onChange={(e) =>
                        cambiar(i, { opciones: e.target.value.split("\n") })
                      }
                    />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="btn btn-outline-primary btn-sm align-self-start"
        onClick={() =>
          onCambio([
            ...campos,
            { etiqueta: "", tipo: "texto", obligatorio: false, ayuda: "" },
          ])
        }
      >
        <Icon name="plus-lg" /> Agregar campo
      </button>
    </div>
  );
}

/** Crear o editar un tipo de proyecto: datos, plantilla, formulario y
 * pasos. */
function EditorTipo({ inicial, opciones, onGuardado, onCerrar }) {
  const [tipo, setTipo] = useState(inicial);
  const [plantilla, setPlantilla] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const fijar = (campo) => (e) =>
    setTipo((t) => ({
      ...t,
      [campo]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));
  const pasos = tipo.pasos;
  const cambiarPasos = (nuevos) => setTipo((t) => ({ ...t, pasos: nuevos }));
  const conPlantilla = tipo.tiene_plantilla || Boolean(plantilla);

  async function guardar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    const limpiar = (lista) =>
      lista.map(({ tipo: t, usuario, rol, cargo }) => ({
        tipo: t,
        usuario: usuario ?? null,
        rol: rol ?? null,
        cargo: cargo ?? null,
      }));
    try {
      await onGuardado(
        {
          nombre: tipo.nombre,
          descripcion: tipo.descripcion ?? "",
          // Sin plantilla todavía no se activa: se activa al cargarla.
          activo: tipo.tiene_plantilla ? Boolean(tipo.activo) : false,
          campos: tipo.campos.map((c) => ({
            id: c.id ?? null,
            etiqueta: c.etiqueta,
            tipo: c.tipo,
            opciones:
              c.tipo === "lista"
                ? (c.opciones ?? []).map((o) => o.trim()).filter(Boolean)
                : [],
            obligatorio: Boolean(c.obligatorio),
            ayuda: c.ayuda ?? "",
          })),
          pasos: pasos.map((p) => ({
            id: p.id ?? null,
            nombre: p.nombre,
            aprobadores: limpiar(p.aprobadores),
          })),
        },
        plantilla,
        Boolean(tipo.activo),
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el tipo de proyecto."));
      setGuardando(false);
    }
  }

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="mz-modal mz-modal--wide flujo-editor"
        role="dialog"
        aria-modal="true"
        aria-label={
          inicial.id ? `Editar ${inicial.nombre}` : "Nuevo tipo de proyecto"
        }
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>
            {inicial.id
              ? `Editar «${inicial.nombre}»`
              : "Nuevo tipo de proyecto"}
          </h3>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <form className="mz-panel-body mz-stack" onSubmit={guardar}>
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          <div className="row g-2">
            <div className="col-12">
              <label className="form-label mz-small" htmlFor="tp-nombre">
                Nombre del tipo de proyecto
              </label>
              <input
                id="tp-nombre"
                className="form-control form-control-sm"
                required
                maxLength={120}
                placeholder="Proyecto de TI"
                value={tipo.nombre}
                onChange={fijar("nombre")}
              />
            </div>
            <div className="col-12">
              <label className="form-label mz-small" htmlFor="tp-descripcion">
                Indicaciones (las ve quien solicita)
              </label>
              <textarea
                id="tp-descripcion"
                rows={2}
                className="form-control form-control-sm"
                value={tipo.descripcion ?? ""}
                onChange={fijar("descripcion")}
              />
            </div>
          </div>

          <section aria-labelledby="tp-plantilla">
            <h4 id="tp-plantilla" className="inicio-titulo">
              Plantilla
            </h4>
            <p className="mz-faint mz-small">
              Quien solicita la descarga, la llena y la vuelve a cargar con su
              solicitud. Word (.docx), Excel (.xlsx) o PDF, hasta 10 MB.
            </p>
            {tipo.tiene_plantilla && (
              <p className="mz-small mb-1">
                <Icon name="file-earmark-text" /> Actual:{" "}
                <strong>{tipo.plantilla_nombre}</strong>
              </p>
            )}
            <label className="form-label mz-small" htmlFor="tp-archivo">
              {tipo.tiene_plantilla
                ? "Reemplazar por otra (opcional)"
                : "Cargar la plantilla"}
            </label>
            <input
              id="tp-archivo"
              type="file"
              accept={ACEPTA}
              className="form-control form-control-sm"
              onChange={(e) => setPlantilla(e.target.files?.[0] ?? null)}
            />
            <label className="form-check mt-2">
              <input
                type="checkbox"
                className="form-check-input"
                checked={Boolean(tipo.activo)}
                disabled={!conPlantilla}
                onChange={fijar("activo")}
              />{" "}
              <span className="form-check-label">
                Activo (se puede solicitar)
                {!conPlantilla && (
                  <span className="mz-faint"> · cargue antes la plantilla</span>
                )}
              </span>
            </label>
          </section>

          <section aria-labelledby="tp-campos">
            <h4 id="tp-campos" className="inicio-titulo">
              Formulario
            </h4>
            <p className="mz-faint mz-small">
              Además del nombre del proyecto y la plantilla llena, se piden
              estos campos, en este orden. Los obligatorios no dejan enviar la
              solicitud vacíos.
            </p>
            <EditorDeCampos
              campos={tipo.campos}
              onCambio={(campos) => setTipo((t) => ({ ...t, campos }))}
            />
          </section>

          <section aria-labelledby="tp-pasos">
            <h4 id="tp-pasos" className="inicio-titulo">
              Pasos para dar inicio al proyecto, en orden
            </h4>
            <p className="mz-faint mz-small">
              Cada paso lo decide cualquiera de los indicados; aprobado, pasa al
              siguiente. Aprobado el último, el proyecto se puede iniciar. Si
              alguien lo rechaza, no se inicia.
            </p>
            <ol className="flujo-pasos">
              {pasos.map((paso, i) => (
                <li key={paso.id ?? `paso-${i}`} className="flujo-paso">
                  <div className="flujo-paso__cabecera">
                    <span className="flujo-paso__numero">{i + 1}</span>
                    <input
                      aria-label={`Nombre del paso ${i + 1}`}
                      className="form-control form-control-sm"
                      required
                      maxLength={120}
                      value={paso.nombre}
                      onChange={(e) =>
                        cambiarPasos(
                          pasos.map((p, j) =>
                            j === i ? { ...p, nombre: e.target.value } : p,
                          ),
                        )
                      }
                    />
                    <Orden
                      nombre={`el paso ${i + 1}`}
                      i={i}
                      total={pasos.length}
                      minimo={1}
                      onMover={(delta) => cambiarPasos(mover(pasos, i, delta))}
                      onQuitar={() =>
                        cambiarPasos(pasos.filter((_, j) => j !== i))
                      }
                    />
                  </div>
                  <span className="mz-small mz-faint">
                    Lo decide cualquiera de:
                  </span>
                  <ListaDeDestinos
                    conector="o"
                    prefijo={`Quien decide el paso ${i + 1}`}
                    lista={paso.aprobadores}
                    tipos={DESTINOS_APROBADOR}
                    opciones={opciones}
                    vacio="Agregue al menos a alguien."
                    onCambio={(aprobadores) =>
                      cambiarPasos(
                        pasos.map((p, j) =>
                          j === i ? { ...p, aprobadores } : p,
                        ),
                      )
                    }
                  />
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={() =>
                cambiarPasos([
                  ...pasos,
                  {
                    nombre: `Paso ${pasos.length + 1}`,
                    aprobadores: [{ tipo: "persona" }],
                  },
                ])
              }
            >
              <Icon name="plus-lg" /> Agregar paso
            </button>
          </section>

          <div className="mz-actions justify-content-end">
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
              {guardando ? "Guardando…" : "Guardar tipo de proyecto"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Solicitud de proyectos → Tipos de proyecto (pide `proyectos.configurar`):
 * cada tipo con su plantilla, su formulario (campos obligatorios u
 * opcionales) y sus pasos con quién decide cada uno.
 */
export function TiposProyectoPage() {
  const [tipos, setTipos] = useState(null);
  const [opciones, setOpciones] = useState(null);
  const [editando, setEditando] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(
    () =>
      proyectosService
        .tiposConfigurados()
        .then(setTipos)
        .catch((err) =>
          setError(
            mensajeDeError(err, "No se pudieron cargar los tipos de proyecto."),
          ),
        ),
    [],
  );

  useEffect(() => {
    cargar();
    proyectosService
      .opciones()
      .then(setOpciones)
      .catch(() => null);
  }, [cargar]);

  async function guardar(datos, plantilla, activar) {
    const guardado = await proyectosService.guardarTipo(editando.id, datos);
    if (plantilla) {
      await proyectosService.cargarPlantilla(guardado.id, plantilla);
      if (activar && !datos.activo) {
        await proyectosService.activarTipo(guardado.id, true);
      }
    }
    setAviso(
      editando.id
        ? "Tipo de proyecto actualizado."
        : "Tipo de proyecto creado.",
    );
    setEditando(null);
    await cargar();
  }

  async function hacer(accion, exito) {
    setError(null);
    setAviso(null);
    try {
      await accion();
      setAviso(exito);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo completar."));
    }
  }

  async function descargar(tipo) {
    try {
      guardarArchivo(
        await proyectosService.plantillaConfigurada(tipo.id),
        tipo.plantilla_nombre,
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo descargar la plantilla."));
    }
  }

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Tipos de proyecto</h2>
          <p className="mz-desc">
            Los proyectos que se pueden solicitar: su plantilla, los datos que
            se piden y quién aprueba, autoriza y revisa antes de iniciarlos.
          </p>
        </div>
        <div className="mz-actions">
          <Link
            to="/admin/institucional/proyectos"
            className="btn btn-outline-secondary btn-sm"
          >
            <Icon name="arrow-left" /> Volver a las solicitudes
          </Link>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setEditando({ ...NUEVO })}
          >
            <Icon name="plus-lg" /> Nuevo tipo de proyecto
          </button>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check-circle" />
          {aviso}
        </div>
      )}

      <div className="flujos-lista">
        {(tipos ?? []).map((t) => (
          <section
            key={t.id}
            className={`flujo-tarjeta${t.activo ? "" : " flujo-tarjeta--inactivo"}`}
            aria-label={t.nombre}
          >
            <header className="flujo-tarjeta__cabecera">
              <div>
                <strong>{t.nombre}</strong>
                {!t.activo && <span className="mz-faint"> (inactivo)</span>}
                {t.descripcion && <small>{t.descripcion}</small>}
              </div>
              <span className="text-nowrap">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  aria-label={`Editar ${t.nombre}`}
                  onClick={() => setEditando(t)}
                >
                  <Icon name="pencil" />
                </button>{" "}
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  aria-label={`Borrar ${t.nombre}`}
                  onClick={() =>
                    hacer(
                      () => proyectosService.eliminarTipo(t.id),
                      `«${t.nombre}» se borró.`,
                    )
                  }
                >
                  <Icon name="trash" />
                </button>
              </span>
            </header>
            <div className="mz-small d-flex flex-wrap gap-2 align-items-center">
              {t.tiene_plantilla ? (
                <button
                  type="button"
                  className="btn btn-link btn-sm p-0"
                  onClick={() => descargar(t)}
                >
                  <Icon name="file-earmark-arrow-down" /> {t.plantilla_nombre}
                </button>
              ) : (
                <span className="mz-pill mz-pill--warn">Sin plantilla</span>
              )}
              <span className="mz-faint">
                · {t.campos.length} {t.campos.length === 1 ? "campo" : "campos"}{" "}
                ({t.campos.filter((c) => c.obligatorio).length} obligatorios) ·{" "}
                {t.solicitudes}{" "}
                {t.solicitudes === 1 ? "solicitud" : "solicitudes"}
              </span>
              {t.tiene_plantilla && (
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm ms-auto"
                  onClick={() =>
                    hacer(
                      () => proyectosService.activarTipo(t.id, !t.activo),
                      t.activo
                        ? `«${t.nombre}» ya no se puede solicitar.`
                        : `«${t.nombre}» ya se puede solicitar.`,
                    )
                  }
                >
                  {t.activo ? "Desactivar" : "Activar"}
                </button>
              )}
            </div>
            <ol className="flujo-tarjeta__pasos">
              {t.pasos.map((p) => (
                <li key={p.id}>
                  <strong>{p.nombre}</strong>
                  <span className="mz-faint mz-small">
                    {p.aprobadores.map((a) => a.descripcion).join(" o ")}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ))}
        {tipos?.length === 0 && (
          <p className="mz-faint">Todavía no hay tipos de proyecto.</p>
        )}
      </div>

      {editando && (
        <EditorTipo
          inicial={editando}
          opciones={opciones}
          onGuardado={guardar}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
}
