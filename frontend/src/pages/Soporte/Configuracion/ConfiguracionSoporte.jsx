import { useCallback, useEffect, useState } from "react";

import { apiClient } from "../../../api/client";
import { soporteService } from "../../../api/soporteService";
import { Icon } from "../../../components/common/Icon/Icon";
import { mensajeDeError } from "../../../utils/errores";
import { EditorDeAgenda } from "../EditorDeAgenda";
import "../Soporte.css";

/*
 * Configuración → Mesa de ayuda. Cuatro apartados: equipo (niveles y
 * técnicos), categorías y casos, SLA y respuestas predefinidas. Todo es de la
 * empresa activa: cada empresa tiene su propio equipo.
 */

const PRIORIDADES = [
  ["critica", "Crítica"],
  ["alta", "Alta"],
  ["media", "Media"],
  ["baja", "Baja"],
];

function useRecurso(recurso) {
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(null);
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

  async function ejecutar(accion) {
    setError(null);
    try {
      await accion();
      cargar();
      return true;
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar."));
      return false;
    }
  }
  return { lista, error, ejecutar, recargar: cargar };
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

// --- Equipo: niveles y técnicos ---------------------------------------------------------

export function EquipoSoporte() {
  const niveles = useRecurso("niveles");
  const tecnicos = useRecurso("tecnicos");
  const categorias = useRecurso("categorias");
  const [personas, setPersonas] = useState([]);
  const [enlace, setEnlace] = useState(null);
  const [editando, setEditando] = useState(null);
  const [nuevoNivel, setNuevoNivel] = useState({ nombre: "", orden: "" });

  useEffect(() => {
    soporteService.config
      .personas()
      .then(setPersonas)
      .catch(() => setPersonas([]));
    apiClient
      .get("/soporte/config/niveles/formulario/")
      .then((r) =>
        setEnlace(
          r.data.codigo
            ? `${window.location.origin}/soporte/${r.data.codigo}`
            : null,
        ),
      )
      .catch(() => setEnlace(null));
  }, []);

  return (
    <div className="soporte-page mz-stack">
      {enlace && (
        <div className="mz-alert mz-alert--info">
          <Icon name="link-45deg" />
          <span>
            Formulario público de esta empresa:{" "}
            <a
              href={enlace}
              target="_blank"
              rel="noreferrer"
              className="mz-mono"
            >
              {enlace}
            </a>
            . Compártalo con los empleados para que creen sus tickets.
          </span>
        </div>
      )}

      <section className="mz-card">
        <div className="mz-card-head">
          <h3>Niveles de escalamiento</h3>
        </div>
        <div className="mz-card-body">
          <Error texto={niveles.error} />
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
                await niveles.ejecutar(() =>
                  soporteService.config.crear("niveles", nuevoNivel),
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
                placeholder="N1 · Mesa de ayuda"
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
              >
                Agregar nivel
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
              setEditando({
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
          <Error texto={tecnicos.error} />
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
                        onClick={() => setEditando(t)}
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
              onCancelar={() => setEditando(null)}
              onGuardar={async (datos) => {
                const accion = datos.id
                  ? () =>
                      soporteService.config.actualizar(
                        "tecnicos",
                        datos.id,
                        datos,
                      )
                  : () => soporteService.config.crear("tecnicos", datos);
                if (await tecnicos.ejecutar(accion)) setEditando(null);
              }}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function FilaNivel({ nivel, personas, recurso }) {
  const [supervisores, setSupervisores] = useState(nivel.supervisores);
  return (
    <tr>
      <td className="mz-mono">N{nivel.orden}</td>
      <td>{nivel.nombre}</td>
      <td>
        <select
          multiple
          className="form-select form-select-sm"
          aria-label={`Supervisores de ${nivel.nombre}`}
          value={supervisores.map(String)}
          onChange={(e) =>
            setSupervisores(
              Array.from(e.target.selectedOptions).map((o) => Number(o.value)),
            )
          }
        >
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </td>
      <td className="num">
        <div className="mz-actions justify-content-end">
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={() =>
              recurso.ejecutar(() =>
                soporteService.config.actualizar("niveles", nivel.id, {
                  supervisores,
                }),
              )
            }
          >
            Guardar
          </button>
          <button
            type="button"
            className="btn btn-outline-danger btn-sm"
            onClick={() =>
              recurso.ejecutar(() =>
                soporteService.config.eliminar("niveles", nivel.id),
              )
            }
          >
            Quitar
          </button>
        </div>
      </td>
    </tr>
  );
}

function FormularioTecnico({
  inicial,
  personas,
  niveles,
  categorias,
  onGuardar,
  onCancelar,
}) {
  const [valores, setValores] = useState({
    ...inicial,
    horarios: inicial.horarios ?? [],
    ausencias: inicial.ausencias ?? [],
  });
  const fijar = (campo, valor) => setValores((v) => ({ ...v, [campo]: valor }));

  return (
    <form
      className="mz-card mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        onGuardar({
          id: valores.id,
          usuario: Number(valores.usuario),
          nivel: Number(valores.nivel),
          categorias: valores.categorias,
          capacidad: Number(valores.capacidad),
          activo: valores.activo,
          horarios: valores.horarios,
          ausencias: valores.ausencias.filter((a) => a.desde && a.hasta),
        });
      }}
    >
      <div className="mz-card-head">
        <h3>{valores.id ? `Editar a ${valores.nombre}` : "Nuevo técnico"}</h3>
      </div>
      <div className="mz-card-body row g-3">
        <div className="col-12 col-md-6">
          <label className="form-label" htmlFor="tc-usuario">
            Persona
          </label>
          <select
            id="tc-usuario"
            className="form-select"
            required
            disabled={Boolean(valores.id)}
            value={valores.usuario}
            onChange={(e) => fijar("usuario", e.target.value)}
          >
            <option value="">Elija una cuenta</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} {p.correo ? `· ${p.correo}` : ""}
              </option>
            ))}
          </select>
          <div className="form-text">
            Necesita además el permiso «Atender tickets» en su rol.
          </div>
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
            onCambiar={({ horarios, ausencias }) =>
              setValores((v) => ({ ...v, horarios, ausencias }))
            }
          />
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
        <div className="col-12 mz-actions justify-content-end">
          <button
            type="button"
            className="btn btn-cancelar"
            onClick={onCancelar}
          >
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary">
            Guardar
          </button>
        </div>
      </div>
    </form>
  );
}

// --- Categorías y casos -----------------------------------------------------------------

export function CategoriasSoporte() {
  const categorias = useRecurso("categorias");
  const [nueva, setNueva] = useState("");

  return (
    <div className="soporte-page mz-stack">
      <Error texto={categorias.error} />
      <p className="mz-faint mb-0">
        Las categorías ordenan los tickets y dicen qué técnicos los pueden
        atender. Cada caso de ayuda fija la prioridad del ticket.
      </p>
      {(categorias.lista ?? []).map((c) => (
        <TarjetaCategoria key={c.id} categoria={c} recurso={categorias} />
      ))}
      <form
        className="mz-card"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await categorias.ejecutar(() =>
              soporteService.config.crear("categorias", { nombre: nueva }),
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
          <button type="submit" className="btn btn-primary">
            Agregar
          </button>
        </div>
      </form>
    </div>
  );
}

function TarjetaCategoria({ categoria, recurso }) {
  const [caso, setCaso] = useState({ nombre: "", prioridad: "media" });
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
          <span className="mz-small mz-faint">
            {categoria.tecnicos.length} técnico(s):{" "}
            {categoria.tecnicos.map((t) => t.nombre).join(", ") || "ninguno"}
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() =>
              recurso.ejecutar(() =>
                soporteService.config.actualizar("categorias", categoria.id, {
                  activa: !categoria.activa,
                }),
              )
            }
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
                <th>Caso de ayuda</th>
                <th>Prioridad</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {categoria.casos.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.nombre}
                    {!c.activo && (
                      <span className="mz-pill mz-pill--neutral ms-2">
                        Inactivo
                      </span>
                    )}
                  </td>
                  <td>
                    <select
                      className="form-select form-select-sm"
                      aria-label={`Prioridad de ${c.nombre}`}
                      value={c.prioridad}
                      onChange={(e) =>
                        recurso.ejecutar(() =>
                          soporteService.config.actualizar("casos", c.id, {
                            prioridad: e.target.value,
                          }),
                        )
                      }
                    >
                      {PRIORIDADES.map(([valor, etiqueta]) => (
                        <option key={valor} value={valor}>
                          {etiqueta}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() =>
                        recurso.ejecutar(() =>
                          soporteService.config.actualizar("casos", c.id, {
                            activo: !c.activo,
                          }),
                        )
                      }
                    >
                      {c.activo ? "Desactivar" : "Activar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="row g-2 align-items-end mt-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await recurso.ejecutar(() =>
                soporteService.config.crear("casos", {
                  ...caso,
                  categoria: categoria.id,
                }),
              )
            )
              setCaso({ nombre: "", prioridad: "media" });
          }}
        >
          <div className="col-12 col-md-7">
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
              Prioridad
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
            >
              Agregar caso
            </button>
          </div>
        </form>
      </div>
    </section>
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

export function SlaSoporte() {
  const reglas = useRecurso("sla");
  const categorias = useRecurso("categorias");
  const [areas, setAreas] = useState([]);
  const [nueva, setNueva] = useState({
    categoria: "",
    area: "",
    prioridad: "",
    horas: "",
  });

  useEffect(() => {
    apiClient
      .get("/soporte/config/sla/areas/")
      .then((r) => setAreas(r.data))
      .catch(() => setAreas([]));
  }, []);

  return (
    <div className="soporte-page mz-stack">
      <Error texto={reglas.error} />
      <p className="mz-faint mb-0">
        El plazo se cuenta en horas de atención, desde que un técnico toma el
        ticket hasta que lo marca como atendido. Gana la regla más específica
        (categoría, área y prioridad; vacío es «cualquiera»). Sin ninguna regla,
        el plazo es de 8 horas.
      </p>
      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Área solicitante</th>
              <th>Prioridad</th>
              <th>Plazo</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {(reglas.lista ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.categoria_nombre || "Cualquiera"}</td>
                <td>{r.area_nombre || "Cualquiera"}</td>
                <td>{r.prioridad_display || "Cualquiera"}</td>
                <td>{horasYMinutos(r.minutos)}</td>
                <td className="num">
                  <button
                    type="button"
                    className="btn btn-outline-danger btn-sm"
                    onClick={() =>
                      reglas.ejecutar(() =>
                        soporteService.config.eliminar("sla", r.id),
                      )
                    }
                  >
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
            {reglas.lista?.length === 0 && (
              <tr className="mz-empty-row">
                <td colSpan={5}>
                  Sin reglas: todos los tickets tienen 8 horas
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <form
        className="mz-card"
        onSubmit={async (e) => {
          e.preventDefault();
          const datos = {
            categoria: nueva.categoria || null,
            area: nueva.area || null,
            prioridad: nueva.prioridad,
            minutos: Math.round(Number(nueva.horas) * 60),
          };
          if (
            await reglas.ejecutar(() =>
              soporteService.config.crear("sla", datos),
            )
          )
            setNueva({ categoria: "", area: "", prioridad: "", horas: "" });
        }}
      >
        <div className="mz-card-body row g-2 align-items-end">
          <div className="col-12 col-md-3">
            <label className="form-label mz-small" htmlFor="sla-categoria">
              Categoría
            </label>
            <select
              id="sla-categoria"
              className="form-select form-select-sm"
              value={nueva.categoria}
              onChange={(e) =>
                setNueva((v) => ({ ...v, categoria: e.target.value }))
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
          <div className="col-12 col-md-3">
            <label className="form-label mz-small" htmlFor="sla-area">
              Área solicitante
            </label>
            <select
              id="sla-area"
              className="form-select form-select-sm"
              value={nueva.area}
              onChange={(e) =>
                setNueva((v) => ({ ...v, area: e.target.value }))
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
          <div className="col-6 col-md-2">
            <label className="form-label mz-small" htmlFor="sla-prioridad">
              Prioridad
            </label>
            <select
              id="sla-prioridad"
              className="form-select form-select-sm"
              value={nueva.prioridad}
              onChange={(e) =>
                setNueva((v) => ({ ...v, prioridad: e.target.value }))
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
          <div className="col-6 col-md-2">
            <label className="form-label mz-small" htmlFor="sla-horas">
              Plazo (horas)
            </label>
            <input
              id="sla-horas"
              type="number"
              min="0.25"
              step="0.25"
              className="form-control form-control-sm"
              required
              value={nueva.horas}
              onChange={(e) =>
                setNueva((v) => ({ ...v, horas: e.target.value }))
              }
            />
          </div>
          <div className="col-12 col-md-2">
            <button type="submit" className="btn btn-primary btn-sm w-100">
              Agregar regla
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// --- Respuestas predefinidas ------------------------------------------------------------

export function RespuestasSoporte() {
  const respuestas = useRecurso("respuestas");
  const [nueva, setNueva] = useState({ atajo: "", titulo: "", texto: "" });

  return (
    <div className="soporte-page mz-stack">
      <Error texto={respuestas.error} />
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
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {(respuestas.lista ?? []).map((r) => (
              <tr key={r.id}>
                <td className="mz-mono">/{r.atajo}</td>
                <td>{r.titulo}</td>
                <td className="mz-small">{r.texto}</td>
                <td className="num">
                  <button
                    type="button"
                    className="btn btn-outline-danger btn-sm"
                    onClick={() =>
                      respuestas.ejecutar(() =>
                        soporteService.config.eliminar("respuestas", r.id),
                      )
                    }
                  >
                    Quitar
                  </button>
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
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await respuestas.ejecutar(() =>
              soporteService.config.crear("respuestas", nueva),
            )
          )
            setNueva({ atajo: "", titulo: "", texto: "" });
        }}
      >
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
              value={nueva.atajo}
              onChange={(e) =>
                setNueva((v) => ({ ...v, atajo: e.target.value.toLowerCase() }))
              }
            />
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
          <div className="col-12 mz-actions justify-content-end">
            <button type="submit" className="btn btn-primary btn-sm">
              Agregar respuesta
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
