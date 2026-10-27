import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";
import { useAuth } from "../../hooks/useAuth";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import { AsignacionCargos } from "./AsignacionCargos";
import { CargaPersonas, descargarArchivoOrganigrama } from "./CargaPersonas";
import { CapacitacionGestion } from "./CapacitacionGestion";
import { CapacitacionResultados } from "./CapacitacionResultados";
import { HerramientasPage } from "./HerramientasPage";
import { PerfilesCargo } from "./PerfilesCargo";
import { NivelDeCargo } from "./NivelDeCargo";
import { NivelesJerarquicos } from "./NivelesJerarquicos";
import { armarArbol, nombreDeCargo } from "./organigrama";
import "./Institucional.css";
import { usePedirMotivo } from "../../components/common/PedirMotivo/PedirMotivo";
import { BitacoraOrganigrama } from "./BitacoraOrganigrama";

/** Cada pestaña con el permiso que la abre: armar la estructura o asignar. */
const PESTANAS = [
  ["niveles", "Niveles jerárquicos", "institucional.editar"],
  ["unidades", "Unidades", "institucional.editar"],
  ["cargos", "Cargos", "institucional.editar"],
  ["asignaciones", "Asignación de cargos", "institucional.asignar"],
  ["perfiles", "Perfiles de cargo", "institucional.perfil_cargo"],
  ["herramientas", "Herramientas y licencias", "herramientas.gestionar"],
  ["capacitacion", "Capacitación", "capacitacion.gestionar"],
  ["resultados", "Resultados de capacitación", "capacitacion.resultados"],
];

const VACIOS = {
  niveles: { nombre: "", orden: 1 },
  unidades: {
    nombre: "",
    codigo: "",
    nivel: "",
    padre: "",
    descripcion: "",
    activa: true,
  },
  cargos: {
    nombre: "",
    unidad: "",
    jefe: "",
    plazas: 1,
    nivel: "",
    descripcion: "",
    activo: true,
  },
};

/** Las unidades en orden de árbol, con su profundidad (para sangrarlas). */
function unidadesEnOrden(datos) {
  const lista = [];
  const recorrer = (nodos, profundidad) =>
    nodos.forEach((n) => {
      lista.push({ ...n, profundidad });
      recorrer(n.hijas, profundidad + 1);
    });
  recorrer(armarArbol(datos), 0);
  return lista;
}

function Campo({ id, etiqueta, children, ancho = "col-12 col-md-6" }) {
  return (
    <div className={ancho}>
      <label className="form-label mz-small" htmlFor={id}>
        {etiqueta}
      </label>
      {children}
    </div>
  );
}

/** El formulario de alta o edición de un nivel, una unidad o un cargo. */
function Formulario({ recurso, inicial, datos, onGuardar, onCancelar }) {
  const [valores, setValores] = useState(inicial);
  const fijar = (campo) => (e) =>
    setValores((v) => ({
      ...v,
      [campo]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));
  const ordenadas = useMemo(() => unidadesEnOrden(datos), [datos]);
  const editando = Boolean(valores.id);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onGuardar(valores);
      }}
    >
      <div className="row g-2">
        <Campo id="est-nombre" etiqueta="Nombre">
          <input
            id="est-nombre"
            className="form-control form-control-sm"
            required
            maxLength={recurso === "niveles" ? 80 : 150}
            value={valores.nombre}
            onChange={fijar("nombre")}
          />
        </Campo>

        {recurso === "niveles" && (
          <Campo
            id="est-orden"
            etiqueta="Orden (1 es el más alto)"
            ancho="col-6 col-md-3"
          >
            <input
              id="est-orden"
              type="number"
              min={1}
              className="form-control form-control-sm"
              required
              value={valores.orden}
              onChange={fijar("orden")}
            />
          </Campo>
        )}

        {recurso === "unidades" && (
          <>
            <Campo id="est-codigo" etiqueta="Código" ancho="col-6 col-md-2">
              <input
                id="est-codigo"
                className="form-control form-control-sm"
                maxLength={20}
                placeholder="Ej.: TI"
                title="Cada unidad es también el departamento del sistema: este código va en las etiquetas y en el código de cada empleado (TI-0001). Vacío, se toma de las iniciales."
                value={valores.codigo}
                onChange={fijar("codigo")}
              />
            </Campo>
            <Campo id="est-nivel" etiqueta="Nivel" ancho="col-6 col-md-4">
              <select
                id="est-nivel"
                className="form-select form-select-sm"
                required
                value={valores.nivel}
                onChange={fijar("nivel")}
              >
                <option value="">Elija el nivel</option>
                {datos.niveles.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.orden}. {n.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id="est-padre" etiqueta="Depende de">
              <select
                id="est-padre"
                className="form-select form-select-sm"
                value={valores.padre ?? ""}
                onChange={fijar("padre")}
              >
                <option value="">Ninguna (es la raíz)</option>
                {ordenadas
                  .filter((u) => u.id !== valores.id)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {"— ".repeat(u.profundidad)}
                      {u.nombre}
                    </option>
                  ))}
              </select>
            </Campo>
          </>
        )}

        {recurso === "cargos" && (
          <>
            <Campo id="est-unidad" etiqueta="Unidad">
              <select
                id="est-unidad"
                className="form-select form-select-sm"
                required
                value={valores.unidad ?? ""}
                onChange={fijar("unidad")}
              >
                <option value="">Elija la unidad</option>
                {ordenadas.map((u) => (
                  <option key={u.id} value={u.id}>
                    {"— ".repeat(u.profundidad)}
                    {u.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo id="est-jefe" etiqueta="Reporta a (jefe inmediato)">
              <select
                id="est-jefe"
                className="form-select form-select-sm"
                value={valores.jefe ?? ""}
                onChange={fijar("jefe")}
              >
                <option value="">Nadie (máxima autoridad)</option>
                {datos.cargos
                  .filter((c) => c.id !== valores.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {nombreDeCargo(c, datos.unidades, datos.cargos)}
                    </option>
                  ))}
              </select>
            </Campo>
            <Campo
              id="est-nivel-cargo"
              etiqueta="Nivel jerárquico"
              ancho="col-6 col-md-4"
            >
              <select
                id="est-nivel-cargo"
                className="form-select form-select-sm"
                aria-describedby="est-nivel-cargo-ayuda"
                value={valores.nivel ?? ""}
                onChange={fijar("nivel")}
              >
                {!editando && (
                  <option value="">Según el nombre del cargo</option>
                )}
                {(datos.niveles_cargo ?? []).map((n) => (
                  <option key={n.valor} value={n.valor}>
                    {n.nombre}
                  </option>
                ))}
              </select>
              <div id="est-nivel-cargo-ayuda" className="form-text">
                Gerencia General › Gerencia de Área › Jefatura › Coordinación ›
                Operativo › Asistente. No puede reportar a un cargo de nivel más
                bajo.
              </div>
            </Campo>
            <Campo id="est-plazas" etiqueta="Plazas" ancho="col-6 col-md-2">
              <input
                id="est-plazas"
                type="number"
                min={1}
                max={999}
                className="form-control form-control-sm"
                required
                value={valores.plazas}
                onChange={fijar("plazas")}
              />
            </Campo>
          </>
        )}

        {recurso !== "niveles" && (
          <>
            <Campo id="est-descripcion" etiqueta="Descripción" ancho="col-12">
              <textarea
                id="est-descripcion"
                className="form-control form-control-sm"
                rows={2}
                value={valores.descripcion}
                onChange={fijar("descripcion")}
              />
            </Campo>
            <div className="col-12">
              <label className="form-check">
                <input
                  type="checkbox"
                  className="form-check-input"
                  checked={
                    recurso === "unidades" ? valores.activa : valores.activo
                  }
                  onChange={fijar(recurso === "unidades" ? "activa" : "activo")}
                />{" "}
                <span className="form-check-label">
                  {recurso === "unidades" ? "Activa" : "Activo"}
                </span>
              </label>
            </div>
          </>
        )}

        <div className="col-12 mz-actions justify-content-end">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={onCancelar}
          >
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary btn-sm">
            {editando ? "Guardar cambios" : "Agregar"}
          </button>
        </div>
      </div>
    </form>
  );
}

const SINGULAR = { niveles: "nivel", unidades: "unidad", cargos: "cargo" };

/**
 * Agregar o editar en una ventana, y no en una tarjeta al pie de la tabla:
 * con un organigrama real (más de cien cargos) el formulario quedaba muy
 * abajo y pulsar «Editar» parecía no hacer nada.
 */
function Ventana({ recurso, valores, onCerrar, children }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const titulo = `${valores.id ? "Editar" : "Agregar"} ${SINGULAR[recurso]}`;
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
        aria-labelledby="estructura-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3 id="estructura-titulo">
            {titulo}
            {valores.id ? `: ${valores.nombre}` : ""}
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
        <div className="mz-panel-body">{children}</div>
      </div>
    </div>
  );
}

/** Plazas de un cargo, editables en la misma tabla: se guardan al salir del
 * campo o con Enter, y Escape deshace. */
function PlazasEnLinea({ cargo, onGuardar }) {
  const [valor, setValor] = useState(String(cargo.plazas));
  const ocupadas = cargo.plazas - cargo.vacantes;

  useEffect(() => setValor(String(cargo.plazas)), [cargo.plazas]);

  function guardar() {
    const numero = Number(valor);
    if (!Number.isInteger(numero) || numero < 1 || numero > 999) {
      setValor(String(cargo.plazas));
      return;
    }
    if (numero !== cargo.plazas) onGuardar(numero);
  }

  return (
    <span className="org-plazas-edicion">
      <span className="mz-faint" title="Plazas cubiertas">
        {ocupadas} /
      </span>
      <input
        type="number"
        min={1}
        max={999}
        className="form-control form-control-sm"
        aria-label={`Plazas de ${cargo.nombre}`}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onBlur={guardar}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setValor(String(cargo.plazas));
        }}
      />
    </span>
  );
}

/** Lo que se manda: los selectores vacíos van como `null`. */
function aEnviar(recurso, valores) {
  // Solo lo que se edita: el árbol trae además hijas, cargos y ocupantes.
  const resto = Object.fromEntries(
    Object.keys(VACIOS[recurso]).map((campo) => [campo, valores[campo]]),
  );
  const nulos = { unidades: ["padre"], cargos: ["jefe"] }[recurso];
  for (const campo of nulos ?? []) if (resto[campo] === "") resto[campo] = null;
  // Un cargo sin nivel elegido toma el de su nombre (lo decide el servidor).
  if (recurso === "cargos" && !resto.nivel) delete resto.nivel;
  return resto;
}

/**
 * Institucional → Estructura: se arma el organigrama en tres pasos — los
 * niveles jerárquicos (de arriba hacia abajo), las unidades (cada una dentro
 * de otra de un nivel superior) y los cargos (en una unidad, con su jefe y
 * sus plazas)— y, en la cuarta pestaña, quién ocupa cada cargo. Cada pestaña
 * se ve con su permiso (`?pestana=` abre una en particular).
 */
export function EstructuraPage() {
  const { user } = useAuth();
  const [parametros] = useSearchParams();
  const visibles = PESTANAS.filter(([, , permiso]) =>
    user?.permissions?.includes(permiso),
  );
  const pedida = visibles.find(([id]) => id === parametros.get("pestana"));
  const [pestana, setPestana] = useState(
    (pedida ?? visibles[0])?.[0] ?? "niveles",
  );
  const [datos, setDatos] = useState(null);
  const [editando, setEditando] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [cargaAbierta, setCargaAbierta] = useState(false);
  const [bitacoraAbierta, setBitacoraAbierta] = useState(false);
  const [pedirMotivo, dialogoMotivo] = usePedirMotivo();
  const puedeCargar = user?.permissions?.includes("institucional.asignar");
  const puedeRevertir = user?.permissions?.includes("institucional.editar");

  async function descargar(tipo) {
    setError(null);
    try {
      await descargarArchivoOrganigrama(tipo);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo descargar el archivo."));
    }
  }

  const cargar = useCallback(
    () =>
      institucionalService
        .organigrama()
        .then(setDatos)
        .catch((err) =>
          setError(mensajeDeError(err, "No se pudo cargar el organigrama.")),
        ),
    [],
  );

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Cada cambio pide su motivo, que queda en la bitácora (26/10/2026).
  async function ejecutar(accion, mensaje, detalle = "") {
    setError(null);
    setAviso(null);
    const motivo = await pedirMotivo(detalle);
    if (!motivo) return false;
    try {
      await accion(motivo);
      await cargar();
      setAviso(mensaje);
      return true;
    } catch (err) {
      setError(mensajeDeError(err));
      return false;
    }
  }

  async function guardar(valores) {
    const cuerpo = aEnviar(pestana, valores);
    const hecho = await ejecutar(
      (motivo) =>
        valores.id
          ? institucionalService.actualizar(pestana, valores.id, cuerpo, motivo)
          : institucionalService.crear(pestana, cuerpo, motivo),
      valores.id ? "Cambios guardados." : "Agregado.",
      valores.id
        ? `Cambios en «${valores.nombre}».`
        : `Nuevo: «${valores.nombre}».`,
    );
    if (hecho) setEditando(null);
  }

  const filas = useMemo(() => {
    if (!datos) return [];
    if (pestana === "unidades") return unidadesEnOrden(datos);
    return datos[pestana];
  }, [datos, pestana]);

  const unidadDe = (id) => datos?.unidades.find((u) => u.id === id)?.nombre;
  const cargoDe = (id) => datos?.cargos.find((c) => c.id === id)?.nombre;
  const sinNiveles = pestana !== "niveles" && datos?.niveles.length === 0;
  const sinUnidades = pestana === "cargos" && datos?.unidades.length === 0;

  return (
    <div className="institucional-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Estructura del organigrama</h2>
          <p className="mz-desc">
            Primero los niveles de unidad, luego las unidades (cada una dentro
            de otra de un nivel superior), los cargos de cada unidad y, al
            final, quién ocupa cada cargo.
          </p>
        </div>
        <div className="mz-actions">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => setBitacoraAbierta(true)}
          >
            <Icon name="journal-text" /> Bitácora de cambios
          </button>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={() => descargar("plantilla")}
          >
            <Icon name="file-earmark-arrow-down" /> Plantilla de carga masiva
          </button>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={() => descargar("completo")}
          >
            <Icon name="file-earmark-spreadsheet" /> Organigrama completo
          </button>
          {puedeCargar && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setCargaAbierta(true)}
            >
              <Icon name="upload" /> Carga masiva de personas
            </button>
          )}
        </div>
      </div>
      {bitacoraAbierta && (
        <BitacoraOrganigrama
          puedeRevertir={puedeRevertir}
          onCerrar={() => setBitacoraAbierta(false)}
          onRevertido={cargar}
        />
      )}
      {dialogoMotivo}
      {cargaAbierta && (
        <CargaPersonas
          onCerrar={() => setCargaAbierta(false)}
          onCargado={cargar}
        />
      )}

      <div className="mz-tabs" role="tablist">
        {visibles.map(([id, texto]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pestana === id}
            className={pestana === id ? "is-active" : undefined}
            onClick={() => {
              setPestana(id);
              setEditando(null);
              setAviso(null);
              setError(null);
            }}
          >
            {texto}
            {datos && id !== "niveles" && datos[id] && (
              <span className="mz-faint"> ({datos[id].length})</span>
            )}
          </button>
        ))}
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

      {datos && pestana === "asignaciones" && (
        <AsignacionCargos datos={datos} onAsignado={cargar} />
      )}

      {datos && pestana === "perfiles" && (
        <PerfilesCargo
          datos={datos}
          onGuardado={async () => {
            await cargar();
            setAviso("Perfil del cargo guardado.");
          }}
        />
      )}

      {pestana === "herramientas" && <HerramientasPage />}
      {datos && pestana === "capacitacion" && (
        <CapacitacionGestion datos={datos} />
      )}
      {pestana === "resultados" && <CapacitacionResultados />}

      {datos &&
        ![
          "asignaciones",
          "perfiles",
          "herramientas",
          "capacitacion",
          "resultados",
        ].includes(pestana) && (
          <>
            {pestana === "niveles" && <NivelesJerarquicos datos={datos} />}
            <section
              className={
                pestana === "niveles"
                  ? "mz-card estructura-seccion"
                  : "estructura-seccion"
              }
              aria-labelledby={
                pestana === "niveles" ? "niveles-unidad-titulo" : undefined
              }
            >
              <div
                className={
                  pestana === "niveles" ? "mz-card-body mz-stack" : "mz-stack"
                }
              >
                {pestana === "niveles" && (
                  <div>
                    <h3
                      id="niveles-unidad-titulo"
                      className="inicio-titulo mb-1"
                    >
                      Niveles de unidad
                    </h3>
                    <p className="estructura-desc mb-0">
                      Ordenan las unidades del organigrama (la Gerencia General
                      arriba y las áreas debajo); no son los niveles de los
                      cargos.
                    </p>
                  </div>
                )}
                <div className="mz-actions">
                  {sinNiveles || sinUnidades ? (
                    <p className="mz-faint mb-0">
                      {sinNiveles
                        ? "Cree primero los niveles de unidad."
                        : "Cree primero las unidades."}
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => setEditando({ ...VACIOS[pestana] })}
                    >
                      <Icon name="plus-lg" /> Agregar{" "}
                      {pestana === "niveles"
                        ? "nivel de unidad"
                        : SINGULAR[pestana]}
                    </button>
                  )}
                </div>
                <div className="mz-table-wrap">
                  <table className="mz-table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        {pestana === "niveles" && <th>Orden</th>}
                        {pestana === "unidades" && <th>Nivel de unidad</th>}
                        {pestana === "unidades" && <th>Depende de</th>}
                        {pestana === "cargos" && <th>Unidad</th>}
                        {pestana === "cargos" && <th>Nivel jerárquico</th>}
                        {pestana === "cargos" && <th>Reporta a</th>}
                        {pestana === "cargos" && (
                          <th className="num">Plazas</th>
                        )}
                        {pestana === "cargos" && <th>Rol del sistema</th>}
                        <th aria-label="Acciones" />
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((fila) => (
                        <tr key={fila.id}>
                          <td>
                            {pestana === "unidades" && (
                              <span
                                className="org-sangria"
                                style={{ width: fila.profundidad * 16 }}
                              />
                            )}
                            {fila.nombre}
                            {(fila.activa === false ||
                              fila.activo === false) && (
                              <span className="mz-faint"> (inactivo)</span>
                            )}
                          </td>
                          {pestana === "niveles" && <td>{fila.orden}</td>}
                          {pestana === "unidades" && (
                            <td>{fila.nivel?.nombre}</td>
                          )}
                          {pestana === "unidades" && (
                            <td>{unidadDe(fila.padre) ?? "—"}</td>
                          )}
                          {pestana === "cargos" && (
                            <td>{unidadDe(fila.unidad)}</td>
                          )}
                          {pestana === "cargos" && (
                            <td>
                              <NivelDeCargo valor={fila.nivel} datos={datos} />
                            </td>
                          )}
                          {pestana === "cargos" && (
                            <td>{cargoDe(fila.jefe) ?? "—"}</td>
                          )}
                          {pestana === "cargos" && (
                            <td className="num">
                              <PlazasEnLinea
                                cargo={fila}
                                onGuardar={(plazas) =>
                                  ejecutar(
                                    (motivo) =>
                                      institucionalService.actualizar(
                                        "cargos",
                                        fila.id,
                                        { plazas },
                                        motivo,
                                      ),
                                    `«${fila.nombre}» ahora tiene ${plazas} plaza(s).`,
                                    `«${fila.nombre}» pasa a ${plazas} plaza(s).`,
                                  )
                                }
                              />
                            </td>
                          )}
                          {pestana === "cargos" && (
                            <td className="mz-small">
                              {/* Lo comparten quienes ocupan el cargo; sus
                              permisos se editan en Roles. */}
                              {fila.rol ? (
                                <Link to={`/admin/roles/${fila.rol.id}`}>
                                  {fila.rol.nombre}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </td>
                          )}
                          <td className="num text-nowrap">
                            <button
                              type="button"
                              className="btn btn-outline-secondary btn-sm"
                              aria-label={`Editar ${fila.nombre}`}
                              onClick={() =>
                                setEditando({
                                  ...VACIOS[pestana],
                                  ...fila,
                                  nivel:
                                    pestana === "unidades"
                                      ? (fila.nivel?.id ?? "")
                                      : pestana === "cargos"
                                        ? (fila.nivel ?? "")
                                        : undefined,
                                  padre: fila.padre ?? "",
                                  jefe: fila.jefe ?? "",
                                })
                              }
                            >
                              <Icon name="pencil" />
                            </button>{" "}
                            <button
                              type="button"
                              className="btn btn-outline-danger btn-sm"
                              aria-label={`Borrar ${fila.nombre}`}
                              onClick={() =>
                                ejecutar(
                                  (motivo) =>
                                    institucionalService.eliminar(
                                      pestana,
                                      fila.id,
                                      motivo,
                                    ),
                                  `«${fila.nombre}» se borró.`,
                                  `Se borra «${fila.nombre}».`,
                                )
                              }
                            >
                              <Icon name="trash" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {filas.length === 0 && (
                        <tr className="mz-empty-row">
                          <td colSpan={6}>Todavía no hay registros</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {editando && (
              <Ventana
                recurso={pestana}
                valores={editando}
                onCerrar={() => setEditando(null)}
              >
                <Formulario
                  key={`${pestana}-${editando.id ?? "nuevo"}`}
                  recurso={pestana}
                  inicial={editando}
                  datos={datos}
                  onGuardar={guardar}
                  onCancelar={() => setEditando(null)}
                />
              </Ventana>
            )}
          </>
        )}
    </div>
  );
}
