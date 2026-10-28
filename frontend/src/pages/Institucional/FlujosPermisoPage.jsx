import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { licenciasService } from "../../api/licenciasService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
import {
  DESTINOS_APROBADOR,
  DESTINOS_AVISO,
  SelectorDestino,
} from "./licenciasComunes";
import "./Institucional.css";
import { confirmar } from "../../components/common/Confirmar/confirmar";

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
  dias_minimos: 0,
  dias_maximos: 0,
  descuenta_vacaciones: false,
  sabados_por_periodo: 0,
  domingos_por_periodo: 0,
  restricciones: "",
  pide_motivo: true,
  pasos: [{ nombre: "Jefatura", aprobadores: [{ tipo: "jefe_inmediato" }] }],
  avisos_aprobada: [{ tipo: "solicitante" }],
  avisos_rechazada: [{ tipo: "solicitante" }],
};

/** Una lista de destinos (aprobadores de un paso o avisos), con agregar y
 * quitar. */
export function ListaDeDestinos({
  prefijo,
  lista,
  tipos,
  opciones,
  onCambio,
  vacio,
  conector,
}) {
  return (
    <div className="flujo-destinos">
      {lista.map((destino, i) => (
        <div key={`${prefijo}-${i}`} className="flujo-destinos__fila">
          {/* «o» entre aprobadores (aprueba cualquiera); los avisos no llevan
              conector: los reciben todos. */}
          {conector && (
            <span className="flujo-destinos__conector" aria-hidden="true">
              {i > 0 ? conector : ""}
            </span>
          )}
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
        className="btn btn-link btn-sm px-0 flujo-destinos__agregar"
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
  // Errores de los campos de arriba junto a cada uno, y foco al primero
  // (auditoría UX/UI, fase 2, 28/10/2026). Los de los pasos y avisos siguen
  // en el aviso general.
  const [errores, setErrores] = useState({});
  const formulario = useRef(null);
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
    setErrores({});
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
        dias_minimos: Number(flujo.dias_minimos) || 0,
        dias_maximos: Number(flujo.dias_maximos) || 0,
        descuenta_vacaciones: Boolean(flujo.descuenta_vacaciones),
        sabados_por_periodo: flujo.descuenta_vacaciones
          ? Number(flujo.sabados_por_periodo) || 0
          : 0,
        domingos_por_periodo: flujo.descuenta_vacaciones
          ? Number(flujo.domingos_por_periodo) || 0
          : 0,
        restricciones: flujo.restricciones ?? "",
        pide_motivo: flujo.pide_motivo !== false,
        pasos: pasos.map((p) => ({
          nombre: p.nombre,
          aprobadores: limpiar(p.aprobadores),
        })),
        avisos_aprobada: limpiar(flujo.avisos_aprobada),
        avisos_rechazada: limpiar(flujo.avisos_rechazada),
      });
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el flujo."));
      setErrores(erroresPorCampo(err));
      setGuardando(false);
      enfocarPrimerError(formulario.current);
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
        <form
          ref={formulario}
          className="mz-panel-body mz-stack"
          onSubmit={guardar}
        >
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          <LeyendaObligatorios />
          <div className="row g-2">
            <Campo
              id="flujo-nombre"
              etiqueta="Nombre del permiso"
              obligatorio
              error={errores.nombre}
              className="col-12 col-md-6"
            >
              <input
                className="form-control form-control-sm"
                maxLength={120}
                placeholder="Vacaciones"
                value={flujo.nombre}
                onChange={fijar("nombre")}
              />
            </Campo>
            <Campo
              id="flujo-adjunto"
              etiqueta="Documento de respaldo"
              error={errores.adjunto}
              className="col-12 col-md-6"
            >
              <select
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
            </Campo>
            <Campo
              id="flujo-descripcion"
              etiqueta="Descripción (la ve quien solicita)"
              error={errores.descripcion}
              className="col-12"
            >
              <input
                className="form-control form-control-sm"
                value={flujo.descripcion}
                onChange={fijar("descripcion")}
              />
            </Campo>
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
              <label className="form-check">
                <input
                  type="checkbox"
                  className="form-check-input"
                  checked={flujo.pide_motivo !== false}
                  onChange={fijar("pide_motivo")}
                />{" "}
                <span className="form-check-label">
                  Pide un motivo a quien solicita
                </span>
              </label>
            </div>
          </div>

          <section aria-labelledby="flujo-restricciones">
            <h4 id="flujo-restricciones" className="inicio-titulo">
              Restricciones
            </h4>
            <p className="mz-faint mz-small">
              Quien solicita las ve al elegir las fechas, con si las cumple. Los
              mínimos y máximos no dejan enviar la solicitud; 0 es sin
              restricción.
            </p>
            <div className="row g-2">
              <Campo
                id="flujo-minimo"
                etiqueta="Mínimo de días seguidos"
                error={errores.dias_minimos}
                className="col-6 col-md-3"
              >
                <input
                  type="number"
                  min={0}
                  className="form-control form-control-sm"
                  value={flujo.dias_minimos ?? 0}
                  onChange={fijar("dias_minimos")}
                />
              </Campo>
              <Campo
                id="flujo-maximo"
                etiqueta="Máximo de días seguidos"
                error={errores.dias_maximos}
                className="col-6 col-md-3"
              >
                <input
                  type="number"
                  min={0}
                  className="form-control form-control-sm"
                  value={flujo.dias_maximos ?? 0}
                  onChange={fijar("dias_maximos")}
                />
              </Campo>
              <div className="col-12 col-md-6 d-flex align-items-end">
                <label className="form-check mb-1">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={Boolean(flujo.descuenta_vacaciones)}
                    onChange={fijar("descuenta_vacaciones")}
                  />{" "}
                  <span className="form-check-label">
                    Se descuenta de las vacaciones pendientes
                  </span>
                </label>
              </div>
              {flujo.descuenta_vacaciones && (
                <>
                  <div className="col-6 col-md-3">
                    <label
                      className="form-label mz-small"
                      htmlFor="flujo-sabados"
                    >
                      Sábados por período
                    </label>
                    <input
                      id="flujo-sabados"
                      type="number"
                      min={0}
                      className="form-control form-control-sm"
                      value={flujo.sabados_por_periodo ?? 0}
                      onChange={fijar("sabados_por_periodo")}
                    />
                  </div>
                  <div className="col-6 col-md-3">
                    <label
                      className="form-label mz-small"
                      htmlFor="flujo-domingos"
                    >
                      Domingos por período
                    </label>
                    <input
                      id="flujo-domingos"
                      type="number"
                      min={0}
                      className="form-control form-control-sm"
                      value={flujo.domingos_por_periodo ?? 0}
                      onChange={fijar("domingos_por_periodo")}
                    />
                  </div>
                  <p className="col-12 col-md-6 mz-faint mz-small mb-0 align-self-end">
                    De cada período anual deben salir al menos esos sábados y
                    domingos. Si al completarse el período faltan, se marcan por
                    defecto los siguientes a la solicitud.
                  </p>
                </>
              )}
              <div className="col-12">
                <label
                  className="form-label mz-small"
                  htmlFor="flujo-indicaciones"
                >
                  Otras indicaciones (una por línea; solo se informan)
                </label>
                <textarea
                  id="flujo-indicaciones"
                  rows={2}
                  className="form-control form-control-sm"
                  placeholder="Pídalas con 15 días de anticipación."
                  value={flujo.restricciones ?? ""}
                  onChange={fijar("restricciones")}
                />
              </div>
            </div>
          </section>

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
                  <span className="mz-small mz-faint">
                    Lo aprueba cualquiera de:
                  </span>
                  <ListaDeDestinos
                    conector="o"
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
            <p className="mz-faint mz-small">
              Al terminar la solicitud, reciben el aviso en la campana{" "}
              <strong>todos</strong> los de la lista que corresponda.
            </p>
            <div className="flujo-avisos">
              <div className="flujo-avisos__caja flujo-avisos__caja--aprobada">
                <strong className="flujo-avisos__titulo">
                  <Icon name="check-circle" /> Si se aprueba, se avisa a:
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
              <div className="flujo-avisos__caja flujo-avisos__caja--rechazada">
                <strong className="flujo-avisos__titulo">
                  <Icon name="x-circle" /> Si se rechaza, se avisa a:
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
  // El fallo al cargar va junto a la lista, con «Reintentar» (auditoría
  // UX/UI, fase 2, 28/10/2026).
  const [errorCarga, setErrorCarga] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(() => {
    setErrorCarga(null);
    return licenciasService
      .flujos()
      .then(setFlujos)
      .catch((err) =>
        setErrorCarga(mensajeDeError(err, "No se pudieron cargar los flujos.")),
      );
  }, []);

  useEffect(() => {
    cargar();
    licenciasService
      .opciones()
      .then(setOpciones)
      // Sin las opciones no se pueden elegir aprobadores: se avisa en vez de
      // dejar los selectores vacíos.
      .catch((err) =>
        setError(
          mensajeDeError(
            err,
            "No se pudieron cargar las personas, roles y cargos para elegir aprobadores.",
          ),
        ),
      );
  }, [cargar]);

  async function guardar(datos) {
    await licenciasService.guardarFlujo(editando.id, datos);
    setAviso(editando.id ? "Flujo actualizado." : "Tipo de permiso creado.");
    setEditando(null);
    await cargar();
  }

  async function borrar(flujo) {
    if (
      !(await confirmar({
        titulo: `¿Borrar el tipo de permiso «${flujo.nombre}»?`,
        accion: "Borrar",
      }))
    )
      return;
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

      <EstadoDeCarga
        cargando={flujos === null}
        error={errorCarga}
        onReintentar={cargar}
        vacio={flujos?.length === 0}
        textoVacio="Todavía no hay tipos de permiso."
      />
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
