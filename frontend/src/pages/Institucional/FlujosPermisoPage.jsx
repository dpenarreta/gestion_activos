import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { licenciasService } from "../../api/licenciasService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import {
  DESTINOS_APROBADOR,
  DESTINOS_AVISO,
  SelectorDestino,
} from "./licenciasComunes";
import "./Institucional.css";

const ADJUNTOS = [
  ["no", "No se pide documento"],
  ["opcional", "Documento opcional"],
  ["obligatorio", "Documento obligatorio"],
];

const NUEVO = {
  nombre: "",
  descripcion: "",
  activo: true,
  adjunto: "no",
  orden: 0,
  pasos: [{ nombre: "Jefatura", aprobadores: [{ tipo: "jefe_inmediato" }] }],
  avisos_aprobada: [{ tipo: "solicitante" }],
  avisos_rechazada: [{ tipo: "solicitante" }],
};

/** Una lista de destinos (aprobadores de un paso o avisos), con agregar y
 * quitar. */
function ListaDeDestinos({ prefijo, lista, tipos, opciones, onCambio, vacio }) {
  return (
    <div className="flujo-destinos">
      {lista.map((destino, i) => (
        <div key={`${prefijo}-${i}`} className="flujo-destinos__fila">
          {i > 0 && <span className="flujo-destinos__o">o</span>}
          <SelectorDestino
            id={`${prefijo}-${i}`}
            etiqueta={`${prefijo} ${i + 1}`}
            valor={destino}
            onCambio={(nuevo) =>
              onCambio(lista.map((d, j) => (j === i ? nuevo : d)))
            }
            opciones={opciones}
            tipos={tipos}
          />
          <button
            type="button"
            className="btn btn-outline-danger btn-sm"
            aria-label={`Quitar ${prefijo} ${i + 1}`}
            onClick={() => onCambio(lista.filter((_, j) => j !== i))}
          >
            <Icon name="x-lg" />
          </button>
        </div>
      ))}
      {lista.length === 0 && <p className="mz-faint mz-small mb-1">{vacio}</p>}
      <button
        type="button"
        className="btn btn-link btn-sm px-0"
        onClick={() => onCambio([...lista, { tipo: tipos[0] }])}
      >
        <Icon name="plus" /> Agregar
      </button>
    </div>
  );
}

/** Crear o editar un flujo: datos, pasos en orden y avisos al terminar. */
function EditorFlujo({ inicial, opciones, onGuardado, onCerrar }) {
  const [flujo, setFlujo] = useState(inicial);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const fijar = (campo) => (e) =>
    setFlujo((f) => ({
      ...f,
      [campo]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));
  const pasos = flujo.pasos;
  const cambiarPasos = (nuevos) => setFlujo((f) => ({ ...f, pasos: nuevos }));

  function mover(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= pasos.length) return;
    const nuevos = [...pasos];
    [nuevos[i], nuevos[j]] = [nuevos[j], nuevos[i]];
    cambiarPasos(nuevos);
  }

  async function guardar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    const limpiar = (lista) =>
      lista.map(({ tipo, usuario, rol, cargo }) => ({
        tipo,
        usuario: usuario ?? null,
        rol: rol ?? null,
        cargo: cargo ?? null,
      }));
    try {
      await onGuardado({
        nombre: flujo.nombre,
        descripcion: flujo.descripcion,
        activo: flujo.activo,
        adjunto: flujo.adjunto,
        orden: Number(flujo.orden) || 0,
        pasos: pasos.map((p) => ({
          nombre: p.nombre,
          aprobadores: limpiar(p.aprobadores),
        })),
        avisos_aprobada: limpiar(flujo.avisos_aprobada),
        avisos_rechazada: limpiar(flujo.avisos_rechazada),
      });
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el flujo."));
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
          inicial.id ? `Editar ${inicial.nombre}` : "Nuevo tipo de permiso"
        }
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>
            {inicial.id
              ? `Editar «${inicial.nombre}»`
              : "Nuevo tipo de permiso"}
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
            <div className="col-12 col-md-6">
              <label className="form-label mz-small" htmlFor="flujo-nombre">
                Nombre del permiso
              </label>
              <input
                id="flujo-nombre"
                className="form-control form-control-sm"
                required
                maxLength={120}
                placeholder="Vacaciones"
                value={flujo.nombre}
                onChange={fijar("nombre")}
              />
            </div>
            <div className="col-12 col-md-6">
              <label className="form-label mz-small" htmlFor="flujo-adjunto">
                Documento de respaldo
              </label>
              <select
                id="flujo-adjunto"
                className="form-select form-select-sm"
                value={flujo.adjunto}
                onChange={fijar("adjunto")}
              >
                {ADJUNTOS.map(([id, nombre]) => (
                  <option key={id} value={id}>
                    {nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12">
              <label
                className="form-label mz-small"
                htmlFor="flujo-descripcion"
              >
                Descripción (la ve quien solicita)
              </label>
              <input
                id="flujo-descripcion"
                className="form-control form-control-sm"
                value={flujo.descripcion}
                onChange={fijar("descripcion")}
              />
            </div>
            <div className="col-12">
              <label className="form-check">
                <input
                  type="checkbox"
                  className="form-check-input"
                  checked={flujo.activo}
                  onChange={fijar("activo")}
                />{" "}
                <span className="form-check-label">
                  Activo (se puede solicitar)
                </span>
              </label>
            </div>
          </div>

          <section aria-labelledby="flujo-pasos">
            <h4 id="flujo-pasos" className="inicio-titulo">
              Pasos de aprobación, en orden
            </h4>
            <p className="mz-faint mz-small">
              Cada paso lo aprueba cualquiera de sus aprobadores; aprobado, pasa
              al siguiente. Si alguno lo rechaza, la solicitud termina.
            </p>
            <ol className="flujo-pasos">
              {pasos.map((paso, i) => (
                <li key={`paso-${i}`} className="flujo-paso">
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
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      aria-label={`Subir el paso ${i + 1}`}
                      disabled={i === 0}
                      onClick={() => mover(i, -1)}
                    >
                      <Icon name="arrow-up" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      aria-label={`Bajar el paso ${i + 1}`}
                      disabled={i === pasos.length - 1}
                      onClick={() => mover(i, 1)}
                    >
                      <Icon name="arrow-down" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      aria-label={`Quitar el paso ${i + 1}`}
                      disabled={pasos.length === 1}
                      onClick={() =>
                        cambiarPasos(pasos.filter((_, j) => j !== i))
                      }
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                  <span className="mz-small mz-faint">Lo aprueba:</span>
                  <ListaDeDestinos
                    prefijo={`Aprobador del paso ${i + 1}`}
                    lista={paso.aprobadores}
                    tipos={DESTINOS_APROBADOR}
                    opciones={opciones}
                    vacio="Agregue al menos un aprobador."
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

          <section aria-labelledby="flujo-avisos">
            <h4 id="flujo-avisos" className="inicio-titulo">
              A quién se avisa el resultado
            </h4>
            <div className="row g-3">
              <div className="col-12 col-lg-6">
                <strong className="mz-small text-success">
                  <Icon name="check-circle" /> Si se aprueba
                </strong>
                <ListaDeDestinos
                  prefijo="Aviso si se aprueba"
                  lista={flujo.avisos_aprobada}
                  tipos={DESTINOS_AVISO}
                  opciones={opciones}
                  vacio="Nadie recibe aviso."
                  onCambio={(avisos) =>
                    setFlujo((f) => ({ ...f, avisos_aprobada: avisos }))
                  }
                />
              </div>
              <div className="col-12 col-lg-6">
                <strong className="mz-small text-danger">
                  <Icon name="x-circle" /> Si se rechaza
                </strong>
                <ListaDeDestinos
                  prefijo="Aviso si se rechaza"
                  lista={flujo.avisos_rechazada}
                  tipos={DESTINOS_AVISO}
                  opciones={opciones}
                  vacio="Nadie recibe aviso."
                  onCambio={(avisos) =>
                    setFlujo((f) => ({ ...f, avisos_rechazada: avisos }))
                  }
                />
              </div>
            </div>
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
              {guardando ? "Guardando…" : "Guardar flujo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Solicitud de permisos → Configurar flujos (pide `licencias.configurar`):
 * los tipos de permiso, cada uno con sus pasos de aprobación (quién aprueba
 * cada uno) y a quién se avisa el resultado según se apruebe o se rechace.
 */
export function FlujosPermisoPage() {
  const [flujos, setFlujos] = useState(null);
  const [opciones, setOpciones] = useState(null);
  const [editando, setEditando] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(
    () =>
      licenciasService
        .flujos()
        .then(setFlujos)
        .catch((err) =>
          setError(mensajeDeError(err, "No se pudieron cargar los flujos.")),
        ),
    [],
  );

  useEffect(() => {
    cargar();
    licenciasService
      .opciones()
      .then(setOpciones)
      .catch(() => null);
  }, [cargar]);

  async function guardar(datos) {
    await licenciasService.guardarFlujo(editando.id, datos);
    setAviso(editando.id ? "Flujo actualizado." : "Tipo de permiso creado.");
    setEditando(null);
    await cargar();
  }

  async function borrar(flujo) {
    setError(null);
    setAviso(null);
    try {
      await licenciasService.eliminarFlujo(flujo.id);
      setAviso(`«${flujo.nombre}» se borró.`);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo borrar."));
    }
  }

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Flujos de permisos</h2>
          <p className="mz-desc">
            Los tipos de permiso que se pueden solicitar, cómo se escala su
            aprobación y a quién se avisa el resultado.
          </p>
        </div>
        <div className="mz-actions">
          <Link
            to="/admin/institucional/permisos"
            className="btn btn-outline-secondary btn-sm"
          >
            <Icon name="arrow-left" /> Volver a las solicitudes
          </Link>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setEditando({ ...NUEVO })}
          >
            <Icon name="plus-lg" /> Nuevo tipo de permiso
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
        {(flujos ?? []).map((f) => (
          <section
            key={f.id}
            className={`flujo-tarjeta${f.activo ? "" : " flujo-tarjeta--inactivo"}`}
            aria-label={f.nombre}
          >
            <header className="flujo-tarjeta__cabecera">
              <div>
                <strong>{f.nombre}</strong>
                {!f.activo && <span className="mz-faint"> (inactivo)</span>}
                {f.descripcion && <small>{f.descripcion}</small>}
              </div>
              <span className="text-nowrap">
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  aria-label={`Editar ${f.nombre}`}
                  onClick={() => setEditando(f)}
                >
                  <Icon name="pencil" />
                </button>{" "}
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  aria-label={`Borrar ${f.nombre}`}
                  onClick={() => borrar(f)}
                >
                  <Icon name="trash" />
                </button>
              </span>
            </header>
            <ol className="flujo-tarjeta__pasos">
              {f.pasos.map((p) => (
                <li key={p.id}>
                  <strong>{p.nombre}</strong>
                  <span className="mz-faint mz-small">
                    {p.aprobadores.map((a) => a.descripcion).join(" o ")}
                  </span>
                </li>
              ))}
            </ol>
            <div className="flujo-tarjeta__avisos mz-small">
              <span>
                <Icon name="check-circle" className="text-success" /> Aprobada:{" "}
                {f.avisos_aprobada.map((a) => a.descripcion).join(", ") ||
                  "nadie"}
              </span>
              <span>
                <Icon name="x-circle" className="text-danger" /> Rechazada:{" "}
                {f.avisos_rechazada.map((a) => a.descripcion).join(", ") ||
                  "nadie"}
              </span>
            </div>
          </section>
        ))}
        {flujos?.length === 0 && (
          <p className="mz-faint">Todavía no hay tipos de permiso.</p>
        )}
      </div>

      {editando && (
        <EditorFlujo
          inicial={editando}
          opciones={opciones}
          onGuardado={guardar}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
}
