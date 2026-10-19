import { useCallback, useEffect, useState } from "react";

import { apiClient } from "../../../api/client";
import { soporteService } from "../../../api/soporteService";
import { Icon } from "../../../components/common/Icon/Icon";
import { mensajeDeError } from "../../../utils/errores";
import { EditorDeAgenda } from "../EditorDeAgenda";
import "../Soporte.css";

/*
 * Configuración → Mesa de ayuda. Cinco apartados: equipo (niveles y
 * técnicos), categorías y casos (el catálogo de servicios), SLA, horario y
 * metas, y respuestas predefinidas. Todo es de la empresa activa: cada empresa
 * tiene su propio equipo.
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
  const [editando, setEditando] = useState(null);
  const [nuevoNivel, setNuevoNivel] = useState({ nombre: "", orden: "" });

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
  const niveles = useRecurso("niveles");
  const [areas, setAreas] = useState([]);
  const [nueva, setNueva] = useState("");

  useEffect(() => {
    apiClient
      .get("/soporte/config/sla/areas/")
      .then((r) => setAreas(r.data))
      .catch(() => setAreas([]));
  }, []);

  return (
    <div className="soporte-page mz-stack">
      <Error texto={categorias.error} />
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

function TarjetaCategoria({ categoria, recurso, niveles, areas }) {
  const [caso, setCaso] = useState(CASO_NUEVO);
  const cambiar = (c, datos) =>
    recurso.ejecutar(() =>
      soporteService.config.actualizar("casos", c.id, datos),
    );
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
                <th>Servicio</th>
                <th>Tipo</th>
                <th>Prioridad base</th>
                <th>Entra por</th>
                <th>Plazo propio (h)</th>
                <th>Aprueban</th>
                <th aria-label="Acciones" />
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
                  <td>
                    <select
                      className="form-select form-select-sm"
                      aria-label={`Tipo de ${c.nombre}`}
                      value={c.tipo}
                      onChange={(e) => cambiar(c, { tipo: e.target.value })}
                    >
                      {TIPOS.map(([valor, etiqueta]) => (
                        <option key={valor} value={valor}>
                          {etiqueta}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="form-select form-select-sm"
                      aria-label={`Prioridad de ${c.nombre}`}
                      value={c.prioridad}
                      onChange={(e) =>
                        cambiar(c, { prioridad: e.target.value })
                      }
                    >
                      {PRIORIDADES.map(([valor, etiqueta]) => (
                        <option key={valor} value={valor}>
                          {etiqueta}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="form-select form-select-sm"
                      aria-label={`Nivel de entrada de ${c.nombre}`}
                      value={c.nivel_inicial ?? ""}
                      onChange={(e) =>
                        cambiar(c, { nivel_inicial: e.target.value || null })
                      }
                    >
                      <option value="">Primer nivel</option>
                      {niveles.map((n) => (
                        <option key={n.id} value={n.id}>
                          N{n.orden} · {n.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0.25"
                      step="0.25"
                      className="form-control form-control-sm"
                      aria-label={`Plazo propio de ${c.nombre}, en horas`}
                      placeholder="Reglas"
                      defaultValue={c.minutos_plazo ? c.minutos_plazo / 60 : ""}
                      onBlur={(e) => {
                        const minutos = e.target.value
                          ? Math.round(Number(e.target.value) * 60)
                          : null;
                        if (minutos !== c.minutos_plazo)
                          cambiar(c, { minutos_plazo: minutos });
                      }}
                    />
                  </td>
                  <td>
                    <div className="form-check mb-1">
                      <input
                        id={`cs-jefe-${c.id}`}
                        type="checkbox"
                        className="form-check-input"
                        checked={c.aprueba_jefe_area}
                        onChange={(e) =>
                          cambiar(c, { aprueba_jefe_area: e.target.checked })
                        }
                      />
                      <label
                        className="form-check-label mz-small"
                        htmlFor={`cs-jefe-${c.id}`}
                      >
                        Jefe de área
                      </label>
                    </div>
                    <select
                      multiple
                      className="form-select form-select-sm soporte-aprueban"
                      aria-label={`Áreas que aprueban ${c.nombre}`}
                      value={(c.aprueban ?? []).map(String)}
                      onChange={(e) =>
                        cambiar(c, {
                          aprueban: Array.from(e.target.selectedOptions).map(
                            (o) => Number(o.value),
                          ),
                        })
                      }
                    >
                      {areas.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.nombre}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => cambiar(c, { activo: !c.activo })}
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
    respuesta: "",
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
        Los plazos corren desde que se crea el ticket: la respuesta, hasta la
        primera respuesta del equipo; la solución, hasta que se atiende. Los P1
        se cuentan en horas calendario y los demás en el horario hábil de la
        mesa (ver «Horario y metas»). Gana el plazo propio del caso; si no, la
        regla más específica (categoría, área y prioridad; vacío es
        «cualquiera»). Sin reglas rigen los de cada prioridad: P1 15 min / 4 h,
        P2 30 min / 8 h, P3 2 h / 16 h y P4 4 h / 40 h.
      </p>
      <div className="mz-table-wrap">
        <table className="mz-table">
          <thead>
            <tr>
              <th>Categoría</th>
              <th>Área solicitante</th>
              <th>Prioridad</th>
              <th>Respuesta</th>
              <th>Solución</th>
              <th aria-label="Acciones" />
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
                <td colSpan={6}>
                  Sin reglas: rigen los plazos de cada prioridad
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
            minutos_respuesta: nueva.respuesta
              ? Math.round(Number(nueva.respuesta) * 60)
              : null,
          };
          if (
            await reglas.ejecutar(() =>
              soporteService.config.crear("sla", datos),
            )
          )
            setNueva({
              categoria: "",
              area: "",
              prioridad: "",
              horas: "",
              respuesta: "",
            });
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
            <label className="form-label mz-small" htmlFor="sla-respuesta">
              Respuesta (horas)
            </label>
            <input
              id="sla-respuesta"
              type="number"
              min="0.05"
              step="0.05"
              className="form-control form-control-sm"
              placeholder="La de su prioridad"
              value={nueva.respuesta}
              onChange={(e) =>
                setNueva((v) => ({ ...v, respuesta: e.target.value }))
              }
            />
          </div>
          <div className="col-6 col-md-2">
            <label className="form-label mz-small" htmlFor="sla-horas">
              Solución (horas)
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

// --- Horario y metas -------------------------------------------------------------------

/** El horario hábil de la mesa (mide los plazos de P2 a P4 y el cierre
 * automático), sus feriados, las metas de cumplimiento y si los P1 corren las
 * 24 horas. */
export function HorarioMesaSoporte() {
  const [mesa, setMesa] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    soporteService.config
      .mesa()
      .then(setMesa)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar la configuración.")),
      );
  }, []);

  async function guardar(evento) {
    evento.preventDefault();
    setGuardando(true);
    setError(null);
    setAviso(null);
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

  if (!mesa) return <Error texto={error} />;

  return (
    <form className="soporte-page mz-stack" onSubmit={guardar}>
      <Error texto={error} />
      {aviso && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="check2-circle" />
          {aviso}
        </div>
      )}
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
            onCambiar={({ horarios, ausencias }) =>
              setMesa({ ...mesa, horarios, feriados: ausencias })
            }
            textos={{
              horario: "Horario hábil de la mesa",
              sinFranjas: "Sin franjas: rige el horario por defecto.",
              ausencias: "Feriados y cierres (no cuentan para los plazos)",
            }}
          />
        </div>
      </section>
      <div className="mz-actions justify-content-end">
        <button type="submit" className="btn btn-primary" disabled={guardando}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
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
