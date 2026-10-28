import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ordenesService } from "../../api/ordenesService";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import {
  CumplimientoOrden,
  EstadoOrden,
  PrioridadOrden,
  moneda,
} from "./comunes";
import "./Ordenes.css";

/**
 * Cómo se llama cada paso según desde dónde se da. «En ejecución» es
 * «Iniciar» la primera vez, «Reanudar» tras una pausa y «Devolver» cuando
 * quien acepta encuentra el trabajo incompleto.
 */
function textoDelPaso(destino, actual) {
  if (destino === "en_ejecucion") {
    if (actual === "pausada") return "Reanudar";
    if (actual === "pendiente_aprobacion") return "Devolver a ejecución";
    return "Iniciar ejecución";
  }
  return {
    programada: "Programar",
    pausada: "Pausar",
    pendiente_aprobacion: "Enviar a aprobación",
    cerrada: "Aceptar y cerrar",
  }[destino];
}

export function OrdenDetalle() {
  const { id } = useParams();
  const [orden, setOrden] = useState(null);
  const [catalogos, setCatalogos] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const cargar = useCallback(() => {
    setError(null);
    ordenesService
      .get(id)
      .then(setOrden)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar la orden.")),
      );
  }, [id]);

  useEffect(() => {
    cargar();
    ordenesService
      .catalogos()
      .then(setCatalogos)
      .catch(() => setCatalogos(null));
  }, [cargar]);

  /** Ejecuta una acción y deja la ficha con lo que devolvió el servidor. */
  async function hacer(accion, mensaje) {
    setIsSaving(true);
    setError(null);
    setAviso(null);
    try {
      setOrden(await accion());
      setAviso(mensaje);
      return true;
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo completar la acción."));
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  // Mientras carga o si falla, con su cabecera, la salida al listado y un
  // reintento: antes quedaba solo el aviso (revisión final UX/UI,
  // 28/10/2026).
  if (!orden) {
    return (
      <div className="ordenes-page">
        <div className="mz-view-head">
          <div>
            <h2>Orden de trabajo</h2>
          </div>
          <div className="mz-view-actions">
            <Link
              className="btn btn-outline-secondary btn-sm"
              to="/admin/ordenes/lista"
            >
              Volver al listado
            </Link>
          </div>
        </div>
        <EstadoDeCarga cargando error={error} onReintentar={cargar} />
      </div>
    );
  }

  const { permisos, costos } = orden;

  return (
    <div className="ordenes-page">
      <div className="mz-view-head">
        <div>
          <h2>
            {orden.numero} <EstadoOrden orden={orden} />
          </h2>
          <p className="mz-desc">{orden.titulo}</p>
        </div>
        <div className="mz-view-actions">
          <Link
            className="btn btn-outline-secondary btn-sm"
            to="/admin/ordenes/lista"
          >
            Volver al listado
          </Link>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="check2-circle" />
          {aviso}
        </div>
      )}

      <div className="mz-grid-2">
        <div className="mz-stack">
          <DatosDeLaOrden
            orden={orden}
            catalogos={catalogos}
            isSaving={isSaving}
            onGuardar={(cambios) =>
              hacer(
                () => ordenesService.update(orden.id, cambios),
                "Datos corregidos.",
              )
            }
          />
          {permisos.asignar && catalogos?.tecnicos && (
            <Asignacion
              orden={orden}
              catalogos={catalogos}
              isSaving={isSaving}
              onAsignar={(datos) =>
                hacer(
                  () => ordenesService.asignar(orden.id, datos),
                  "Orden asignada.",
                )
              }
            />
          )}
          {permisos.acciones.length > 0 && (
            <Pasos
              orden={orden}
              isSaving={isSaving}
              onPaso={(estado, extra) =>
                hacer(
                  () => ordenesService.cambiarEstado(orden.id, estado, extra),
                  "Estado actualizado.",
                )
              }
            />
          )}
          <Costos
            orden={orden}
            costos={costos}
            isSaving={isSaving}
            onAgregar={(tipo, datos) =>
              hacer(
                () =>
                  tipo === "materiales"
                    ? ordenesService.registrarMaterial(orden.id, datos)
                    : ordenesService.registrarManoDeObra(orden.id, datos),
                "Costo registrado.",
              )
            }
            onQuitar={(tipo, filaId) =>
              hacer(
                () => ordenesService.quitarCosto(orden.id, tipo, filaId),
                "Costo quitado.",
              )
            }
          />
        </div>

        <section className="mz-card">
          <div className="mz-card-head">
            <h3>Recorrido</h3>
          </div>
          <div className="mz-card-body">
            <ul className="mz-timeline ordenes-recorrido">
              {orden.movimientos.map((movimiento) => (
                <li key={movimiento.id} className="mz-tl-item">
                  <strong className="mz-tl-what">
                    {movimiento.descripcion}
                  </strong>
                  <div className="mz-tl-when">
                    {formatearFecha(movimiento.created_at, true)} ·{" "}
                    {movimiento.actor}
                  </div>
                  {movimiento.nota && (
                    <div className="mz-tl-why nota">{movimiento.nota}</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

function DatosDeLaOrden({ orden, catalogos, isSaving, onGuardar }) {
  const [editando, setEditando] = useState(false);
  const [valores, setValores] = useState({});

  function empezar() {
    setValores({
      titulo: orden.titulo,
      descripcion: orden.descripcion,
      categoria: orden.categoria,
      prioridad: orden.prioridad,
      ...(orden.telefono_contacto_editable !== null
        ? { telefono_contacto: orden.telefono_contacto_editable }
        : {}),
    });
    setEditando(true);
  }

  async function guardar(evento) {
    evento.preventDefault();
    if (await onGuardar(valores)) setEditando(false);
  }

  const fijar = (campo) => (evento) =>
    setValores((actual) => ({ ...actual, [campo]: evento.target.value }));

  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Datos de la orden</h3>
        {orden.permisos.editar && !editando && (
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={empezar}
          >
            Corregir
          </button>
        )}
      </div>
      <div className="mz-card-body">
        {editando ? (
          <form onSubmit={guardar} className="row g-3">
            <div className="col-12">
              <label className="form-label" htmlFor="od-titulo">
                Qué hay que hacer
              </label>
              <input
                id="od-titulo"
                className="form-control"
                required
                maxLength={150}
                value={valores.titulo}
                onChange={fijar("titulo")}
              />
            </div>
            <div className="col-6">
              <label className="form-label" htmlFor="od-categoria">
                Categoría
              </label>
              <select
                id="od-categoria"
                className="form-select"
                value={valores.categoria}
                onChange={fijar("categoria")}
              >
                {(catalogos?.categorias ?? []).map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-6">
              <label className="form-label" htmlFor="od-prioridad">
                Prioridad
              </label>
              <select
                id="od-prioridad"
                className="form-select"
                value={valores.prioridad}
                onChange={fijar("prioridad")}
              >
                {(catalogos?.prioridades ?? []).map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12">
              <label className="form-label" htmlFor="od-descripcion">
                Descripción
              </label>
              <textarea
                id="od-descripcion"
                className="form-control"
                rows={3}
                value={valores.descripcion}
                onChange={fijar("descripcion")}
              />
            </div>
            {"telefono_contacto" in valores && (
              <div className="col-12 col-md-6">
                <label className="form-label" htmlFor="od-telefono">
                  Teléfono de contacto
                </label>
                <input
                  id="od-telefono"
                  className="form-control"
                  inputMode="tel"
                  value={valores.telefono_contacto}
                  onChange={fijar("telefono_contacto")}
                />
              </div>
            )}
            <div className="col-12 mz-actions justify-content-end">
              <button
                type="button"
                className="btn btn-cancelar"
                onClick={() => setEditando(false)}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSaving}
              >
                Guardar
              </button>
            </div>
          </form>
        ) : (
          <div className="mz-kv-grid">
            <Dato etiqueta="Sede">
              {orden.sede.nombre}
              {orden.sede.ciudad && ` · ${orden.sede.ciudad}`}
            </Dato>
            <Dato etiqueta="Región">
              {[orden.sede.region_display, orden.sede.provincia]
                .filter(Boolean)
                .join(" · ") || "—"}
            </Dato>
            <Dato etiqueta="Categoría">{orden.categoria_display}</Dato>
            <Dato etiqueta="Prioridad">
              <PrioridadOrden orden={orden} />
            </Dato>
            <Dato etiqueta="Solicitada por">{orden.solicitante.nombre}</Dato>
            <Dato etiqueta="Contacto">
              <span className="mz-mono">{orden.contacto || "—"}</span>
            </Dato>
            <Dato etiqueta="Responsable">{orden.responsable}</Dato>
            <Dato etiqueta="Programada">
              {orden.fecha_programada
                ? formatearFecha(orden.fecha_programada)
                : "Sin fecha"}
            </Dato>
            <Dato etiqueta="Cumplimiento">
              <CumplimientoOrden orden={orden} />
            </Dato>
            <Dato etiqueta="Registrada">
              {formatearFecha(orden.created_at, true)}
            </Dato>
            {orden.descripcion && (
              <Dato etiqueta="Descripción" completo>
                {orden.descripcion}
              </Dato>
            )}
            {orden.estado === "cerrada" && (
              <Dato etiqueta="Cierre" completo>
                {formatearFecha(orden.fecha_cierre, true)}
                {orden.con_observaciones
                  ? ` · con observaciones: ${orden.observaciones_cierre}`
                  : " · aceptada sin observaciones"}
              </Dato>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Dato({ etiqueta, completo = false, children }) {
  return (
    <div className={`mz-kv${completo ? " mz-kv--full" : ""}`}>
      <span className="mz-kv-label">{etiqueta}</span>
      {children}
    </div>
  );
}

function Asignacion({ orden, catalogos, isSaving, onAsignar }) {
  const [valores, setValores] = useState({
    tecnico: orden.tecnico?.id ?? "",
    proveedor: orden.proveedor?.id ?? "",
    fecha_programada: orden.fecha_programada ?? "",
    nota: "",
  });
  const fijar = (campo) => (evento) =>
    setValores((actual) => ({ ...actual, [campo]: evento.target.value }));

  function asignar(evento) {
    evento.preventDefault();
    onAsignar({
      tecnico: valores.tecnico,
      proveedor: valores.proveedor || null,
      fecha_programada: valores.fecha_programada || null,
      nota: valores.nota,
    });
  }

  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>{orden.tecnico ? "Reasignar" : "Asignar"}</h3>
      </div>
      <form onSubmit={asignar} className="mz-card-body row g-3">
        <div className="col-12 col-md-6">
          <label className="form-label" htmlFor="oa-tecnico">
            Técnico
          </label>
          <select
            id="oa-tecnico"
            className="form-select"
            required
            value={valores.tecnico}
            onChange={fijar("tecnico")}
          >
            <option value="">Elija quién ejecuta</option>
            {catalogos.tecnicos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
          {catalogos.tecnicos.length === 0 && (
            <div className="form-text">
              Nadie tiene todavía el permiso «Ejecutar las órdenes asignadas» en
              esta empresa: asígneselo a un rol en Configuración → Roles.
            </div>
          )}
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label" htmlFor="oa-proveedor">
            Proveedor (si es externo)
          </label>
          <select
            id="oa-proveedor"
            className="form-select"
            value={valores.proveedor}
            onChange={fijar("proveedor")}
          >
            <option value="">Personal interno</option>
            {(catalogos.proveedores ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label" htmlFor="oa-fecha">
            Fecha programada
          </label>
          <input
            id="oa-fecha"
            type="date"
            className="form-control"
            value={valores.fecha_programada}
            onChange={fijar("fecha_programada")}
          />
        </div>
        <div className="col-12 col-md-6">
          <label className="form-label" htmlFor="oa-nota">
            Nota (opcional)
          </label>
          <input
            id="oa-nota"
            className="form-control"
            value={valores.nota}
            onChange={fijar("nota")}
          />
        </div>
        <div className="col-12 mz-actions justify-content-end">
          <button type="submit" className="btn btn-primary" disabled={isSaving}>
            {orden.tecnico ? "Reasignar" : "Asignar"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Pasos({ orden, isSaving, onPaso }) {
  const [nota, setNota] = useState("");
  const [fecha, setFecha] = useState(orden.fecha_programada ?? "");
  const [conObservaciones, setConObservaciones] = useState(false);
  const acciones = orden.permisos.acciones;

  async function paso(destino) {
    const extra = { nota };
    if (destino === "programada") extra.fecha_programada = fecha || null;
    if (destino === "cerrada") extra.con_observaciones = conObservaciones;
    const ok = await onPaso(destino, extra);
    if (ok) {
      setNota("");
      setConObservaciones(false);
    }
  }

  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Qué se puede hacer ahora</h3>
      </div>
      <div className="mz-card-body">
        {acciones.includes("programada") && (
          <div className="mz-field">
            <label htmlFor="op-fecha">Fecha programada</label>
            <input
              id="op-fecha"
              type="date"
              className="form-control form-control-sm"
              value={fecha}
              onChange={(evento) => setFecha(evento.target.value)}
            />
          </div>
        )}
        <div className="mz-field">
          <label htmlFor="op-nota">
            Nota (obligatoria al pausar, al devolver y con observaciones)
          </label>
          <textarea
            id="op-nota"
            className="form-control form-control-sm"
            rows={2}
            value={nota}
            onChange={(evento) => setNota(evento.target.value)}
          />
        </div>
        {acciones.includes("cerrada") && (
          <div className="form-check mb-3">
            <input
              id="op-observaciones"
              type="checkbox"
              className="form-check-input"
              checked={conObservaciones}
              onChange={(evento) => setConObservaciones(evento.target.checked)}
            />
            <label className="form-check-label" htmlFor="op-observaciones">
              Aceptar con observaciones (la nota queda como observación)
            </label>
          </div>
        )}
        <div className="mz-actions">
          {acciones.map((destino) => (
            <button
              key={destino}
              type="button"
              className={`btn btn-sm ${
                destino === "cerrada" ? "btn-primary" : "btn-outline-primary"
              }`}
              disabled={isSaving}
              onClick={() => paso(destino)}
            >
              {textoDelPaso(destino, orden.estado)}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function Costos({ orden, costos, isSaving, onAgregar, onQuitar }) {
  const puede = orden.permisos.registrar_costos;
  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>Materiales y mano de obra</h3>
        <span className="mz-small mz-faint">
          Total con IVA: {moneda(costos.total)}
        </span>
      </div>
      <div className="mz-card-body mz-stack">
        <TablaDeCostos
          titulo="Materiales"
          filas={orden.materiales}
          columnas={[
            ["cantidad", "Cantidad"],
            ["costo_unitario", "Costo unitario", true],
          ]}
          puede={puede}
          isSaving={isSaving}
          onQuitar={(filaId) => onQuitar("materiales", filaId)}
          onAgregar={(datos) => onAgregar("materiales", datos)}
          campos={[
            ["descripcion", "Material", "text"],
            ["cantidad", "Cantidad", "number", "0.01"],
            ["costo_unitario", "Costo unitario", "number", "0.01"],
          ]}
        />
        <TablaDeCostos
          titulo="Mano de obra"
          filas={orden.mano_de_obra}
          columnas={[
            ["horas", "Horas"],
            ["costo_hora", "Costo por hora", true],
          ]}
          puede={puede}
          isSaving={isSaving}
          onQuitar={(filaId) => onQuitar("mano-de-obra", filaId)}
          onAgregar={(datos) => onAgregar("mano-de-obra", datos)}
          campos={[
            ["descripcion", "Trabajo realizado", "text"],
            ["horas", "Horas", "number", "0.25"],
            ["costo_hora", "Costo por hora", "number", "0.01"],
          ]}
        />
        <table className="mz-table ordenes-costos">
          <tbody>
            <tr>
              <td>Subtotal</td>
              <td className="num mz-mono">{moneda(costos.subtotal)}</td>
            </tr>
            <tr>
              <td>IVA ({costos.iva_porcentaje} %)</td>
              <td className="num mz-mono">{moneda(costos.iva)}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num mz-mono">{moneda(costos.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function TablaDeCostos({
  titulo,
  filas,
  columnas,
  puede,
  isSaving,
  onQuitar,
  onAgregar,
  campos,
}) {
  const vacio = Object.fromEntries(campos.map(([clave]) => [clave, ""]));
  const [nuevo, setNuevo] = useState(vacio);

  async function agregar(evento) {
    evento.preventDefault();
    if (await onAgregar(nuevo)) setNuevo(vacio);
  }

  return (
    <div>
      <h4 className="mz-small mz-strong">{titulo}</h4>
      <div className="mz-table-wrap">
        <table className="mz-table ordenes-costos">
          <thead>
            <tr>
              <th>Descripción</th>
              {columnas.map(([clave, etiqueta]) => (
                <th key={clave} className="num">
                  {etiqueta}
                </th>
              ))}
              <th className="num">Subtotal</th>
              {puede && <th aria-label="Acciones" />}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => (
              <tr key={fila.id}>
                <td>{fila.descripcion}</td>
                {columnas.map(([clave, , esMoneda]) => (
                  <td key={clave} className="num mz-mono">
                    {esMoneda ? moneda(fila[clave]) : Number(fila[clave])}
                  </td>
                ))}
                <td className="num mz-mono">{moneda(fila.subtotal)}</td>
                {puede && (
                  <td className="num">
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      disabled={isSaving}
                      onClick={() => onQuitar(fila.id)}
                      aria-label={`Quitar ${fila.descripcion}`}
                    >
                      <Icon name="trash" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {filas.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={columnas.length + (puede ? 3 : 2)}>
                  Nada registrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {puede && (
        <form onSubmit={agregar} className="row g-2 mt-1 align-items-end">
          {campos.map(([clave, etiqueta, tipo, paso]) => (
            <div
              key={clave}
              className={
                clave === "descripcion" ? "col-12 col-md-6" : "col-6 col-md-2"
              }
            >
              <label
                className="form-label mz-small"
                htmlFor={`oc-${titulo}-${clave}`}
              >
                {etiqueta}
              </label>
              <input
                id={`oc-${titulo}-${clave}`}
                className="form-control form-control-sm"
                type={tipo}
                step={paso}
                min={paso}
                required
                value={nuevo[clave]}
                onChange={(evento) =>
                  setNuevo((actual) => ({
                    ...actual,
                    [clave]: evento.target.value,
                  }))
                }
              />
            </div>
          ))}
          <div className="col-12 col-md-2">
            <button
              type="submit"
              className="btn btn-outline-primary btn-sm w-100"
              disabled={isSaving}
            >
              Agregar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
