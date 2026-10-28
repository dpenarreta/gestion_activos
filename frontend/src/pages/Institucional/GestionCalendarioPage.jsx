import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { institucionalService } from "../../api/institucionalService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { FilaDeEstado } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
import { formatearFecha } from "../../utils/formato";
import { TIPOS_DE_EVENTO, iso } from "./CalendarioInicio";
import "./Institucional.css";
import { confirmar } from "../../components/common/Confirmar/confirmar";

/** Agregar o editar una fecha del calendario, en una ventana. */
function FormularioEvento({ inicial, onGuardar, onCerrar }) {
  const [valores, setValores] = useState(inicial);
  const [error, setError] = useState(null);
  // Errores junto a su campo y foco al primero (auditoría UX/UI, fase 2,
  // 28/10/2026).
  const [errores, setErrores] = useState({});
  const formulario = useRef(null);
  const [guardando, setGuardando] = useState(false);
  const editando = Boolean(inicial.id);
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const fijar = (campo) => (e) =>
    setValores((v) => {
      const valor =
        e.target.type === "checkbox" ? e.target.checked : e.target.value;
      const siguiente = { ...v, [campo]: valor };
      // Un cumpleaños se repite cada año: se propone al elegir el tipo.
      if (campo === "tipo" && valor === "cumpleanos")
        siguiente.cada_anio = true;
      return siguiente;
    });

  async function enviar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    setErrores({});
    try {
      await onGuardar({
        titulo: valores.titulo,
        tipo: valores.tipo,
        fecha: valores.fecha,
        fecha_fin: valores.fecha_fin || null,
        descripcion: valores.descripcion,
        cada_anio: valores.cada_anio,
      });
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar."));
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
        className="mz-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evento-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="evento-titulo">
            {editando ? "Editar fecha" : "Agregar al calendario"}
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
          className="mz-panel-body row g-2"
          onSubmit={enviar}
        >
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
            id="evento-titulo-campo"
            etiqueta="Título"
            obligatorio
            error={errores.titulo}
            className="col-12"
          >
            <input
              className="form-control form-control-sm"
              maxLength={150}
              placeholder="Cumpleaños de Rosa Vera"
              value={valores.titulo}
              onChange={fijar("titulo")}
            />
          </Campo>
          <Campo
            id="evento-tipo"
            etiqueta="Tipo"
            obligatorio
            error={errores.tipo}
            className="col-12"
          >
            <select
              className="form-select form-select-sm"
              value={valores.tipo}
              onChange={fijar("tipo")}
            >
              {Object.entries(TIPOS_DE_EVENTO).map(([id, t]) => (
                <option key={id} value={id}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo
            id="evento-fecha"
            etiqueta="Fecha"
            obligatorio
            error={errores.fecha}
            className="col-6"
          >
            <input
              type="date"
              className="form-control form-control-sm"
              value={valores.fecha}
              onChange={fijar("fecha")}
            />
          </Campo>
          <Campo
            id="evento-fin"
            etiqueta="Hasta (si dura varios días)"
            error={errores.fecha_fin}
            className="col-6"
          >
            <input
              type="date"
              min={valores.fecha || undefined}
              className="form-control form-control-sm"
              value={valores.fecha_fin ?? ""}
              onChange={fijar("fecha_fin")}
            />
          </Campo>
          <Campo
            id="evento-descripcion"
            etiqueta="Descripción (opcional)"
            error={errores.descripcion}
            className="col-12"
          >
            <input
              className="form-control form-control-sm"
              maxLength={300}
              value={valores.descripcion}
              onChange={fijar("descripcion")}
            />
          </Campo>
          <div className="col-12">
            <label className="form-check">
              <input
                type="checkbox"
                className="form-check-input"
                checked={valores.cada_anio}
                onChange={fijar("cada_anio")}
              />{" "}
              <span className="form-check-label">
                Se repite cada año (cumpleaños, aniversarios, feriados fijos)
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
              {guardando
                ? "Guardando…"
                : editando
                  ? "Guardar cambios"
                  : "Agregar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Institucional → Inicio → «Gestionar calendario» (pide
 * `calendario.gestionar`): los eventos importantes, cumpleaños y feriados
 * que se marcan en el calendario de Inicio.
 */
export function GestionCalendarioPage() {
  const [eventos, setEventos] = useState(null);
  const [error, setError] = useState(null);
  // El fallo al cargar va en la tabla, con «Reintentar» (auditoría UX/UI,
  // fase 2, 28/10/2026).
  const [errorCarga, setErrorCarga] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [editando, setEditando] = useState(null);

  const cargar = useCallback(() => {
    setErrorCarga(null);
    return institucionalService
      .eventos()
      .then(setEventos)
      .catch((err) =>
        setErrorCarga(mensajeDeError(err, "No se pudo cargar el calendario.")),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardar(datos) {
    await institucionalService.guardarEvento(editando.id, datos);
    setAviso(editando.id ? "Fecha actualizada." : "Fecha agregada.");
    setEditando(null);
    await cargar();
  }

  async function borrar(evento) {
    if (
      !(await confirmar({
        titulo: `¿Quitar «${evento.titulo}» del calendario?`,
        accion: "Quitar",
      }))
    )
      return;
    setError(null);
    setAviso(null);
    try {
      await institucionalService.eliminarEvento(evento.id);
      setAviso(`«${evento.titulo}» se quitó del calendario.`);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo borrar."));
    }
  }

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Gestionar calendario</h2>
          <p className="mz-desc">
            Los eventos importantes, cumpleaños y feriados que se marcan en el
            calendario de Inicio.
          </p>
        </div>
        <div className="mz-actions">
          <Link
            to="/admin/institucional/inicio"
            className="btn btn-outline-secondary btn-sm"
          >
            <Icon name="arrow-left" /> Volver al inicio
          </Link>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() =>
              setEditando({
                titulo: "",
                tipo: "evento",
                fecha: iso(new Date()),
                fecha_fin: "",
                descripcion: "",
                cada_anio: false,
              })
            }
          >
            <Icon name="plus-lg" /> Agregar fecha
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

      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Título</th>
              <th>Tipo</th>
              <th>Se repite</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {(eventos ?? []).map((e) => (
              <tr key={e.id}>
                <td className="text-nowrap">
                  {formatearFecha(e.fecha)}
                  {e.fecha_fin && ` al ${formatearFecha(e.fecha_fin)}`}
                </td>
                <td>
                  {e.titulo}
                  {e.descripcion && (
                    <span className="d-block mz-small mz-faint">
                      {e.descripcion}
                    </span>
                  )}
                </td>
                <td>
                  <span
                    className={`calendario__icono calendario__icono--${e.tipo} me-1`}
                  >
                    <Icon
                      name={TIPOS_DE_EVENTO[e.tipo]?.icono ?? "star-fill"}
                    />
                  </span>
                  {TIPOS_DE_EVENTO[e.tipo]?.nombre ?? e.tipo}
                </td>
                <td>{e.cada_anio ? "Cada año" : "—"}</td>
                <td className="num text-nowrap">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    aria-label={`Editar ${e.titulo}`}
                    onClick={() =>
                      setEditando({ ...e, fecha_fin: e.fecha_fin ?? "" })
                    }
                  >
                    <Icon name="pencil" />
                  </button>{" "}
                  <button
                    type="button"
                    className="btn btn-outline-danger btn-sm"
                    aria-label={`Borrar ${e.titulo}`}
                    onClick={() => borrar(e)}
                  >
                    <Icon name="trash" />
                  </button>
                </td>
              </tr>
            ))}
            <FilaDeEstado
              columnas={5}
              cargando={eventos === null}
              error={errorCarga}
              onReintentar={cargar}
              vacio={eventos?.length === 0}
              textoVacio="Todavía no hay fechas en el calendario."
            />
          </tbody>
        </table>
      </div>

      {editando && (
        <FormularioEvento
          inicial={editando}
          onGuardar={guardar}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
}
