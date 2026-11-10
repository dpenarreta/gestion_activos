import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { institucionalService } from "../../api/institucionalService";
import { AnuncioDeResultados } from "../../components/common/AnuncioDeResultados/AnuncioDeResultados";
import {
  EstadoDeCarga,
  FilaDeEstado,
} from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
import { useAuth } from "../../hooks/useAuth";
import { useModalA11y } from "../../hooks/useModalA11y";
import { coincideBusqueda } from "../../utils/busqueda";
import { mensajeDeError } from "../../utils/errores";
import { AsignacionCargos } from "./AsignacionCargos";
import { CargaPersonas, descargarArchivoOrganigrama } from "./CargaPersonas";
import { CapacitacionGestion } from "./CapacitacionGestion";
import { CapacitacionResultados } from "./CapacitacionResultados";
import { HerramientasPage } from "./HerramientasPage";
import { PerfilesCargo } from "./PerfilesCargo";
import { NivelDeCargo } from "./NivelDeCargo";
import { NivelesJerarquicos } from "./NivelesJerarquicos";
import { SelectorJefesSecundarios } from "./SelectorJefesSecundarios";
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
    // El reporte secundario o línea punteada (09/11/2026): ids de cargo.
    jefes_secundarios: [],
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
  // Mientras se pide el motivo y se guarda, el botón no vuelve a enviar: un
  // segundo clic pedía otro motivo y podía guardar dos veces (auditoría
  // UX/UI, 10/11/2026).
  const [guardando, setGuardando] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (guardando) return;
        setGuardando(true);
        try {
          await onGuardar(valores);
        } finally {
          setGuardando(false);
        }
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
                onChange={(e) => {
                  const jefe = e.target.value;
                  // El jefe inmediato no es además jefe secundario.
                  setValores((v) => ({
                    ...v,
                    jefe,
                    jefes_secundarios: (v.jefes_secundarios ?? []).filter(
                      (x) => String(x) !== jefe,
                    ),
                  }));
                }}
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
            <div className="col-12">
              <SelectorJefesSecundarios
                cargoId={valores.id}
                jefeId={valores.jefe}
                elegidos={valores.jefes_secundarios ?? []}
                datos={datos}
                onCambio={(jefes_secundarios) =>
                  setValores((v) => ({ ...v, jefes_secundarios }))
                }
              />
            </div>
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
function Ventana({ recurso, valores, error, onCerrar, children }) {
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
        <div className="mz-panel-body">
          {/* El error del guardado va dentro de la ventana: en la página
              quedaba detrás y parecía que «Guardar cambios» no hacía nada
              (auditoría UX/UI, 10/11/2026). */}
          {error && (
            <div className="mz-alert mz-alert--bad mb-3" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {children}
        </div>
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
  if (recurso === "cargos")
    resto.jefes_secundarios = (resto.jefes_secundarios ?? []).map(Number);
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
  // Buscador de la pestaña Cargos (09/11/2026): con todas las áreas son
  // cientos de cargos y, para saber si uno ya existe, había que recorrer la
  // tabla. Filtra en cada tecla sin tildes ni mayúsculas, como el resto de
  // buscadores de la intranet.
  const [buscarCargo, setBuscarCargo] = useState("");
  const [unidadDeCargo, setUnidadDeCargo] = useState("");
  const campoBuscarCargo = useRef(null);
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
    if (pestana !== "cargos") return datos[pestana];
    const nombreDe = (lista, id) => lista.find((x) => x.id === id)?.nombre;
    return datos.cargos.filter(
      (cargo) =>
        (unidadDeCargo === "" || String(cargo.unidad) === unidadDeCargo) &&
        coincideBusqueda(
          buscarCargo,
          cargo.nombre,
          nombreDe(datos.unidades, cargo.unidad),
          nombreDe(datos.cargos, cargo.jefe),
          ...(cargo.jefes_secundarios ?? []).map((id) =>
            nombreDe(datos.cargos, id),
          ),
          cargo.rol?.nombre,
        ),
    );
  }, [datos, pestana, buscarCargo, unidadDeCargo]);
  const filtrandoCargos =
    pestana === "cargos" && (buscarCargo.trim() !== "" || unidadDeCargo !== "");

  // El vacío devuelve el foco al buscador (`campoBusquedaRef`), como el resto
  // de listados.
  function limpiarFiltroCargos() {
    setBuscarCargo("");
    setUnidadDeCargo("");
  }

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

      {/* Pestañas con flechas y su panel (auditoría UX/UI, fase 2,
          28/10/2026). */}
      <Pestanas
        etiqueta="Estructura del organigrama"
        idBase="estr"
        valor={pestana}
        onCambio={(id) => {
          setPestana(id);
          setEditando(null);
          setAviso(null);
          setError(null);
        }}
        opciones={visibles.map(([id, etiqueta]) => ({
          id,
          etiqueta,
          cuenta: id !== "niveles" ? datos?.[id]?.length : undefined,
          unidad: "registros",
        }))}
      />

      <PanelDePestana idBase="estr" valor={pestana} className="mz-stack">
        {/* Mientras llega el organigrama (antes, la pestaña quedaba en blanco). */}
        {datos === null && !error && <EstadoDeCarga cargando />}
        {error && !editando && (
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
                        Ordenan las unidades del organigrama (la Gerencia
                        General arriba y las áreas debajo); no son los niveles
                        de los cargos.
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
                  {pestana === "cargos" && (
                    <>
                      <div className="mz-filter-bar" role="search">
                        <label className="mz-fb-search">
                          <Icon name="search" />
                          <span className="visually-hidden">Buscar cargos</span>
                          <input
                            ref={campoBuscarCargo}
                            type="search"
                            placeholder="Buscar cargo, unidad, jefe o rol"
                            value={buscarCargo}
                            onChange={(event) =>
                              setBuscarCargo(event.target.value)
                            }
                          />
                        </label>
                        <select
                          className="form-select form-select-sm"
                          aria-label="Filtrar por unidad"
                          value={unidadDeCargo}
                          onChange={(event) =>
                            setUnidadDeCargo(event.target.value)
                          }
                        >
                          <option value="">Todas las unidades</option>
                          {unidadesEnOrden(datos).map((unidad) => (
                            <option key={unidad.id} value={String(unidad.id)}>
                              {/* Sangría por nivel: un área y su subárea no se
                                  confunden en una lista de 17. */}
                              {"  ".repeat(unidad.profundidad ?? 0) +
                                unidad.nombre}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="mz-faint mz-small mb-0" aria-hidden="true">
                        {filtrandoCargos
                          ? `${filas.length} de ${datos.cargos.length} cargos`
                          : `${datos.cargos.length} cargos`}
                      </p>
                      <AnuncioDeResultados
                        // Con solo la unidad elegida también se anuncia: el
                        // contador visible va oculto al lector de pantalla.
                        termino={
                          buscarCargo.trim() ||
                          (unidadDeCargo
                            ? (unidadDe(Number(unidadDeCargo)) ?? "")
                            : "")
                        }
                        total={filas.length}
                        de={datos.cargos.length}
                        sustantivo={["cargo", "cargos"]}
                      />
                    </>
                  )}
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
                                <NivelDeCargo
                                  valor={fila.nivel}
                                  datos={datos}
                                />
                              </td>
                            )}
                            {pestana === "cargos" && (
                              <td>
                                {cargoDe(fila.jefe) ?? "—"}
                                {/* El reporte secundario (línea punteada). */}
                                {fila.jefes_secundarios?.length > 0 && (
                                  <span className="d-block mz-small mz-faint">
                                    También reporta a:{" "}
                                    {fila.jefes_secundarios
                                      .map(cargoDe)
                                      .filter(Boolean)
                                      .join(", ")}
                                  </span>
                                )}
                              </td>
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
                                    jefes_secundarios:
                                      fila.jefes_secundarios ?? [],
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
                        <FilaDeEstado
                          columnas={
                            { niveles: 3, unidades: 4, cargos: 7 }[pestana]
                          }
                          vacio={filas.length === 0}
                          hayFiltros={filtrandoCargos}
                          termino={buscarCargo}
                          onLimpiarFiltros={limpiarFiltroCargos}
                          campoBusquedaRef={campoBuscarCargo}
                          etiquetaLimpiar={
                            unidadDeCargo
                              ? "Limpiar filtros"
                              : "Limpiar búsqueda"
                          }
                        />
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              {editando && (
                <Ventana
                  recurso={pestana}
                  valores={editando}
                  error={error}
                  onCerrar={() => {
                    setEditando(null);
                    setError(null);
                  }}
                >
                  <Formulario
                    key={`${pestana}-${editando.id ?? "nuevo"}`}
                    recurso={pestana}
                    inicial={editando}
                    datos={datos}
                    onGuardar={guardar}
                    onCancelar={() => {
                      setEditando(null);
                      setError(null);
                    }}
                  />
                </Ventana>
              )}
            </>
          )}
      </PanelDePestana>
    </div>
  );
}
