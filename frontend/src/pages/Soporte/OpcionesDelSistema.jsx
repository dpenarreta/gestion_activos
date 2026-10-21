import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";

const RUTA_CATEGORIAS = "/admin/configuracion/soporte/categorias";

/**
 * Las opciones de los desplegables del sistema, editables desde el propio
 * formulario (21/10/2026). Las categorías y los casos de ayuda son los de
 * Configuración → Mesa de ayuda, así que lo que se cambia aquí se ve allá. Se
 * ocultan en vez de borrarse: los tickets viejos los siguen nombrando.
 */
function useGuardar(onCambio) {
  const [error, setError] = useState(null);
  const [trabajando, setTrabajando] = useState(false);
  async function guardar(accion, mensaje) {
    setTrabajando(true);
    setError(null);
    try {
      await accion();
      await onCambio();
      return true;
    } catch (err) {
      setError(mensajeDeError(err, mensaje));
      return false;
    } finally {
      setTrabajando(false);
    }
  }
  return { error, trabajando, guardar };
}

/** De más a menos crítico: así se lee la lista. */
function porPeso(lista) {
  return [...lista].sort(
    (a, b) => b.peso - a.peso || a.nombre.localeCompare(b.nombre),
  );
}

/**
 * El orden que se manda al reordenar: de menos a más crítico (el primero vale
 * 1). `indice` es la posición en la lista que se ve (de más a menos).
 */
function ordenTrasMover(lista, indice, paso) {
  const vista = porPeso(lista).map((x) => x.id);
  const destino = indice + paso;
  [vista[indice], vista[destino]] = [vista[destino], vista[indice]];
  return vista.reverse();
}

/** Una opción: su peso, su nombre editable y si se muestra. */
function Opcion({
  etiqueta,
  nombre,
  visible,
  peso,
  total,
  trabajando,
  onGuardar,
  onMover,
}) {
  const [valor, setValor] = useState(nombre);
  const cambiado = valor.trim() !== nombre;
  return (
    <li className="soporte-opcion">
      <span
        className="soporte-opcion__peso"
        title="Peso en la criticidad: más alto, se atiende antes"
      >
        {peso}/{total}
      </span>
      <span className="d-inline-flex flex-column">
        <button
          type="button"
          className="btn btn-link btn-sm p-0 lh-1"
          aria-label={`Más crítico: «${nombre}»`}
          disabled={trabajando || peso >= total}
          onClick={() => onMover(-1)}
        >
          <Icon name="chevron-up" />
        </button>
        <button
          type="button"
          className="btn btn-link btn-sm p-0 lh-1"
          aria-label={`Menos crítico: «${nombre}»`}
          disabled={trabajando || peso <= 1}
          onClick={() => onMover(1)}
        >
          <Icon name="chevron-down" />
        </button>
      </span>
      <input
        className="form-control form-control-sm"
        aria-label={`Nombre de ${etiqueta} «${nombre}»`}
        maxLength={120}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
      />
      <label className="form-check form-switch m-0 text-nowrap">
        <input
          type="checkbox"
          role="switch"
          className="form-check-input"
          aria-label={`Mostrar «${nombre}»`}
          checked={visible}
          disabled={trabajando}
          onChange={(e) => onGuardar({ visible: e.target.checked })}
        />{" "}
        <span className="form-check-label mz-small">
          {visible ? "Se muestra" : "Oculta"}
        </span>
      </label>
      <button
        type="button"
        className="btn btn-outline-primary btn-sm"
        disabled={!cambiado || !valor.trim() || trabajando}
        onClick={() => onGuardar({ nombre: valor.trim() })}
      >
        Guardar
      </button>
    </li>
  );
}

function Agregar({ etiqueta, trabajando, onAgregar }) {
  const [valor, setValor] = useState("");
  return (
    <div className="soporte-opcion soporte-opcion--nueva">
      <input
        className="form-control form-control-sm"
        aria-label={`Nueva opción: ${etiqueta}`}
        placeholder={`Nueva ${etiqueta}`}
        maxLength={120}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-primary btn-sm text-nowrap"
        disabled={!valor.trim() || trabajando}
        onClick={async () => {
          if (await onAgregar(valor.trim())) setValor("");
        }}
      >
        <Icon name="plus-lg" /> Agregar
      </button>
    </div>
  );
}

function Fallo({ texto }) {
  if (!texto) return null;
  return (
    <div className="mz-alert mz-alert--bad" role="alert">
      <Icon name="x-octagon" />
      {texto}
    </div>
  );
}

export function OpcionesDeCategoria({ categorias, onCambio }) {
  const { error, trabajando, guardar } = useGuardar(onCambio);
  return (
    <fieldset className="col-12 soporte-opciones">
      <legend className="form-label mz-small mb-1">
        Opciones: las categorías de la mesa de ayuda, de más a menos crítica
      </legend>
      <Fallo texto={error} />
      <ul className="list-unstyled mz-stack mb-2">
        {porPeso(categorias).map((c, indice) => (
          <Opcion
            key={`${c.id}-${c.nombre}`}
            etiqueta="la categoría"
            nombre={c.nombre}
            visible={c.activa}
            peso={c.peso}
            total={categorias.length}
            trabajando={trabajando}
            onMover={(paso) =>
              guardar(
                () =>
                  soporteService.config.ponderar("categorias", {
                    ids: ordenTrasMover(categorias, indice, paso),
                  }),
                "No se pudo cambiar el orden.",
              )
            }
            onGuardar={({ nombre, visible }) =>
              guardar(
                () =>
                  soporteService.config.actualizar(
                    "categorias",
                    c.id,
                    nombre !== undefined ? { nombre } : { activa: visible },
                  ),
                "No se pudo guardar la categoría.",
              )
            }
          />
        ))}
      </ul>
      <Agregar
        etiqueta="categoría"
        trabajando={trabajando}
        onAgregar={(nombre) =>
          guardar(
            () =>
              soporteService.config.crear("categorias", {
                nombre,
                activa: true,
              }),
            "No se pudo agregar la categoría.",
          )
        }
      />
      <p className="form-text mb-0">
        El peso (de 1 al total) suma en la criticidad del ticket: con las
        flechas se decide cuál es más crítica; una nueva entra con peso 1. Una
        categoría oculta deja de ofrecerse, pero sus tickets la conservan. Quién
        la atiende se configura en{" "}
        <Link to={RUTA_CATEGORIAS}>Categorías y casos</Link>.
      </p>
    </fieldset>
  );
}

export function OpcionesDeCaso({ categorias, onCambio }) {
  const { error, trabajando, guardar } = useGuardar(onCambio);
  return (
    <fieldset className="col-12 soporte-opciones">
      <legend className="form-label mz-small mb-1">
        Opciones: los casos de ayuda de cada categoría, de más a menos crítico
      </legend>
      <Fallo texto={error} />
      {categorias.map((c) => (
        <div key={c.id} className="soporte-opciones__grupo">
          <strong className="mz-small">
            {c.nombre}
            {!c.activa && <span className="mz-faint"> (oculta)</span>}
          </strong>
          <ul className="list-unstyled mz-stack my-1">
            {porPeso(c.casos).map((caso, indice) => (
              <Opcion
                key={`${caso.id}-${caso.nombre}`}
                etiqueta="el caso"
                nombre={caso.nombre}
                visible={caso.activo}
                peso={caso.peso}
                total={c.casos.length}
                trabajando={trabajando}
                onMover={(paso) =>
                  guardar(
                    () =>
                      soporteService.config.ponderar("casos", {
                        categoria: c.id,
                        ids: ordenTrasMover(c.casos, indice, paso),
                      }),
                    "No se pudo cambiar el orden.",
                  )
                }
                onGuardar={({ nombre, visible }) =>
                  guardar(
                    () =>
                      soporteService.config.actualizar(
                        "casos",
                        caso.id,
                        nombre !== undefined ? { nombre } : { activo: visible },
                      ),
                    "No se pudo guardar el caso.",
                  )
                }
              />
            ))}
          </ul>
          <Agregar
            etiqueta={`caso en ${c.nombre}`}
            trabajando={trabajando}
            onAgregar={(nombre) =>
              guardar(
                () =>
                  soporteService.config.crear("casos", {
                    categoria: c.id,
                    nombre,
                    activo: true,
                  }),
                "No se pudo agregar el caso.",
              )
            }
          />
        </div>
      ))}
      <p className="form-text mb-0">
        Un caso nuevo nace como incidente de prioridad media. Su prioridad,
        plazo, nivel y aprobaciones se ajustan en{" "}
        <Link to={RUTA_CATEGORIAS}>Categorías y casos</Link>.
      </p>
    </fieldset>
  );
}

const SIGNIFICADO = {
  impacto: ["Afecta a una persona", "Afecta a un grupo", "Afecta a muchos"],
  urgencia: [
    "Urgencia alta (detenido)",
    "Urgencia media",
    "Urgencia baja (puede esperar)",
  ],
};

/** Impacto y urgencia: cambia lo que se lee, no lo que significa. */
export function TextosDeOpciones({ id, clave, opciones, onCambio }) {
  return (
    <fieldset className="col-12 soporte-opciones">
      <legend className="form-label mz-small mb-1">Texto de cada opción</legend>
      {opciones.map((texto, i) => (
        <div key={i} className="mb-1">
          <label
            className="form-label mz-small mz-faint mb-0"
            htmlFor={`cf-op-${id}-${i}`}
          >
            {SIGNIFICADO[clave][i]} · peso{" "}
            {clave === "urgencia" ? 3 - i : i + 1}
            /3
          </label>
          <input
            id={`cf-op-${id}-${i}`}
            className="form-control form-control-sm"
            required
            maxLength={100}
            value={texto}
            onChange={(e) =>
              onCambio(opciones.map((o, j) => (j === i ? e.target.value : o)))
            }
          />
        </div>
      ))}
      <p className="form-text mb-0">
        Solo cambia lo que lee quien pide: el peso de cada opción en la
        criticidad y la prioridad se calculan igual.
      </p>
    </fieldset>
  );
}

/**
 * La criticidad según quien pide (21/10/2026): cuánto pesa el área del
 * ticket (se reordena con las flechas) y el nivel jerárquico del cargo de
 * quien pide (automático: el nivel de arriba del organigrama pesa más).
 */
export function CriticidadPorPersona() {
  const [datos, setDatos] = useState(null);
  const cargar = useCallback(
    () =>
      soporteService.config
        .listar("criticidad")
        .then(setDatos)
        .catch(() => setDatos({ areas: [], niveles: [] })),
    [],
  );
  const { error, trabajando, guardar } = useGuardar(cargar);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!datos) return null;
  const areas = porPeso(datos.areas ?? []);
  const niveles = datos.niveles ?? [];
  return (
    <section className="mz-card" aria-label="Criticidad según quien pide">
      <div className="mz-card-body mz-stack">
        <div>
          <h3 className="h6 mb-1">
            <Icon name="speedometer2" /> Criticidad según quien pide
          </h3>
          <p className="mz-small mz-faint mb-0">
            Además de lo que responde, el área del ticket y el nivel jerárquico
            de quien pide suman en su criticidad.
          </p>
        </div>
        <Fallo texto={error} />
        <div className="soporte-criticidad">
          <div>
            <strong className="mz-small">Áreas, de más a menos crítica</strong>
            <ul className="list-unstyled mz-stack my-1">
              {areas.map((area, indice) => (
                <li key={area.id} className="soporte-opcion">
                  <span className="soporte-opcion__peso">
                    {area.peso}/{areas.length}
                  </span>
                  <span className="d-inline-flex flex-column">
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0 lh-1"
                      aria-label={`Más crítica: «${area.nombre}»`}
                      disabled={trabajando || indice === 0}
                      onClick={() =>
                        guardar(
                          () =>
                            soporteService.config.crear("criticidad", {
                              ids: ordenTrasMover(datos.areas, indice, -1),
                            }),
                          "No se pudo cambiar el orden.",
                        )
                      }
                    >
                      <Icon name="chevron-up" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-link btn-sm p-0 lh-1"
                      aria-label={`Menos crítica: «${area.nombre}»`}
                      disabled={trabajando || indice === areas.length - 1}
                      onClick={() =>
                        guardar(
                          () =>
                            soporteService.config.crear("criticidad", {
                              ids: ordenTrasMover(datos.areas, indice, 1),
                            }),
                          "No se pudo cambiar el orden.",
                        )
                      }
                    >
                      <Icon name="chevron-down" />
                    </button>
                  </span>
                  <span>{area.nombre}</span>
                </li>
              ))}
            </ul>
            <p className="form-text mb-0">
              Las áreas son las del organigrama; una nueva entra con peso 1.
            </p>
          </div>
          <div>
            <strong className="mz-small">Nivel jerárquico de quien pide</strong>
            <ul className="list-unstyled mz-stack my-1">
              {niveles.map((n) => (
                <li key={n.id} className="soporte-opcion">
                  <span className="soporte-opcion__peso">
                    {n.peso}/{niveles.length}
                  </span>
                  <span>{n.nombre}</span>
                </li>
              ))}
            </ul>
            <p className="form-text mb-0">
              Automático, por el orden de los niveles en Editar estructura: el
              de arriba pesa más. Quien no tiene cargo suma 1.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
