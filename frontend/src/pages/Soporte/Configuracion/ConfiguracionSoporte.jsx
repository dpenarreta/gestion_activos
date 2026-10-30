import { useCallback, useEffect, useRef, useState } from "react";

import { Link } from "react-router-dom";

import { apiClient } from "../../../api/client";
import { soporteService } from "../../../api/soporteService";
import { confirmar } from "../../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { mensajeDeError } from "../../../utils/errores";
import { EditorDeAgenda, erroresDeAgenda } from "../EditorDeAgenda";
import {
  CampoDuracion,
  juntarMinutos,
  ListaDeCasillas,
  partirMinutos,
  VentanaDeEdicion,
} from "./piezas";
import "../Soporte.css";

/*
 * Configuración → Mesa de ayuda. Cinco apartados: equipo (niveles y
 * técnicos), categorías y casos (el catálogo de servicios), SLA, horario y
 * metas, y respuestas predefinidas. Todo es de la empresa activa: cada empresa
 * tiene su propio equipo.
 *
 * Auditoría UX/UI (30/10/2026): un solo modo de guardar —con «Guardar» y un
 * aviso de que se guardó— en lugar de celdas y selectores que guardaban
 * solos; casillas en lugar de selectores múltiples; «Cargando…» (antes, un
 * catálogo vacío invitaba a crear duplicados); lo que se desactiva o quita
 * dice qué pasa; y la alerta de las categorías sin técnicos.
 */

const PRIORIDADES = [
  ["critica", "P1 · Crítica"],
  ["alta", "P2 · Alta"],
  ["media", "P3 · Media"],
  ["baja", "P4 · Baja"],
];

const TIPOS = [
  ["incidente", "Incidente"],
  ["solicitud", "Solicitud"],
  ["consulta", "Consulta"],
];

const CASO_NUEVO = {
  codigo: "",
  nombre: "",
  tipo: "incidente",
  prioridad: "media",
};

function useRecurso(recurso) {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const cargar = useCallback(() => {
    soporteService.config
      .listar(recurso)
      .then(setLista)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar la configuración.")),
      );
  }, [recurso]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  /** Guarda, recarga y dice que se guardó (o el error). */
  async function ejecutar(accion, mensaje = "Cambios guardados.") {
    setError(null);
    setAviso(null);
    setGuardando(true);
    try {
      await accion();
      cargar();
      setAviso(mensaje);
      return true;
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar."));
      return false;
    } finally {
      setGuardando(false);
    }
  }
  function limpiar() {
    setError(null);
    setAviso(null);
  }
  return {
    lista,
    error,
    aviso,
    guardando,
    ejecutar,
    limpiar,
    recargar: cargar,
  };
}

function Error({ texto }) {
  if (!texto) return null;
  return (
    <div className="mz-alert mz-alert--bad" role="alert">
      <Icon name="x-octagon" />
      {texto}
    </div>
  );
}

/** El error, el aviso de que se guardó y «Cargando…» de una lista.
 * `parte`: «carga» (arriba: solo «Cargando…» y el error de carga) o
 * «accion» (junto al botón: lo que pasó al guardar). Sin `parte`, todo, y
 * se lleva la vista al aviso para que se vea dónde quedó (verificación
 * UX/UI, 30/10/2026: el aviso salía arriba, lejos de la acción). */
function Resultado({ recurso, parte }) {
  const ref = useRef(null);
  const cargando = recurso.lista === null && !recurso.error;
  const mensajes = parte !== "carga" || recurso.lista === null;
  useEffect(() => {
    if (!parte && (recurso.aviso || recurso.error))
      ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [parte, recurso.aviso, recurso.error]);
  return (
    <div ref={ref}>
      {mensajes && <Error texto={recurso.error} />}
      {mensajes && parte !== "carga" && recurso.aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check2-circle" />
          {recurso.aviso}
        </div>
      )}
      {parte !== "accion" && cargando && <EstadoDeCarga cargando />}
    </div>
  );
}

// --- Equipo: niveles y técnicos ---------------------------------------------------------

export function EquipoSoporte() {
  const niveles = useRecurso("niveles");
  const tecnicos = useRecurso("tecnicos");
  const categorias = useRecurso("categorias");
  const [personas, setPersonas] = useState([]);
  const [editando, setEditando] = useState(null);
  const [nuevoNivel, setNuevoNivel] = useState({ nombre: "", orden: "" });
  const abridor = useRef(null);
  function abrirTecnico(datos) {
    abridor.current = document.activeElement;
    tecnicos.limpiar();
    setEditando(datos);
  }
  function cerrarTecnico() {
    setEditando(null);
    requestAnimationFrame(() => abridor.current?.focus?.());
  }

  useEffect(() => {
    soporteService.config
      .personas()
      .then(setPersonas)
      .catch(() => setPersonas([]));
  }, []);

  return (
    <div className="soporte-page mz-stack">
      <div className="mz-alert mz-alert--info">
        <Icon name="info-circle" />
        <span>
          Las personas piden soporte desde «Soporte TI», con su sesión: sus
          datos de contacto salen de «Mi perfil».
        </span>
      </div>

      <section className="mz-card">
        <div className="mz-card-head">
          <h3>Niveles de escalamiento</h3>
        </div>
        <div className="mz-card-body">
          <Resultado recurso={niveles} />
          <p className="mz-small mz-faint">
            Los tickets nuevos entran al primer nivel. Escalar los pasa al
            siguiente. Los supervisores de cada nivel reciben las alertas y
            escalamientos de SLA.
          </p>
          <div className="mz-table-wrap">
            <table className="mz-table">
              <thead>
                <tr>
                  <th>Orden</th>
                  <th>Nivel</th>
                  <th>Supervisores</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {(niveles.lista ?? []).map((nivel) => (
                  <FilaNivel
                    key={nivel.id}
                    nivel={nivel}
                    personas={personas}
                    recurso={niveles}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <form
            className="row g-2 align-items-end mt-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await niveles.ejecutar(
                  () => soporteService.config.crear("niveles", nuevoNivel),
                  `Nivel «${nuevoNivel.nombre}» agregado.`,
                )
              )
                setNuevoNivel({ nombre: "", orden: "" });
            }}
          >
            <div className="col-4 col-md-2">
              <label className="form-label mz-small" htmlFor="nv-orden">
                Orden
              </label>
              <input
                id="nv-orden"
                type="number"
                min="1"
                className="form-control form-control-sm"
                required
                value={nuevoNivel.orden}
                onChange={(e) =>
                  setNuevoNivel((n) => ({ ...n, orden: e.target.value }))
                }
              />
            </div>
            <div className="col-8 col-md-5">
              <label className="form-label mz-small" htmlFor="nv-nombre">
                Nombre del nivel
              </label>
              <input
                id="nv-nombre"
                className="form-control form-control-sm"
                required
                maxLength={80}
                placeholder="Mesa de ayuda"
                value={nuevoNivel.nombre}
                onChange={(e) =>
                  setNuevoNivel((n) => ({ ...n, nombre: e.target.value }))
                }
              />
            </div>
            <div className="col-12 col-md-2">
              <button
                type="submit"
                className="btn btn-outline-primary btn-sm w-100"
                disabled={niveles.guardando}
              >
                {niveles.guardando ? "Guardando…" : "Agregar nivel"}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="mz-card">
        <div className="mz-card-head">
          <h3>Técnicos</h3>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() =>
              abrirTecnico({
                usuario: "",
                nivel: niveles.lista?.[0]?.id ?? "",
                categorias: [],
                capacidad: 1,
                activo: true,
                horarios: [],
                ausencias: [],
              })
            }
          >
            Agregar técnico
          </button>
        </div>
        <div className="mz-card-body">
          <Resultado
            recurso={tecnicos}
            parte={editando ? "carga" : undefined}
          />
          <div className="mz-table-wrap">
            <table className="mz-table">
              <thead>
                <tr>
                  <th>Técnico</th>
                  <th>Nivel</th>
                  <th>Categorías</th>
                  <th>Capacidad</th>
                  <th>Ahora</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {(tecnicos.lista ?? []).map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.nombre}
                      {!t.activo && (
                        <span className="mz-pill mz-pill--neutral ms-2">
                          Inactivo
                        </span>
                      )}
                      <div className="mz-small mz-faint">{t.correo}</div>
                    </td>
                    <td>
                      {niveles.lista?.find((n) => n.id === t.nivel)?.nombre ??
                        "—"}
                    </td>
                    <td className="mz-small">
                      {t.categorias
                        .map(
                          (id) =>
                            categorias.lista?.find((c) => c.id === id)?.nombre,
                        )
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </td>
                    <td>
                      {t.abiertos} / {t.capacidad}
                    </td>
                    <td>
                      <span
                        className={`mz-pill ${t.en_horario ? "mz-pill--ok" : "mz-pill--neutral"}`}
                      >
                        {t.en_horario ? "En horario" : "Fuera de horario"}
                      </span>
                    </td>
                    <td className="num">
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        aria-label={`Editar a ${t.nombre}`}
                        onClick={() => abrirTecnico(t)}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
                {tecnicos.lista?.length === 0 && (
                  <tr className="mz-empty-row">
                    <td colSpan={6}>Todavía no hay técnicos</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {editando && (
            <FormularioTecnico
              inicial={editando}
              personas={personas}
              niveles={niveles.lista ?? []}
              categorias={categorias.lista ?? []}
              guardando={tecnicos.guardando}
              resultado={<Resultado recurso={tecnicos} parte="accion" />}
              onCancelar={cerrarTecnico}
              onGuardar={async (datos) => {
                const accion = datos.id
                  ? () =>
                      soporteService.config.actualizar(
                        "tecnicos",
                        datos.id,
                        datos,
                      )
                  : () => soporteService.config.crear("tecnicos", datos);
                if (
                  await tecnicos.ejecutar(
                    accion,
                    datos.id ? "Técnico guardado." : "Técnico agregado.",
                  )
                )
                  cerrarTecnico();
              }}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function FilaNivel({ nivel, personas, recurso }) {
  const [editando, setEditando] = useState(false);
  const [supervisores, setSupervisores] = useState(nivel.supervisores);
  const nombres = nivel.supervisores
    .map((id) => personas.find((p) => p.id === id)?.nombre)
    .filter(Boolean);
  return (
    <tr>
      <td className="mz-mono">N{nivel.orden}</td>
      <td>{nivel.nombre}</td>
      <td>
        {nombres.length ? (
          nombres.join(", ")
        ) : (
          <span className="mz-pill mz-pill--warn">Sin supervisores</span>
        )}
      </td>
      <td className="num">
        <div className="mz-actions justify-content-end">
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            aria-label={`Cambiar los supervisores de ${nivel.nombre}`}
            onClick={() => {
              setSupervisores(nivel.supervisores);
              recurso.limpiar();
              setEditando(true);
            }}
          >
            Supervisores
          </button>
          <button
            type="button"
            className="btn btn-outline-danger btn-sm"
            aria-label={`Quitar el nivel ${nivel.nombre}`}
            onClick={async () => {
              const si = await confirmar({
                titulo: `¿Quitar el nivel «${nivel.nombre}»?`,
                mensaje:
                  "Si tiene técnicos o tickets, no se puede quitar: muévalos antes a otro nivel. Los escalamientos ya no pasarán por él.",
                accion: "Quitar",
              });
              if (si) {
                recurso.ejecutar(
                  () => soporteService.config.eliminar("niveles", nivel.id),
                  `Nivel «${nivel.nombre}» quitado.`,
                );
              }
            }}
          >
            Quitar
          </button>
        </div>
        {editando && (
          <VentanaDeEdicion
            titulo={`Supervisores de ${nivel.nombre}`}
            guardando={recurso.guardando}
            error={recurso.error}
            onCerrar={() => setEditando(false)}
            onGuardar={async () => {
              if (
                await recurso.ejecutar(
                  () =>
                    soporteService.config.actualizar("niveles", nivel.id, {
                      supervisores,
                    }),
                  `Supervisores de «${nivel.nombre}» guardados.`,
                )
              )
                setEditando(false);
            }}
          >
            <p className="mz-small mz-faint">
              Reciben las alertas y los escalamientos por plazo de este nivel.
            </p>
            <ListaDeCasillas
              etiqueta="Supervisores"
              opciones={personas}
              valor={supervisores}
              onCambiar={setSupervisores}
              vacio="No hay personas con cuenta."
            />
          </VentanaDeEdicion>
        )}
      </td>
    </tr>
  );
}

function FormularioTecnico({
  inicial,
  personas,
  niveles,
  categorias,
  guardando,
  resultado,
  onGuardar,
  onCancelar,
}) {
  const [valores, setValores] = useState({
    ...inicial,
    horarios: inicial.horarios ?? [],
    ausencias: inicial.ausencias ?? [],
  });
  const [errores, setErrores] = useState(null);
  const [errorPersona, setErrorPersona] = useState(null);
  const titulo = useRef(null);
  const persona = useRef(null);
  const fijar = (campo, valor) => setValores((v) => ({ ...v, [campo]: valor }));

  // El formulario aparece debajo de la tabla: se lleva la vista y el foco
  // (antes, quien no miraba abajo no lo veía).
  useEffect(() => {
    titulo.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    titulo.current?.focus({ preventScroll: true });
  }, [inicial]);

  return (
    <form
      className="mz-card mt-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!valores.usuario) {
          setErrorPersona("Elija la cuenta de la persona.");
          persona.current?.focus();
          return;
        }
        setErrorPersona(null);
        const problemas = erroresDeAgenda(valores.horarios, valores.ausencias);
        setErrores(problemas);
        if (problemas) return;
        onGuardar({
          id: valores.id,
          usuario: Number(valores.usuario),
          nivel: Number(valores.nivel),
          categorias: valores.categorias,
          capacidad: Number(valores.capacidad),
          activo: valores.activo,
          horarios: valores.horarios,
          ausencias: valores.ausencias,
        });
      }}
    >
      <div className="mz-card-head">
        <h3 ref={titulo} tabIndex={-1}>
          {valores.id ? `Editar a ${valores.nombre}` : "Nuevo técnico"}
        </h3>
      </div>
      <div className="mz-card-body row g-3">
        <div className="col-12 col-md-6">
          <label className="form-label" htmlFor="tc-usuario">
            Persona
          </label>
          <select
            id="tc-usuario"
            ref={persona}
            className={`form-select${errorPersona ? " is-invalid" : ""}`}
            aria-required="true"
            aria-invalid={errorPersona ? true : undefined}
            aria-describedby={`tc-usuario-ayuda${errorPersona ? " tc-usuario-error" : ""}`}
            disabled={Boolean(valores.id)}
            value={valores.usuario}
            onChange={(e) => {
              fijar("usuario", e.target.value);
              if (errorPersona) setErrorPersona(null);
            }}
          >
            <option value="">Elija una cuenta</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} {p.correo ? `· ${p.correo}` : ""}
              </option>
            ))}
          </select>
          <div id="tc-usuario-ayuda" className="form-text">
            Necesita además el permiso «Atender tickets» en su rol.
          </div>
          {errorPersona && (
            <div id="tc-usuario-error" className="mz-field-error">
              {errorPersona}
            </div>
          )}
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label" htmlFor="tc-nivel">
            Nivel
          </label>
          <select
            id="tc-nivel"
            className="form-select"
            required
            value={valores.nivel}
            onChange={(e) => fijar("nivel", e.target.value)}
          >
            {niveles.map((n) => (
              <option key={n.id} value={n.id}>
                N{n.orden} · {n.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label" htmlFor="tc-capacidad">
            Tickets a la vez
          </label>
          <input
            id="tc-capacidad"
            type="number"
            min="1"
            max="20"
            className="form-control"
            value={valores.capacidad}
            onChange={(e) => fijar("capacidad", e.target.value)}
          />
        </div>
        <fieldset className="col-12">
          <legend className="form-label">Categorías que puede atender</legend>
          <div className="d-flex flex-wrap gap-3">
            {categorias.map((c) => (
              <div className="form-check" key={c.id}>
                <input
                  id={`tc-cat-${c.id}`}
                  type="checkbox"
                  className="form-check-input"
                  checked={valores.categorias.includes(c.id)}
                  onChange={(e) =>
                    fijar(
                      "categorias",
                      e.target.checked
                        ? [...valores.categorias, c.id]
                        : valores.categorias.filter((id) => id !== c.id),
                    )
                  }
                />
                <label className="form-check-label" htmlFor={`tc-cat-${c.id}`}>
                  {c.nombre}
                </label>
              </div>
            ))}
            {categorias.length === 0 && (
              <span className="mz-small mz-faint">
                Cree categorías primero.
              </span>
            )}
          </div>
        </fieldset>
        <div className="col-12">
          <EditorDeAgenda
            horarios={valores.horarios}
            ausencias={valores.ausencias}
            errores={errores}
            onCambiar={({ horarios, ausencias }) => {
              setValores((v) => ({ ...v, horarios, ausencias }));
              if (errores) setErrores(erroresDeAgenda(horarios, ausencias));
            }}
          />
          {errores && (
            <div className="mz-alert mz-alert--bad mt-2 mb-0" role="alert">
              <Icon name="x-octagon" />
              Revise el horario: hay franjas o fechas marcadas.
            </div>
          )}
        </div>
        <div className="col-12 form-check ms-2">
          <input
            id="tc-activo"
            type="checkbox"
            className="form-check-input"
            checked={valores.activo}
            onChange={(e) => fijar("activo", e.target.checked)}
          />
          <label className="form-check-label" htmlFor="tc-activo">
            Activo (recibe tickets)
          </label>
        </div>
        <div className="col-12">{resultado}</div>
        <div className="col-12 mz-actions justify-content-end">
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onCancelar}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={guardando}
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </form>
  );
}

// --- Categorías y casos -----------------------------------------------------------------

export function CategoriasSoporte() {
  const categorias = useRecurso("categorias");
  const niveles = useRecurso("niveles");
  const [areas, setAreas] = useState([]);
  const [nueva, setNueva] = useState("");

  useEffect(() => {
    apiClient
      .get("/soporte/config/sla/areas/")
      .then((r) => setAreas(r.data))
      .catch(() => setAreas([]));
  }, []);

  const sinTecnicos = (categorias.lista ?? []).filter(
    (c) => c.activa && c.tecnicos.length === 0,
  );

  return (
    <div className="soporte-page mz-stack">
      <Resultado recurso={categorias} />
      {/* Lo que deja tickets sin repartir, a la vista (antes, «0 técnico(s)»
          en letra pequeña). */}
      {sinTecnicos.length > 0 && (
        <div className="mz-alert mz-alert--bad" role="status">
          <Icon name="exclamation-octagon" />
          <span>
            {sinTecnicos.length === 1
              ? `«${sinTecnicos[0].nombre}» no tiene técnicos: sus tickets no se reparten.`
              : `${sinTecnicos.length} categorías no tienen técnicos (${sinTecnicos.map((c) => c.nombre).join(", ")}): sus tickets no se reparten.`}{" "}
            Asígnelos al editar cada técnico en{" "}
            <Link to="/admin/configuracion/soporte">Equipo</Link>.
          </span>
        </div>
      )}
      <p className="mz-faint mb-0">
        El catálogo de servicios. Las categorías dicen qué técnicos atienden
        cada tipo de ticket; cada caso fija el tipo, la prioridad base (la
        matriz impacto × urgencia puede subirla), por qué nivel entra y, si lo
        tiene, un plazo propio de solución o de entrega.
      </p>
      {(categorias.lista ?? []).map((c) => (
        <TarjetaCategoria
          key={c.id}
          categoria={c}
          recurso={categorias}
          niveles={niveles.lista ?? []}
          areas={areas}
        />
      ))}
      <form
        className="mz-card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await categorias.ejecutar(
              () =>
                soporteService.config.crear("categorias", { nombre: nueva }),
              `Categoría «${nueva}» agregada.`,
            )
          )
            setNueva("");
        }}
      >
        <div className="mz-card-body d-flex gap-2 align-items-end">
          <div className="flex-grow-1">
            <label className="form-label" htmlFor="ct-nueva">
              Nueva categoría
            </label>
            <input
              id="ct-nueva"
              className="form-control"
              required
              maxLength={80}
              placeholder="Hardware"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={categorias.guardando}
          >
            {categorias.guardando ? "Guardando…" : "Agregar"}
          </button>
        </div>
      </form>
    </div>
  );
}

const NOMBRE = (lista, valor) =>
  lista.find(([v]) => v === valor)?.[1] ?? valor ?? "—";

function TarjetaCategoria({ categoria, recurso, niveles, areas }) {
  const [caso, setCaso] = useState(CASO_NUEVO);
  const [editando, setEditando] = useState(null);

  async function cambiarCategoria() {
    if (categoria.activa) {
      const si = await confirmar({
        titulo: `¿Desactivar «${categoria.nombre}»?`,
        mensaje:
          "Deja de aparecer en «Soporte TI»: nadie podrá pedir ayuda con ella. Los tickets abiertos siguen igual.",
        accion: "Desactivar",
        peligro: false,
      });
      if (!si) return;
    }
    recurso.ejecutar(
      () =>
        soporteService.config.actualizar("categorias", categoria.id, {
          activa: !categoria.activa,
        }),
      categoria.activa
        ? `«${categoria.nombre}» desactivada.`
        : `«${categoria.nombre}» activada.`,
    );
  }

  async function cambiarCaso(c) {
    if (c.activo) {
      const si = await confirmar({
        titulo: `¿Desactivar el caso «${c.nombre}»?`,
        mensaje:
          "Deja de ofrecerse al pedir ayuda. Los tickets abiertos de este caso siguen igual.",
        accion: "Desactivar",
        peligro: false,
      });
      if (!si) return;
    }
    recurso.ejecutar(
      () =>
        soporteService.config.actualizar("casos", c.id, { activo: !c.activo }),
      c.activo
        ? `Caso «${c.nombre}» desactivado.`
        : `Caso «${c.nombre}» activado.`,
    );
  }

  const nivelDe = (id) => {
    const n = niveles.find((x) => x.id === id);
    return n ? `N${n.orden} · ${n.nombre}` : "Primer nivel";
  };
  const aprueban = (c) =>
    [
      c.aprueba_jefe_area && "Jefe de área",
      ...(c.aprueban ?? []).map((id) => areas.find((a) => a.id === id)?.nombre),
    ]
      .filter(Boolean)
      .join(", ") || "Nadie";

  return (
    <section className="mz-card">
      <div className="mz-card-head">
        <h3>
          {categoria.nombre}
          {!categoria.activa && (
            <span className="mz-pill mz-pill--neutral ms-2">Inactiva</span>
          )}
        </h3>
        <div className="mz-actions">
          {categoria.tecnicos.length === 0 ? (
            <span className="mz-pill mz-pill--bad">
              <Icon name="exclamation-octagon" /> Sin técnicos
            </span>
          ) : (
            <span className="mz-small mz-faint">
              Atienden: {categoria.tecnicos.map((t) => t.nombre).join(", ")}
            </span>
          )}
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            aria-label={`${categoria.activa ? "Desactivar" : "Activar"} la categoría ${categoria.nombre}`}
            onClick={cambiarCategoria}
          >
            {categoria.activa ? "Desactivar" : "Activar"}
          </button>
        </div>
      </div>
      <div className="mz-card-body">
        <div className="mz-table-wrap">
          <table className="mz-table">
            <thead>
              <tr>
                <th>Caso</th>
                <th>Tipo</th>
                <th>Prioridad base</th>
                <th>Entra por</th>
                <th>Plazo de solución</th>
                <th>Aprueban</th>
                <th>
                  <span className="visually-hidden">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {categoria.casos.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.codigo && (
                      <span className="mz-mono me-1">{c.codigo}</span>
                    )}
                    {c.nombre}
                    {!c.activo && (
                      <span className="mz-pill mz-pill--neutral ms-2">
                        Inactivo
                      </span>
                    )}
                  </td>
                  <td>{NOMBRE(TIPOS, c.tipo)}</td>
                  <td>{NOMBRE(PRIORIDADES, c.prioridad)}</td>
                  <td>{nivelDe(c.nivel_inicial)}</td>
                  <td>
                    {c.minutos_plazo
                      ? horasYMinutos(c.minutos_plazo)
                      : "El de su prioridad"}
                  </td>
                  <td className="mz-small">{aprueban(c)}</td>
                  <td className="num">
                    <div className="mz-actions justify-content-end">
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        aria-label={`Editar el caso ${c.nombre}`}
                        onClick={() => {
                          recurso.limpiar();
                          setEditando(c);
                        }}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        aria-label={`${c.activo ? "Desactivar" : "Activar"} el caso ${c.nombre}`}
                        onClick={() => cambiarCaso(c)}
                      >
                        {c.activo ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {categoria.casos.length === 0 && (
                <tr className="mz-empty-row">
                  <td colSpan={7}>
                    Sin casos: nadie podrá elegir esta categoría todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editando && (
          <EditarCaso
            caso={editando}
            niveles={niveles}
            areas={areas}
            recurso={recurso}
            onCerrar={() => setEditando(null)}
          />
        )}
        <form
          className="row g-2 align-items-end mt-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await recurso.ejecutar(
                () =>
                  soporteService.config.crear("casos", {
                    ...caso,
                    categoria: categoria.id,
                  }),
                `Caso «${caso.nombre}» agregado.`,
              )
            )
              setCaso(CASO_NUEVO);
          }}
        >
          <div className="col-6 col-md-2">
            <label
              className="form-label mz-small"
              htmlFor={`cs-codigo-${categoria.id}`}
            >
              Código
            </label>
            <input
              id={`cs-codigo-${categoria.id}`}
              className="form-control form-control-sm"
              maxLength={20}
              placeholder="TRK-06"
              value={caso.codigo}
              onChange={(e) =>
                setCaso((v) => ({ ...v, codigo: e.target.value.toUpperCase() }))
              }
            />
          </div>
          <div className="col-6 col-md-2">
            <label
              className="form-label mz-small"
              htmlFor={`cs-tipo-${categoria.id}`}
            >
              Tipo
            </label>
            <select
              id={`cs-tipo-${categoria.id}`}
              className="form-select form-select-sm"
              value={caso.tipo}
              onChange={(e) => setCaso((v) => ({ ...v, tipo: e.target.value }))}
            >
              {TIPOS.map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>
                  {etiqueta}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12 col-md-3">
            <label
              className="form-label mz-small"
              htmlFor={`cs-nombre-${categoria.id}`}
            >
              Nuevo caso
            </label>
            <input
              id={`cs-nombre-${categoria.id}`}
              className="form-control form-control-sm"
              required
              maxLength={120}
              placeholder="El equipo no enciende"
              value={caso.nombre}
              onChange={(e) =>
                setCaso((v) => ({ ...v, nombre: e.target.value }))
              }
            />
          </div>
          <div className="col-6 col-md-3">
            <label
              className="form-label mz-small"
              htmlFor={`cs-prioridad-${categoria.id}`}
            >
              Prioridad base
            </label>
            <select
              id={`cs-prioridad-${categoria.id}`}
              className="form-select form-select-sm"
              value={caso.prioridad}
              onChange={(e) =>
                setCaso((v) => ({ ...v, prioridad: e.target.value }))
              }
            >
              {PRIORIDADES.map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>
                  {etiqueta}
                </option>
              ))}
            </select>
          </div>
          <div className="col-6 col-md-2">
            <button
              type="submit"
              className="btn btn-outline-primary btn-sm w-100"
              disabled={recurso.guardando}
            >
              {recurso.guardando ? "Guardando…" : "Agregar caso"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

/** Editar un caso en su ventana, con «Guardar» (antes, cada celda de la
 * tabla guardaba sola al cambiarla, sin aviso ni forma de deshacer). */
function EditarCaso({ caso, niveles, areas, recurso, onCerrar }) {
  const [valores, setValores] = useState({
    nombre: caso.nombre,
    tipo: caso.tipo,
    prioridad: caso.prioridad,
    nivel_inicial: caso.nivel_inicial ?? "",
    plazo: partirMinutos(caso.minutos_plazo),
    aprueba_jefe_area: Boolean(caso.aprueba_jefe_area),
    aprueban: caso.aprueban ?? [],
  });
  const [errorPlazo, setErrorPlazo] = useState(null);
  const fijar = (campo) => (e) =>
    setValores((v) => ({
      ...v,
      [campo]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  async function guardar() {
    const minutos = juntarMinutos(valores.plazo);
    if (
      minutos !== null &&
      (minutos < 5 ||
        Number(valores.plazo.horas) < 0 ||
        Number(valores.plazo.minutos) < 0)
    ) {
      setErrorPlazo("Déjelo vacío o ponga al menos 5 minutos.");
      return;
    }
    setErrorPlazo(null);
    const hecho = await recurso.ejecutar(
      () =>
        soporteService.config.actualizar("casos", caso.id, {
          nombre: valores.nombre,
          tipo: valores.tipo,
          prioridad: valores.prioridad,
          nivel_inicial: valores.nivel_inicial || null,
          minutos_plazo: minutos,
          aprueba_jefe_area: valores.aprueba_jefe_area,
          aprueban: valores.aprueban,
        }),
      `Caso «${valores.nombre}» guardado.`,
    );
    if (hecho) onCerrar();
  }

  return (
    <VentanaDeEdicion
      titulo={`Editar el caso «${caso.nombre}»`}
      ancha
      guardando={recurso.guardando}
      error={recurso.error}
      onCerrar={onCerrar}
      onGuardar={guardar}
    >
      <p className="mz-small mz-faint">
        Los cambios rigen para los tickets nuevos; los abiertos conservan su
        prioridad y su plazo.
      </p>
      <div className="row g-3">
        <div className="col-12">
          <label className="form-label" htmlFor="ec-nombre">
            Nombre
          </label>
          <input
            id="ec-nombre"
            className="form-control form-control-sm"
            maxLength={120}
            value={valores.nombre}
            data-autofocus
            onChange={fijar("nombre")}
          />
        </div>
        <div className="col-6 col-md-4">
          <label className="form-label" htmlFor="ec-tipo">
            Tipo
          </label>
          <select
            id="ec-tipo"
            className="form-select form-select-sm"
            value={valores.tipo}
            onChange={fijar("tipo")}
          >
            {TIPOS.map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </select>
        </div>
        <div className="col-6 col-md-4">
          <label className="form-label" htmlFor="ec-prioridad">
            Prioridad base
          </label>
          <select
            id="ec-prioridad"
            className="form-select form-select-sm"
            value={valores.prioridad}
            onChange={fijar("prioridad")}
          >
            {PRIORIDADES.map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </select>
        </div>
        <div className="col-12 col-md-4">
          <label className="form-label" htmlFor="ec-nivel">
            Entra por
          </label>
          <select
            id="ec-nivel"
            className="form-select form-select-sm"
            value={valores.nivel_inicial}
            onChange={fijar("nivel_inicial")}
          >
            <option value="">Primer nivel</option>
            {niveles.map((n) => (
              <option key={n.id} value={n.id}>
                N{n.orden} · {n.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="col-12">
          <CampoDuracion
            id="ec-plazo"
            etiqueta="Plazo propio de solución (opcional)"
            valor={valores.plazo}
            onCambiar={(plazo) => setValores((v) => ({ ...v, plazo }))}
            ayuda="Vacío: rige el plazo de su prioridad o de las reglas de tiempo."
            error={errorPlazo}
          />
        </div>
        <div className="col-12">
          <div className="form-check mb-2">
            <input
              id="ec-jefe"
              type="checkbox"
              className="form-check-input"
              checked={valores.aprueba_jefe_area}
              onChange={fijar("aprueba_jefe_area")}
            />
            <label className="form-check-label" htmlFor="ec-jefe">
              Lo aprueba el jefe de área de quien pide
            </label>
          </div>
          <ListaDeCasillas
            etiqueta="Áreas que además lo aprueban"
            opciones={areas}
            valor={valores.aprueban}
            onCambiar={(aprueban) => setValores((v) => ({ ...v, aprueban }))}
            vacio="No hay áreas."
          />
        </div>
      </div>
    </VentanaDeEdicion>
  );
}

// --- SLA --------------------------------------------------------------------------------

function horasYMinutos(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return (
    [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ") ||
    "0 min"
  );
}

const PLAZOS_BASE = [
  ["critica", 15, 4 * 60],
  ["alta", 30, 8 * 60],
  ["media", 2 * 60, 16 * 60],
  ["baja", 4 * 60, 40 * 60],
];

const REGLA_VACIA = {
  id: null,
  categoria: "",
  area: "",
  prioridad: "",
  respuesta: { horas: "", minutos: "" },
  solucion: { horas: "", minutos: "" },
};

export function SlaSoporte() {
  const reglas = useRecurso("sla");
  const categorias = useRecurso("categorias");
  const [areas, setAreas] = useState([]);
  const [regla, setRegla] = useState(REGLA_VACIA);
  const [errorSolucion, setErrorSolucion] = useState(null);
  const [errorRespuesta, setErrorRespuesta] = useState(null);
  const formulario = useRef(null);

  useEffect(() => {
    apiClient
      .get("/soporte/config/sla/areas/")
      .then((r) => setAreas(r.data))
      .catch(() => setAreas([]));
  }, []);

  function editar(r) {
    setRegla({
      id: r.id,
      categoria: r.categoria ?? "",
      area: r.area ?? "",
      prioridad: r.prioridad ?? "",
      respuesta: partirMinutos(r.minutos_respuesta),
      solucion: partirMinutos(r.minutos),
    });
    setErrorSolucion(null);
    formulario.current?.scrollIntoView?.({ block: "center" });
    formulario.current?.querySelector("select")?.focus();
  }

  async function guardar(evento) {
    evento.preventDefault();
    // Lo que el servidor rechazaría, dicho aquí y bajo su campo.
    const minutos = juntarMinutos(regla.solucion);
    const respuesta = juntarMinutos(regla.respuesta);
    const negativo = (d) => Number(d.horas) < 0 || Number(d.minutos) < 0;
    const problemaSolucion =
      minutos === null || minutos === 0
        ? "Ponga el plazo de solución."
        : negativo(regla.solucion)
          ? "Las horas y los minutos no pueden ser negativos."
          : minutos < 5
            ? "El plazo de solución es de al menos 5 minutos."
            : null;
    const problemaRespuesta =
      respuesta === null
        ? null
        : negativo(regla.respuesta)
          ? "Las horas y los minutos no pueden ser negativos."
          : respuesta < 1
            ? "Déjelo vacío o ponga al menos 1 minuto."
            : minutos && respuesta >= minutos
              ? "Debe ser menor que el plazo de solución."
              : null;
    setErrorSolucion(problemaSolucion);
    setErrorRespuesta(problemaRespuesta);
    if (problemaSolucion || problemaRespuesta) return;
    const datos = {
      categoria: regla.categoria || null,
      area: regla.area || null,
      prioridad: regla.prioridad,
      minutos,
      minutos_respuesta: respuesta,
    };
    const hecho = await reglas.ejecutar(
      () =>
        regla.id
          ? soporteService.config.actualizar("sla", regla.id, datos)
          : soporteService.config.crear("sla", datos),
      regla.id ? "Regla guardada." : "Regla agregada.",
    );
    if (hecho) setRegla(REGLA_VACIA);
  }

  return (
    <div className="soporte-page mz-stack">
      <Resultado recurso={reglas} parte="carga" />
      <p className="mz-faint mb-0">
        Los plazos corren desde que se crea el ticket: la respuesta, hasta la
        primera respuesta del equipo; la solución, hasta que se atiende. Los P1
        se cuentan en horas calendario y los demás en el horario hábil de la
        mesa (ver «Horario y metas»). Gana el plazo propio del caso; si no, la
        regla más específica (categoría, área y prioridad; vacío es
        «cualquiera»); sin reglas, los de cada prioridad:
      </p>
      {/* Los plazos que rigen sin reglas, en una tabla y no en un párrafo. */}
      <div className="mz-table-wrap">
        <table className="mz-table soporte-plazos-base">
          <caption className="soporte-titulo-tabla text-start">
            Plazos de cada prioridad
          </caption>
          <thead>
            <tr>
              <th>Prioridad</th>
              <th>Responder en</th>
              <th>Solucionar en</th>
            </tr>
          </thead>
          <tbody>
            {PLAZOS_BASE.map(([valor, respuesta, solucion]) => (
              <tr key={valor}>
                <td>{NOMBRE(PRIORIDADES, valor)}</td>
                <td>{horasYMinutos(respuesta)}</td>
                <td>{horasYMinutos(solucion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mz-table-wrap">
        <table className="mz-table">
          <caption className="soporte-titulo-tabla text-start">
            Reglas de tiempo
          </caption>
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Área solicitante</th>
              <th>Prioridad</th>
              <th>Respuesta</th>
              <th>Solución</th>
              <th>
                <span className="visually-hidden">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(reglas.lista ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.categoria_nombre || "Cualquiera"}</td>
                <td>{r.area_nombre || "Cualquiera"}</td>
                <td>{r.prioridad_display || "Cualquiera"}</td>
                <td>
                  {r.minutos_respuesta
                    ? horasYMinutos(r.minutos_respuesta)
                    : "La de su prioridad"}
                </td>
                <td>{horasYMinutos(r.minutos)}</td>
                <td className="num">
                  <div className="mz-actions justify-content-end">
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm"
                      aria-label={`Editar la regla ${r.categoria_nombre || "de cualquier categoría"} · ${r.prioridad_display || "cualquier prioridad"}`}
                      onClick={() => editar(r)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      aria-label={`Quitar la regla ${r.categoria_nombre || "de cualquier categoría"} · ${r.prioridad_display || "cualquier prioridad"}`}
                      onClick={async () => {
                        const si = await confirmar({
                          titulo: "¿Quitar esta regla de tiempo?",
                          mensaje:
                            "Los tickets nuevos usarán la regla siguiente más específica o el plazo de su prioridad. Los abiertos conservan el suyo.",
                          accion: "Quitar",
                        });
                        if (si) {
                          reglas.ejecutar(
                            () => soporteService.config.eliminar("sla", r.id),
                            "Regla quitada.",
                          );
                        }
                      }}
                    >
                      Quitar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {reglas.lista?.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={6}>
                  Sin reglas: rigen los plazos de cada prioridad
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <form className="mz-card" ref={formulario} onSubmit={guardar} noValidate>
        <div className="mz-card-head">
          <h3>{regla.id ? "Editar la regla" : "Nueva regla de tiempo"}</h3>
        </div>
        <div className="mz-card-body row g-2 align-items-start">
          <div className="col-12 col-md-4">
            <label className="form-label mz-small" htmlFor="sla-categoria">
              Categoría
            </label>
            <select
              id="sla-categoria"
              className="form-select form-select-sm"
              value={regla.categoria}
              onChange={(e) =>
                setRegla((v) => ({ ...v, categoria: e.target.value }))
              }
            >
              <option value="">Cualquiera</option>
              {(categorias.lista ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12 col-md-4">
            <label className="form-label mz-small" htmlFor="sla-area">
              Área solicitante
            </label>
            <select
              id="sla-area"
              className="form-select form-select-sm"
              value={regla.area}
              onChange={(e) =>
                setRegla((v) => ({ ...v, area: e.target.value }))
              }
            >
              <option value="">Cualquiera</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12 col-md-4">
            <label className="form-label mz-small" htmlFor="sla-prioridad">
              Prioridad
            </label>
            <select
              id="sla-prioridad"
              className="form-select form-select-sm"
              value={regla.prioridad}
              onChange={(e) =>
                setRegla((v) => ({ ...v, prioridad: e.target.value }))
              }
            >
              <option value="">Cualquiera</option>
              {PRIORIDADES.map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>
                  {etiqueta}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12 col-md-6">
            <CampoDuracion
              id="sla-respuesta"
              etiqueta="Responder en (opcional)"
              valor={regla.respuesta}
              onCambiar={(respuesta) => {
                setRegla((v) => ({ ...v, respuesta }));
                if (errorRespuesta) setErrorRespuesta(null);
              }}
              ayuda="Vacío: el de su prioridad."
              error={errorRespuesta}
            />
          </div>
          <div className="col-12 col-md-6">
            <CampoDuracion
              id="sla-solucion"
              etiqueta="Solucionar en"
              obligatorio
              valor={regla.solucion}
              onCambiar={(solucion) => {
                setRegla((v) => ({ ...v, solucion }));
                if (errorSolucion) setErrorSolucion(null);
              }}
              error={errorSolucion}
            />
          </div>
          <div className="col-12">
            <Resultado recurso={reglas} parte="accion" />
          </div>
          <div className="col-12 mz-actions justify-content-end">
            {regla.id && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setRegla(REGLA_VACIA)}
              >
                Cancelar
              </button>
            )}
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={reglas.guardando}
            >
              {reglas.guardando
                ? "Guardando…"
                : regla.id
                  ? "Guardar cambios"
                  : "Agregar regla"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// --- Horario y metas -------------------------------------------------------------------

/** El horario hábil de la mesa (mide los plazos de P2 a P4 y el cierre
 * automático), sus feriados, las metas de cumplimiento y si los P1 corren las
 * 24 horas. */
export function HorarioMesaSoporte() {
  const [mesa, setMesa] = useState(null);
  const [error, setError] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [errores, setErrores] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(() => {
    setErrorCarga(null);
    soporteService.config
      .mesa()
      .then(setMesa)
      .catch((err) =>
        setErrorCarga(
          mensajeDeError(err, "No se pudo cargar la configuración."),
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardar(evento) {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    const problemas = erroresDeAgenda(mesa.horarios, mesa.feriados);
    setErrores(problemas);
    if (problemas) {
      setError("Revise el horario: hay franjas o fechas marcadas.");
      return;
    }
    setGuardando(true);
    try {
      setMesa(
        await soporteService.config.guardarMesa({
          meta_sla: Number(mesa.meta_sla),
          meta_sla_critica: Number(mesa.meta_sla_critica),
          critica_24x7: mesa.critica_24x7,
          etiquetas: mesa.etiquetas,
          horarios: mesa.horarios,
          feriados: mesa.feriados,
        }),
      );
      setAviso(
        "Guardado. Rige para los tickets nuevos y para los que reanudan su plazo.",
      );
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar."));
    } finally {
      setGuardando(false);
    }
  }

  if (!mesa)
    return (
      <EstadoDeCarga
        cargando={!errorCarga}
        error={errorCarga}
        onReintentar={cargar}
      />
    );

  return (
    <form className="soporte-page mz-stack" onSubmit={guardar} noValidate>
      <section className="mz-card">
        <div className="mz-card-head">
          <h3>Metas y P1</h3>
        </div>
        <div className="mz-card-body row g-3">
          <div className="col-6 col-md-3">
            <label className="form-label" htmlFor="ms-meta">
              Meta de cumplimiento (%)
            </label>
            <input
              id="ms-meta"
              type="number"
              min="1"
              max="100"
              className="form-control"
              required
              value={mesa.meta_sla}
              onChange={(e) => setMesa({ ...mesa, meta_sla: e.target.value })}
            />
          </div>
          <div className="col-6 col-md-3">
            <label className="form-label" htmlFor="ms-meta-p1">
              Meta de los P1 (%)
            </label>
            <input
              id="ms-meta-p1"
              type="number"
              min="1"
              max="100"
              className="form-control"
              required
              value={mesa.meta_sla_critica}
              onChange={(e) =>
                setMesa({ ...mesa, meta_sla_critica: e.target.value })
              }
            />
          </div>
          <div className="col-12 col-md-6 d-flex align-items-end">
            <div className="form-check">
              <input
                id="ms-24x7"
                type="checkbox"
                className="form-check-input"
                checked={mesa.critica_24x7}
                onChange={(e) =>
                  setMesa({ ...mesa, critica_24x7: e.target.checked })
                }
              />
              <label className="form-check-label" htmlFor="ms-24x7">
                Los P1 se miden en horas calendario (24/7)
              </label>
            </div>
          </div>
        </div>
      </section>
      <section className="mz-card">
        <div className="mz-card-head">
          <h3>Nombres de estados y prioridades</h3>
        </div>
        <div className="mz-card-body row g-3">
          <p className="col-12 mz-small mz-faint mb-0">
            Cómo se llaman en las pantallas, los correos y los reportes. Vacío:
            el nombre de siempre.
          </p>
          {[
            ["estados", "Estados"],
            ["prioridades", "Prioridades"],
          ].map(([grupo, titulo]) => (
            <fieldset key={grupo} className="col-12 col-md-6">
              <legend className="form-label">{titulo}</legend>
              {Object.entries(mesa.etiquetas_por_defecto?.[grupo] ?? {}).map(
                ([valor, porDefecto]) => (
                  <div key={valor} className="soporte-nombre">
                    <label
                      className="mz-small"
                      htmlFor={`ms-${grupo}-${valor}`}
                    >
                      {porDefecto}
                    </label>
                    <input
                      id={`ms-${grupo}-${valor}`}
                      className="form-control form-control-sm"
                      maxLength={40}
                      placeholder={porDefecto}
                      value={mesa.etiquetas?.[grupo]?.[valor] ?? ""}
                      onChange={(e) =>
                        setMesa({
                          ...mesa,
                          etiquetas: {
                            ...mesa.etiquetas,
                            [grupo]: {
                              ...(mesa.etiquetas?.[grupo] ?? {}),
                              [valor]: e.target.value,
                            },
                          },
                        })
                      }
                    />
                  </div>
                ),
              )}
            </fieldset>
          ))}
        </div>
      </section>
      <section className="mz-card">
        <div className="mz-card-head">
          <h3>Horario hábil y feriados</h3>
        </div>
        <div className="mz-card-body">
          {mesa.horario_por_defecto && (
            <p className="mz-small mz-faint">
              Rige el horario por defecto (lunes a viernes, 08:00 a 17:30) hasta
              que guarde uno.
            </p>
          )}
          <EditorDeAgenda
            horarios={mesa.horarios}
            ausencias={mesa.feriados}
            errores={errores}
            onCambiar={({ horarios, ausencias }) => {
              setMesa({ ...mesa, horarios, feriados: ausencias });
              if (errores) setErrores(erroresDeAgenda(horarios, ausencias));
            }}
            textos={{
              horario: "Horario hábil de la mesa",
              sinFranjas: "Sin franjas: rige el horario por defecto.",
              ausencias: "Feriados y cierres (no cuentan para los plazos)",
            }}
          />
        </div>
      </section>
      {/* El resultado, junto al botón (antes, arriba de todo). */}
      <Error texto={error} />
      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check2-circle" />
          {aviso}
        </div>
      )}
      <div className="mz-actions justify-content-end">
        <button type="submit" className="btn btn-primary" disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );
}

// --- Respuestas predefinidas ------------------------------------------------------------

const RESPUESTA_VACIA = { id: null, atajo: "", titulo: "", texto: "" };

/** El texto de la respuesta con datos de ejemplo, como lo leerá el usuario. */
function vistaPrevia(texto) {
  const ejemplo = {
    nombre: "Carla Ordóñez",
    numero: "TCK-2026-000042",
    caso: "El equipo no enciende",
    tecnico: "Jorge Andrade",
  };
  return texto.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_, clave) => ejemplo[clave] ?? `{{${clave}}}`,
  );
}

const VARIABLES = new Set(["nombre", "numero", "caso", "tecnico"]);

/** Las {{variables}} que no existen: el usuario vería las llaves. */
function desconocidas(texto) {
  return [
    ...new Set(
      [...texto.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
        .map((m) => m[1])
        .filter((v) => !VARIABLES.has(v)),
    ),
  ];
}

export function RespuestasSoporte() {
  const respuestas = useRecurso("respuestas");
  const [nueva, setNueva] = useState(RESPUESTA_VACIA);
  const formulario = useRef(null);

  function editar(r) {
    setNueva({ id: r.id, atajo: r.atajo, titulo: r.titulo, texto: r.texto });
    formulario.current?.scrollIntoView?.({ block: "center" });
    formulario.current?.querySelector("input")?.focus();
  }

  return (
    <div className="soporte-page mz-stack">
      <Resultado recurso={respuestas} parte="carga" />
      <p className="mz-faint mb-0">
        Se insertan al responder un ticket escribiendo «/» y el atajo. Pueden
        usar <code>{"{{nombre}}"}</code>, <code>{"{{numero}}"}</code>,{" "}
        <code>{"{{caso}}"}</code> y <code>{"{{tecnico}}"}</code>.
      </p>
      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Atajo</th>
              <th>Título</th>
              <th>Texto</th>
              <th>
                <span className="visually-hidden">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(respuestas.lista ?? []).map((r) => (
              <tr key={r.id}>
                <td className="mz-mono">/{r.atajo}</td>
                <td>{r.titulo}</td>
                <td className="mz-small">{r.texto}</td>
                <td className="num">
                  <div className="mz-actions justify-content-end">
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm"
                      aria-label={`Editar la respuesta ${r.titulo}`}
                      onClick={() => editar(r)}
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      aria-label={`Quitar la respuesta ${r.titulo}`}
                      onClick={async () => {
                        const si = await confirmar({
                          titulo: `¿Quitar la respuesta «${r.titulo}»?`,
                          accion: "Quitar",
                        });
                        if (si) {
                          respuestas.ejecutar(
                            () =>
                              soporteService.config.eliminar(
                                "respuestas",
                                r.id,
                              ),
                            "Respuesta quitada.",
                          );
                        }
                      }}
                    >
                      Quitar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {respuestas.lista?.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={4}>Todavía no hay respuestas predefinidas</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <form
        className="mz-card"
        ref={formulario}
        onSubmit={async (e) => {
          e.preventDefault();
          const { id, ...datos } = nueva;
          if (
            await respuestas.ejecutar(
              () =>
                id
                  ? soporteService.config.actualizar("respuestas", id, datos)
                  : soporteService.config.crear("respuestas", datos),
              id ? "Respuesta guardada." : "Respuesta agregada.",
            )
          )
            setNueva(RESPUESTA_VACIA);
        }}
      >
        <div className="mz-card-head">
          <h3>{nueva.id ? "Editar la respuesta" : "Nueva respuesta"}</h3>
        </div>
        <div className="mz-card-body row g-2">
          <div className="col-6 col-md-3">
            <label className="form-label mz-small" htmlFor="rp-atajo">
              Atajo
            </label>
            <input
              id="rp-atajo"
              className="form-control form-control-sm"
              required
              maxLength={40}
              pattern="[a-z0-9_-]+"
              placeholder="reinicio"
              aria-describedby="rp-atajo-ayuda"
              value={nueva.atajo}
              onChange={(e) =>
                setNueva((v) => ({ ...v, atajo: e.target.value.toLowerCase() }))
              }
            />
            <div id="rp-atajo-ayuda" className="form-text">
              Minúsculas, números, «-» o «_».
            </div>
          </div>
          <div className="col-6 col-md-9">
            <label className="form-label mz-small" htmlFor="rp-titulo">
              Título
            </label>
            <input
              id="rp-titulo"
              className="form-control form-control-sm"
              required
              maxLength={120}
              value={nueva.titulo}
              onChange={(e) =>
                setNueva((v) => ({ ...v, titulo: e.target.value }))
              }
            />
          </div>
          <div className="col-12">
            <label className="form-label mz-small" htmlFor="rp-texto">
              Texto
            </label>
            <textarea
              id="rp-texto"
              className="form-control form-control-sm"
              rows={3}
              required
              value={nueva.texto}
              onChange={(e) =>
                setNueva((v) => ({ ...v, texto: e.target.value }))
              }
            />
          </div>
          {nueva.texto.trim() && (
            <div className="col-12">
              <p className="form-label mz-small mb-1">
                Así lo leerá el usuario (con datos de ejemplo)
              </p>
              <blockquote className="soporte-vista-previa mb-0">
                {vistaPrevia(nueva.texto)}
              </blockquote>
              {desconocidas(nueva.texto).length > 0 && (
                <p className="mz-field-error mt-1 mb-0">
                  {desconocidas(nueva.texto)
                    .map((v) => `{{${v}}}`)
                    .join(", ")}{" "}
                  no{" "}
                  {desconocidas(nueva.texto).length === 1
                    ? "es una variable"
                    : "son variables"}
                  : se verá tal cual.
                </p>
              )}
            </div>
          )}
          <div className="col-12">
            <Resultado recurso={respuestas} parte="accion" />
          </div>
          <div className="col-12 mz-actions justify-content-end">
            {nueva.id && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setNueva(RESPUESTA_VACIA)}
              >
                Cancelar
              </button>
            )}
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={respuestas.guardando}
            >
              {respuestas.guardando
                ? "Guardando…"
                : nueva.id
                  ? "Guardar cambios"
                  : "Agregar respuesta"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
