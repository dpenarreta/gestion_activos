import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { activosService } from "../../../api/activosService";
import {
  componentesService,
  mantenimientosService,
} from "../../../api/mantenimientosService";
import { proveedoresService } from "../../../api/organizacionService";
import { BuscadorDeActivo } from "../../../components/activos/BuscadorDeActivo/BuscadorDeActivo";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { Icon } from "../../../components/common/Icon/Icon";
import { LineasComponentes } from "../../../components/mantenimientos/LineasComponentes/LineasComponentes";
import {
  hayErroresGenerales,
  erroresPorCampo,
  mensajeDeError,
} from "../../../utils/errores";
import "./Mantenimientos.css";
import { formatearDias } from "../../../utils/formato";

const hoy = () => new Date().toISOString().slice(0, 10);

const CAUSAS_SUGERIDAS = [
  "Pantalla dañada",
  "Batería agotada",
  "Disco fallando",
  "Teclado dañado",
  "Lentitud",
  "Virus o malware",
  "Fuente de poder",
  "Sobrecalentamiento",
  "Falla de red",
  "Mantenimiento preventivo",
];

/** Días entre ingreso y salida, para mostrarlos mientras se captura. */
function diasFuera({ fecha_intervencion: ingreso, fecha_salida: salida }) {
  if (!ingreso || !salida) return 0;
  const dias = (new Date(salida) - new Date(ingreso)) / 86400000;
  return Math.max(Math.round(dias), 0);
}

const VACIO = {
  activo: "",
  tipo: "correctivo",
  fecha_intervencion: hoy(),
  fecha_salida: "",
  tipo_responsable: "tecnico_interno",
  responsable: "",
  causa: "",
  descripcion: "",
  diagnostico: "",
  solucion: "",
  estado_final: "reparado",
  garantia_usada: false,
  costo_mano_obra: "",
};

const ESTADOS_FINALES = [
  { valor: "reparado", etiqueta: "Reparado" },
  { valor: "pendiente", etiqueta: "Pendiente" },
  { valor: "no_reparable", etiqueta: "No reparable" },
  { valor: "dado_de_baja", etiqueta: "Dado de baja" },
];

export function MantenimientoForm() {
  const { id } = useParams();
  const esEdicion = Boolean(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [valores, setValores] = useState(() => ({
    ...VACIO,
    // Permite entrar desde la ficha de un activo con el equipo ya elegido.
    activo: searchParams.get("activo") || "",
  }));
  const [lineas, setLineas] = useState([]);
  const [componentes, setComponentes] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [activoSeleccionado, setActivoSeleccionado] = useState(null);
  const [error, setError] = useState(null);
  // Auditoría UX/UI, fase 2 (28/10/2026): el error del servidor va bajo el
  // campo que lo causó, no solo en el aviso de arriba.
  const [errores, setErrores] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const contenedorRef = useRef(null);

  useEffect(() => {
    componentesService
      .list({ page_size: 200 })
      .then((datos) =>
        setComponentes((datos.results ?? datos).filter((c) => c.activo)),
      )
      .catch(() => setComponentes([]));
    // Para decir de quién se compró cada repuesto: el proveedor del equipo no
    // tiene por qué ser el de la pieza.
    proveedoresService
      .list({ activo: "true", page_size: 200 })
      .then((datos) => setProveedores(datos.results ?? datos))
      .catch(() => setProveedores([]));
  }, []);

  useEffect(() => {
    if (!esEdicion) return;
    mantenimientosService
      .get(id)
      .then((datos) => {
        setValores({
          activo: datos.activo,
          tipo: datos.tipo,
          fecha_intervencion: datos.fecha_intervencion,
          fecha_salida: datos.fecha_salida || "",
          tipo_responsable: datos.tipo_responsable,
          responsable: datos.responsable,
          causa: datos.causa || "",
          descripcion: datos.descripcion,
          diagnostico: datos.diagnostico || "",
          solucion: datos.solucion || "",
          estado_final: datos.estado_final,
          garantia_usada: datos.garantia_usada,
          costo_mano_obra: datos.costo_mano_obra || "",
        });
        setLineas(
          datos.componentes.map((componente) => ({
            componente: componente.componente,
            proveedor: componente.proveedor || "",
            cantidad: componente.cantidad,
            costo_unitario: componente.costo_unitario || "",
            numero_serie_nuevo: componente.numero_serie_nuevo || "",
          })),
        );
      })
      .catch(() => setError("No se pudo cargar la intervención."));
  }, [id, esEdicion]);

  // La fecha no puede ser anterior a la compra del equipo; conocerla permite
  // acotar el selector de fecha en vez de esperar al error del servidor.
  //
  // Normalmente lo entrega el propio buscador al elegir, pero cuando se llega
  // con el equipo puesto —desde su ficha o desde el escáner— por la URL solo
  // viaja el número y hay que pedir la ficha.
  useEffect(() => {
    if (!valores.activo) {
      setActivoSeleccionado(null);
      return;
    }
    let cancelado = false;
    activosService
      .get(valores.activo)
      .then((activo) => {
        if (!cancelado) setActivoSeleccionado(activo);
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [valores.activo]);

  function actualizar(campo, valor) {
    setValores((actuales) => ({ ...actuales, [campo]: valor }));
    setErrores((actuales) => {
      if (!actuales[campo]) return actuales;
      const resto = { ...actuales };
      delete resto[campo];
      return resto;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setErrores({});
    try {
      const payload = {
        ...valores,
        // Vacío significa «sigue fuera de operación», no una fecha en blanco.
        fecha_salida: valores.fecha_salida || null,
        costo_mano_obra: valores.costo_mano_obra || null,
        componentes: lineas
          .filter((linea) => linea.componente)
          .map((linea) => ({
            componente: linea.componente,
            proveedor: linea.proveedor || null,
            cantidad: Number(linea.cantidad) || 1,
            costo_unitario: linea.costo_unitario || null,
            numero_serie_nuevo: linea.numero_serie_nuevo || "",
          })),
      };
      if (esEdicion) {
        await mantenimientosService.update(id, payload);
      } else {
        await mantenimientosService.create(payload);
      }
      // Volver a la ficha del activo cuando se entró desde ella: es donde el
      // usuario quiere ver reflejado el contador que acaba de mover.
      navigate(
        valores.activo
          ? `/admin/activos/${valores.activo}`
          : "/admin/mantenimientos",
      );
    } catch (err) {
      const porCampo = erroresPorCampo(err);
      setErrores(porCampo);
      // Lo que no es de un campo visible (las piezas, por ejemplo) sigue
      // diciéndose completo arriba.
      const todoEnSuCampo =
        Object.keys(porCampo).length > 0 &&
        Object.keys(porCampo).every((campo) => campo in VACIO) &&
        !hayErroresGenerales(err);
      setError(
        todoEnSuCampo
          ? "No se pudo guardar la intervención: revise los campos marcados."
          : mensajeDeError(err, "No se pudo guardar la intervención."),
      );
      enfocarPrimerError(contenedorRef.current);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mantenimientos-page" ref={contenedorRef}>
      <div className="mz-view-head">
        <div>
          <h2>
            {esEdicion ? "Editar intervención" : "Registrar mantenimiento"}
          </h2>
          <p className="mz-desc">
            Qué se le hizo al equipo, quién lo hizo y qué piezas consumió: de
            aquí salen sus contadores y su sugerencia de renovación.
          </p>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}

      {/* Se conserva `row g-3`: la intervención se captura en filas de tres y
          cuatro campos de anchos distintos, que la rejilla de dos columnas de
          la identidad no reproduce. */}
      <form onSubmit={handleSubmit} className="mz-card mantenimiento-form">
        <div className="mz-card-body">
          <LeyendaObligatorios />
          <div className="mz-section">
            <h4>Intervención</h4>
            <div className="row g-3">
              <div className="col-md-6">
                {/* Se busca contra el servidor en vez de desplegar el parque
                  entero: con el equipo en la mano, disparar la pistola o
                  teclear tres letras es más rápido que recorrer una lista, y
                  la lista además se pedía con un tope de trescientos —en un
                  inventario de verdad, el trescientos uno no se podía elegir—. */}
                <BuscadorDeActivo
                  valor={valores.activo}
                  onChange={(id, activo) => {
                    actualizar("activo", id);
                    setActivoSeleccionado(activo);
                  }}
                  disabled={esEdicion}
                  requerido
                  errorCampo={errores.activo}
                  ayuda={
                    esEdicion
                      ? "Una intervención no cambia de activo: si el equipo era otro, elimínela y regístrela de nuevo."
                      : undefined
                  }
                />
                <AvisoDeNotificacion activo={activoSeleccionado} />
              </div>
              <Campo
                id="tipo"
                etiqueta="Tipo"
                error={errores.tipo}
                className="col-md-3"
              >
                <select
                  className="form-select"
                  value={valores.tipo}
                  onChange={(event) => actualizar("tipo", event.target.value)}
                >
                  <option value="correctivo">Correctivo</option>
                  <option value="preventivo">Preventivo</option>
                </select>
              </Campo>
              <Campo
                id="fecha"
                etiqueta="Fecha de ingreso"
                obligatorio
                ayuda={
                  activoSeleccionado
                    ? `El equipo se adquirió el ${activoSeleccionado.fecha_adquisicion}.`
                    : undefined
                }
                error={errores.fecha_intervencion}
                className="col-md-3"
              >
                <input
                  type="date"
                  className="form-control"
                  max={hoy()}
                  min={activoSeleccionado?.fecha_adquisicion}
                  value={valores.fecha_intervencion}
                  onChange={(event) =>
                    actualizar("fecha_intervencion", event.target.value)
                  }
                />
              </Campo>
              <Campo
                id="fecha_salida"
                etiqueta="Fecha de salida"
                ayuda={
                  valores.fecha_salida
                    ? `${formatearDias(diasFuera(valores))} fuera de operación.`
                    : "Vacío mientras el equipo siga fuera de operación."
                }
                error={errores.fecha_salida}
                className="col-md-3"
              >
                <input
                  type="date"
                  className="form-control"
                  max={hoy()}
                  min={valores.fecha_intervencion || undefined}
                  value={valores.fecha_salida}
                  onChange={(event) =>
                    actualizar("fecha_salida", event.target.value)
                  }
                />
              </Campo>
              <div className="col-md-4">
                <label className="form-label" htmlFor="tipo_responsable">
                  A cargo de
                </label>
                <select
                  id="tipo_responsable"
                  className="form-select"
                  value={valores.tipo_responsable}
                  onChange={(event) =>
                    actualizar("tipo_responsable", event.target.value)
                  }
                >
                  <option value="tecnico_interno">Técnico interno</option>
                  <option value="proveedor_externo">Proveedor externo</option>
                </select>
              </div>
              <Campo
                id="responsable"
                etiqueta="Nombre del técnico o proveedor"
                obligatorio
                error={errores.responsable}
                className="col-md-8"
              >
                <input
                  className="form-control"
                  maxLength={150}
                  value={valores.responsable}
                  onChange={(event) =>
                    actualizar("responsable", event.target.value)
                  }
                />
              </Campo>
              <div className="col-md-6">
                <label className="form-label" htmlFor="causa">
                  Causa de la falla
                </label>
                <input
                  id="causa"
                  className="form-control"
                  list="causas-frecuentes"
                  maxLength={150}
                  placeholder="Pantalla dañada, batería, disco, lentitud…"
                  value={valores.causa}
                  onChange={(event) => actualizar("causa", event.target.value)}
                />
                {/* Sugerencias para que la misma falla no se escriba de tres
                  formas distintas: es lo que permite ver causas recurrentes. */}
                <datalist id="causas-frecuentes">
                  {CAUSAS_SUGERIDAS.map((causa) => (
                    <option key={causa} value={causa} />
                  ))}
                </datalist>
              </div>
              <div className="col-md-3">
                <label className="form-label" htmlFor="estado_final">
                  Estado final
                </label>
                <select
                  id="estado_final"
                  className="form-select"
                  value={valores.estado_final}
                  onChange={(event) =>
                    actualizar("estado_final", event.target.value)
                  }
                >
                  {ESTADOS_FINALES.map((opcion) => (
                    <option key={opcion.valor} value={opcion.valor}>
                      {opcion.etiqueta}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-3 d-flex align-items-end">
                <div className="form-check mb-2">
                  <input
                    id="garantia_usada"
                    type="checkbox"
                    className="form-check-input"
                    checked={valores.garantia_usada}
                    onChange={(event) =>
                      actualizar("garantia_usada", event.target.checked)
                    }
                  />
                  <label className="form-check-label" htmlFor="garantia_usada">
                    Cubierto por garantía
                  </label>
                </div>
              </div>
              <Campo
                id="descripcion"
                etiqueta="Trabajo realizado"
                obligatorio
                error={errores.descripcion}
                className="col-12"
              >
                <textarea
                  className="form-control"
                  rows={2}
                  value={valores.descripcion}
                  onChange={(event) =>
                    actualizar("descripcion", event.target.value)
                  }
                />
              </Campo>
              <div className="col-12">
                <label className="form-label" htmlFor="diagnostico">
                  Diagnóstico
                </label>
                <textarea
                  id="diagnostico"
                  className="form-control"
                  rows={2}
                  value={valores.diagnostico}
                  onChange={(event) =>
                    actualizar("diagnostico", event.target.value)
                  }
                />
              </div>
              <div className="col-12">
                <label className="form-label" htmlFor="solucion">
                  Solución aplicada
                </label>
                <textarea
                  id="solucion"
                  className="form-control"
                  rows={2}
                  value={valores.solucion}
                  onChange={(event) =>
                    actualizar("solucion", event.target.value)
                  }
                />
              </div>
              <Campo
                id="costo_mano_obra"
                etiqueta="Costo de mano de obra"
                error={errores.costo_mano_obra}
                className="col-md-4"
              >
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="form-control"
                  value={valores.costo_mano_obra}
                  onChange={(event) =>
                    actualizar("costo_mano_obra", event.target.value)
                  }
                />
              </Campo>
            </div>
          </div>

          <div className="mz-section">
            <h4>Componentes y repuestos utilizados</h4>
            <LineasComponentes
              lineas={lineas}
              componentes={componentes}
              proveedores={proveedores}
              onChange={setLineas}
              esEdicion={esEdicion}
            />
          </div>

          <div className="mz-actions justify-content-end mt-3">
            <button
              type="button"
              className="btn btn-cancelar"
              onClick={() => navigate("/admin/mantenimientos")}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSaving}
            >
              {isSaving
                ? "Guardando…"
                : esEdicion
                  ? "Guardar cambios"
                  : "Registrar intervención"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/**
 * A quién se le va a avisar por correo cuando se guarde, y a quién no.
 *
 * Se dice **antes** de guardar y no después: quien registra la entrada de un
 * equipo puede ir a poner el correo que falta, o avisar por otro medio. El
 * mismo texto después del hecho solo sirve para enterarse de que alguien no se
 * enteró.
 *
 * Nunca se enseña la dirección: para saber que a alguien no le va a llegar el
 * aviso basta con su nombre, y el correo de cada empleado no tiene por qué
 * repartirse por las pantallas (ver `docs/data-protection-review.md`).
 */
function AvisoDeNotificacion({ activo }) {
  const responsables = activo?.responsables ?? [];
  if (!activo) return null;

  const sinCorreo = responsables.filter(
    (persona) => persona.recibe_avisos === false,
  );
  const conCorreo = responsables.filter(
    (persona) => persona.recibe_avisos !== false,
  );

  if (responsables.length === 0) {
    return (
      <div className="form-text">
        Nadie responde por este equipo, así que el aviso le llegará a usted.
      </div>
    );
  }

  return (
    <div className="form-text">
      {conCorreo.length > 0 && (
        <span>
          Se avisará por correo a{" "}
          {conCorreo.map((persona) => persona.nombre_completo).join(", ")}.{" "}
        </span>
      )}
      {sinCorreo.length > 0 && (
        <span className="mz-warn">
          {sinCorreo.map((persona) => persona.nombre_completo).join(", ")}{" "}
          {sinCorreo.length === 1 ? "no tiene" : "no tienen"} correo en su ficha
          y no {sinCorreo.length === 1 ? "recibirá" : "recibirán"} el aviso
          {conCorreo.length === 0 ? "; le llegará a usted." : "."}
        </span>
      )}
    </div>
  );
}
