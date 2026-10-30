import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { soporteService } from "../../api/soporteService";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { mensajeDeError } from "../../utils/errores";
import { CamposFormulario } from "./Publico/CamposFormulario";
import {
  CriticidadPorPersona,
  OpcionesDeCaso,
  OpcionesDeCategoria,
  TextosDeOpciones,
} from "./OpcionesDelSistema";
import "./Soporte.css";

const TIPOS = [
  ["texto", "Texto corto"],
  ["parrafo", "Párrafo"],
  ["numero", "Número"],
  ["fecha", "Fecha"],
  ["lista", "Lista de opciones"],
  ["casilla", "Casilla (sí / no)"],
  ["correo", "Correo"],
  ["telefono", "Teléfono"],
];

/** Los campos del sistema que salen de «Mi perfil»: no se preguntan. */
const PERSONALES = new Set(["nombre", "telefono", "correo", "sede", "area"]);

const NUEVO = {
  etiqueta: "",
  ayuda: "",
  tipo: "texto",
  opciones: [],
  obligatorio: false,
  activo: true,
  categorias: [],
  base: false,
  bloqueado: false,
};

/**
 * Mesa de ayuda → Formulario: qué pregunta el formulario público de la empresa.
 *
 * Los campos del sistema se pueden renombrar y reordenar; teléfono, agencia y
 * área además se pueden ocultar o volver opcionales. Los propios se agregan,
 * se editan y se quitan, y pueden pedirse solo en ciertas categorías. Cada
 * cambio se guarda al momento y la vista previa muestra lo que verá quien pide.
 */
export function FormularioEditor() {
  const [campos, setCampos] = useState(null);
  const [categorias, setCategorias] = useState([]);
  const [editando, setEditando] = useState(null);
  const [porQuitar, setPorQuitar] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [trabajando, setTrabajando] = useState(false);

  const cargar = useCallback(() => {
    return soporteService.config
      .listar("formulario")
      .then(setCampos)
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar el formulario.")),
      );
  }, []);

  const cargarCategorias = useCallback(
    () =>
      soporteService.config
        .listar("categorias")
        .then(setCategorias)
        .catch(() => setCategorias([])),
    [],
  );

  useEffect(() => {
    cargar();
    cargarCategorias();
  }, [cargar, cargarCategorias]);

  async function ejecutar(accion, mensaje = "Cambios guardados.") {
    setTrabajando(true);
    setError(null);
    setAviso(null);
    try {
      await accion();
      await cargar();
      setAviso(mensaje);
      return true;
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el cambio."));
      return false;
    } finally {
      setTrabajando(false);
    }
  }

  function mover(indice, paso) {
    const ids = campos.map((c) => c.id);
    const destino = indice + paso;
    [ids[indice], ids[destino]] = [ids[destino], ids[indice]];
    ejecutar(() => soporteService.config.ordenarCampos(ids), "Orden guardado.");
  }

  async function guardar(borrador) {
    const datos = {
      etiqueta: borrador.etiqueta,
      ayuda: borrador.ayuda,
      obligatorio: borrador.obligatorio,
      activo: borrador.activo,
    };
    if (!borrador.base) {
      datos.tipo = borrador.tipo;
      datos.opciones = borrador.opciones;
      datos.categorias = borrador.categorias;
    } else if (borrador.valores) {
      // Impacto y urgencia: el texto de cada opción.
      datos.opciones = borrador.opciones;
    }
    const hecho = await ejecutar(
      () =>
        borrador.id
          ? soporteService.config.actualizar("formulario", borrador.id, datos)
          : soporteService.config.crear("formulario", datos),
      borrador.id
        ? `Campo «${borrador.etiqueta}» guardado.`
        : `Campo «${borrador.etiqueta}» agregado.`,
    );
    if (hecho) setEditando(null);
  }

  // Impacto y urgencia, con el texto que eligió la empresa.
  const opcionesDe = (clave) => {
    const c = campos?.find((x) => x.base && x.clave === clave);
    return c?.valores?.map((v, i) => ({ id: v, nombre: c.opciones[i] }));
  };
  const datosVista = {
    agencias: [],
    areas: [],
    impactos: opcionesDe("impacto"),
    urgencias: opcionesDe("urgencia"),
    categorias: categorias
      .filter((c) => c.activa)
      .map((c) => ({ ...c, casos: c.casos.filter((caso) => caso.activo) })),
  };
  const nombreCategoria = Object.fromEntries(
    categorias.map((c) => [c.id, c.nombre]),
  );

  return (
    <div className="soporte-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Formulario</h2>
          <p className="mz-desc">
            Lo que pregunta «Soporte TI» al pedir ayuda. Nombre, correo,
            teléfono, área y agencia salen de «Mi perfil» de cada persona. Los
            cambios se aplican al momento.
          </p>
        </div>
        <div className="mz-actions">
          <Link className="btn btn-outline-secondary btn-sm" to="/admin/ayuda">
            <Icon name="box-arrow-up-right" /> Abrir Soporte TI
          </Link>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={trabajando}
            onClick={() => setEditando({ ...NUEVO })}
          >
            <Icon name="plus-lg" /> Agregar campo
          </button>
        </div>
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && !error && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check2-circle" />
          {aviso}
        </div>
      )}
      {/* «Cargando…» y no una página vacía. */}
      {!campos && !error && <EstadoDeCarga cargando />}

      {campos && (
        <div className="soporte-formulario">
          <div className="mz-stack">
            {editando && !editando.id && (
              <EditorDeCampo
                campo={editando}
                categorias={categorias}
                onCategoriasCambiaron={cargarCategorias}
                guardando={trabajando}
                onGuardar={guardar}
                onCancelar={() => setEditando(null)}
              />
            )}
            <ol className="soporte-campos" aria-label="Campos del formulario">
              {campos.map((campo, indice) => (
                <li
                  key={campo.id}
                  className={
                    campo.activo
                      ? "soporte-campo"
                      : "soporte-campo soporte-campo--oculto"
                  }
                >
                  {editando?.id === campo.id ? (
                    <EditorDeCampo
                      campo={editando}
                      categorias={categorias}
                      onCategoriasCambiaron={cargarCategorias}
                      guardando={trabajando}
                      onGuardar={guardar}
                      onCancelar={() => setEditando(null)}
                    />
                  ) : (
                    <div className="soporte-campo__fila">
                      <div className="soporte-campo__orden">
                        <button
                          type="button"
                          className="btn btn-link btn-sm soporte-orden-btn"
                          aria-label={`Subir «${campo.etiqueta}»`}
                          disabled={trabajando || indice === 0}
                          onClick={() => mover(indice, -1)}
                        >
                          <Icon name="chevron-up" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-link btn-sm soporte-orden-btn"
                          aria-label={`Bajar «${campo.etiqueta}»`}
                          disabled={trabajando || indice === campos.length - 1}
                          onClick={() => mover(indice, 1)}
                        >
                          <Icon name="chevron-down" />
                        </button>
                      </div>
                      <div className="soporte-campo__texto">
                        <strong>{campo.etiqueta}</strong>
                        <div className="soporte-campo__etiquetas">
                          <span className="mz-pill mz-pill--neutral">
                            {campo.tipo_display}
                          </span>
                          {campo.base && (
                            <span className="mz-pill mz-pill--info">
                              Del sistema
                            </span>
                          )}
                          {campo.base && PERSONALES.has(campo.clave) && (
                            <span className="mz-pill mz-pill--neutral">
                              De «Mi perfil»
                            </span>
                          )}
                          {!campo.activo ? (
                            <span className="mz-pill mz-pill--warn">
                              Oculto
                            </span>
                          ) : (
                            <span className="mz-small mz-faint">
                              {campo.obligatorio ? "Obligatorio" : "Opcional"}
                            </span>
                          )}
                          {campo.categorias.length > 0 && (
                            <span className="mz-small mz-faint">
                              Solo en:{" "}
                              {campo.categorias
                                .map((id) => nombreCategoria[id])
                                .filter(Boolean)
                                .join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mz-actions">
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          disabled={trabajando}
                          onClick={() => {
                            setPorQuitar(null);
                            setEditando({ ...campo });
                          }}
                        >
                          Editar
                        </button>
                        {!campo.base &&
                          (porQuitar === campo.id ? (
                            <>
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                disabled={trabajando}
                                onClick={() =>
                                  ejecutar(
                                    () =>
                                      soporteService.config.eliminar(
                                        "formulario",
                                        campo.id,
                                      ),
                                    `Campo «${campo.etiqueta}» quitado.`,
                                  )
                                }
                              >
                                Sí, quitar
                              </button>
                              <button
                                type="button"
                                className="btn btn-link btn-sm"
                                onClick={() => setPorQuitar(null)}
                              >
                                No
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-outline-danger btn-sm"
                              disabled={trabajando}
                              onClick={() => setPorQuitar(campo.id)}
                            >
                              Quitar
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <p className="mz-small mz-faint mb-0">
              Los datos de contacto no se preguntan: salen de «Mi perfil» de
              quien pide. Categoría, caso y descripción no se pueden ocultar:
              los necesitan la cola, la prioridad y los avisos. Quitar un campo
              propio no borra lo que ya respondieron en los tickets.
            </p>
          </div>

          <div className="mz-stack">
            <VistaPrevia campos={campos} datos={datosVista} />
          </div>
        </div>
      )}
      {/* Fuera de la columna fija de la vista previa: se montaba debajo de
          ella al desplazarse. */}
      {campos && <CriticidadPorPersona />}
    </div>
  );
}

function EditorDeCampo({
  campo,
  categorias,
  onCategoriasCambiaron,
  guardando,
  onGuardar,
  onCancelar,
}) {
  const [borrador, setBorrador] = useState(campo);
  const [opciones, setOpciones] = useState((campo.opciones ?? []).join("\n"));
  const fijar = (clave, valor) =>
    setBorrador((actual) => ({ ...actual, [clave]: valor }));
  const id = campo.id ?? "nuevo";

  return (
    <form
      className="mz-card soporte-campo__editor"
      aria-label={campo.id ? `Editar «${campo.etiqueta}»` : "Campo nuevo"}
      onSubmit={(e) => {
        e.preventDefault();
        onGuardar({
          ...borrador,
          opciones: borrador.valores
            ? borrador.opciones.map((o) => o.trim())
            : opciones
                .split("\n")
                .map((o) => o.trim())
                .filter(Boolean),
        });
      }}
    >
      <div className="mz-card-body row g-2">
        <div className="col-12 col-md-7">
          <label className="form-label mz-small" htmlFor={`cf-etiqueta-${id}`}>
            Pregunta
          </label>
          <input
            id={`cf-etiqueta-${id}`}
            className="form-control form-control-sm"
            required
            maxLength={120}
            value={borrador.etiqueta}
            onChange={(e) => fijar("etiqueta", e.target.value)}
          />
        </div>
        <div className="col-12 col-md-5">
          <label className="form-label mz-small" htmlFor={`cf-tipo-${id}`}>
            Tipo
          </label>
          <select
            id={`cf-tipo-${id}`}
            className="form-select form-select-sm"
            disabled={borrador.base}
            value={borrador.tipo}
            onChange={(e) => fijar("tipo", e.target.value)}
          >
            {TIPOS.map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </select>
        </div>
        <div className="col-12">
          <label className="form-label mz-small" htmlFor={`cf-ayuda-${id}`}>
            Texto de ayuda (opcional)
          </label>
          <input
            id={`cf-ayuda-${id}`}
            className="form-control form-control-sm"
            maxLength={200}
            value={borrador.ayuda}
            onChange={(e) => fijar("ayuda", e.target.value)}
          />
        </div>
        {!borrador.base && borrador.tipo === "lista" && (
          <div className="col-12">
            <label
              className="form-label mz-small"
              htmlFor={`cf-opciones-${id}`}
            >
              Opciones (una por línea)
            </label>
            <textarea
              id={`cf-opciones-${id}`}
              className="form-control form-control-sm"
              rows={4}
              required
              value={opciones}
              onChange={(e) => setOpciones(e.target.value)}
            />
          </div>
        )}
        {borrador.base && borrador.clave === "categoria" && (
          <OpcionesDeCategoria
            categorias={categorias}
            onCambio={onCategoriasCambiaron}
          />
        )}
        {borrador.base && borrador.clave === "caso" && (
          <OpcionesDeCaso
            categorias={categorias}
            onCambio={onCategoriasCambiaron}
          />
        )}
        {borrador.base && borrador.valores && (
          <TextosDeOpciones
            id={id}
            clave={borrador.clave}
            opciones={borrador.opciones}
            onCambio={(lista) => fijar("opciones", lista)}
          />
        )}
        <div className="col-12 d-flex flex-wrap gap-3">
          <div className="form-check">
            <input
              id={`cf-activo-${id}`}
              type="checkbox"
              className="form-check-input"
              disabled={borrador.bloqueado}
              checked={borrador.activo}
              onChange={(e) => fijar("activo", e.target.checked)}
            />
            <label className="form-check-label" htmlFor={`cf-activo-${id}`}>
              Mostrar en el formulario
            </label>
          </div>
          <div className="form-check">
            <input
              id={`cf-obligatorio-${id}`}
              type="checkbox"
              className="form-check-input"
              disabled={borrador.bloqueado}
              checked={borrador.obligatorio}
              onChange={(e) => fijar("obligatorio", e.target.checked)}
            />
            <label
              className="form-check-label"
              htmlFor={`cf-obligatorio-${id}`}
            >
              Obligatorio
            </label>
          </div>
        </div>
        {!borrador.base && categorias.length > 0 && (
          <fieldset className="col-12">
            <legend className="form-label mz-small mb-1">
              Pedirlo solo en estas categorías (ninguna: en todas)
            </legend>
            <div className="d-flex flex-wrap gap-3">
              {categorias.map((c) => (
                <div key={c.id} className="form-check">
                  <input
                    id={`cf-cat-${id}-${c.id}`}
                    type="checkbox"
                    className="form-check-input"
                    checked={borrador.categorias.includes(c.id)}
                    onChange={(e) =>
                      fijar(
                        "categorias",
                        e.target.checked
                          ? [...borrador.categorias, c.id]
                          : borrador.categorias.filter((x) => x !== c.id),
                      )
                    }
                  />
                  <label
                    className="form-check-label"
                    htmlFor={`cf-cat-${id}-${c.id}`}
                  >
                    {c.nombre}
                  </label>
                </div>
              ))}
            </div>
          </fieldset>
        )}
        <div className="col-12 mz-actions justify-content-end">
          <button
            type="button"
            className="btn btn-link btn-sm"
            onClick={onCancelar}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary btn-sm"
            disabled={guardando}
          >
            {campo.id ? "Guardar" : "Agregar"}
          </button>
        </div>
      </div>
    </form>
  );
}

/** El formulario como lo verá quien pide; se puede llenar, pero no envía. */
function VistaPrevia({ campos, datos }) {
  const [valores, setValores] = useState({ categoria: "", caso: "" });
  const [adicionales, setAdicionales] = useState({});
  const visibles = campos.filter(
    (c) => c.activo && !(c.base && PERSONALES.has(c.clave)),
  );

  return (
    <section className="mz-card soporte-formulario__vista">
      <div className="mz-card-head">
        <h3>Vista previa</h3>
      </div>
      <form
        className="mz-card-body row g-3"
        aria-label="Vista previa del formulario"
        onSubmit={(e) => e.preventDefault()}
      >
        <CamposFormulario
          campos={visibles}
          datos={datos}
          valores={valores}
          onBase={(clave, valor) =>
            setValores((actual) => ({
              ...actual,
              [clave]: valor,
              ...(clave === "categoria" ? { caso: "" } : {}),
            }))
          }
          adicionales={adicionales}
          onAdicional={(clave, valor) =>
            setAdicionales((actual) => ({ ...actual, [clave]: valor }))
          }
          prefijo="vp"
        />
        <p className="col-12 mz-small mz-faint mb-0">
          Debajo van los adjuntos y la aceptación del uso de datos, que el
          formulario siempre pide.
        </p>
      </form>
    </section>
  );
}
