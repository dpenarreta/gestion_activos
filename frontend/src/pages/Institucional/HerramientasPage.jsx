import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { herramientasService } from "../../api/herramientasService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
import { useModalA11y } from "../../hooks/useModalA11y";
import { AccesosHerramienta } from "./AccesosHerramienta";
import { erroresPorCampo, mensajeDeError } from "../../utils/errores";
import "./Institucional.css";
import { confirmar } from "../../components/common/Confirmar/confirmar";

const TIPOS = { externa: "Externa", interna: "Interna" };
const VACIA = {
  nombre: "",
  tipo: "externa",
  descripcion: "",
  activa: true,
  orden: 0,
};

function EditorHerramienta({ inicial, onGuardar, onCerrar, onCambioAccesos }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const [valores, setValores] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  // El error de guardar se ve dentro de la ventana y junto a su campo; antes
  // quedaba en la página, detrás de la ventana (auditoría UX/UI, fase 2,
  // 28/10/2026).
  const [error, setError] = useState(null);
  const [errores, setErrores] = useState({});
  const formulario = useRef(null);
  const fijar = (campo) => (e) =>
    setValores((v) => ({
      ...v,
      [campo]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className={`mz-modal${inicial.id ? " mz-modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={
          inicial.id ? `Editar ${inicial.nombre}` : "Nueva herramienta"
        }
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <h3>
            {inicial.id ? `Editar «${inicial.nombre}»` : "Nueva herramienta"}
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
          className="mz-panel-body mz-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setGuardando(true);
            setError(null);
            setErrores({});
            const fallo = await onGuardar(valores);
            if (fallo) {
              setError(
                mensajeDeError(fallo, "No se pudo guardar la herramienta."),
              );
              setErrores(erroresPorCampo(fallo));
              setGuardando(false);
              enfocarPrimerError(formulario.current);
            }
          }}
        >
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          <LeyendaObligatorios />
          <Campo
            id="herr-nombre"
            etiqueta="Nombre"
            obligatorio
            error={errores.nombre}
          >
            <input
              maxLength={120}
              className="form-control form-control-sm"
              value={valores.nombre}
              onChange={fijar("nombre")}
            />
          </Campo>
          <Campo
            id="herr-tipo"
            etiqueta="Tipo"
            obligatorio
            error={errores.tipo}
          >
            <select
              className="form-select form-select-sm"
              value={valores.tipo}
              onChange={fijar("tipo")}
            >
              <option value="externa">Externa (Claude, Gmail, Asana…)</option>
              <option value="interna">Interna (Venture, Zimbra…)</option>
            </select>
          </Campo>
          <Campo
            id="herr-descripcion"
            etiqueta="Descripción (opcional)"
            error={errores.descripcion}
          >
            <input
              maxLength={300}
              className="form-control form-control-sm"
              value={valores.descripcion}
              onChange={fijar("descripcion")}
            />
          </Campo>
          <label className="form-check">
            <input
              type="checkbox"
              className="form-check-input"
              checked={valores.activa}
              onChange={fijar("activa")}
            />{" "}
            <span className="form-check-label">
              Activa (se puede elegir en «Mis herramientas»)
            </span>
          </label>
          <div className="mz-actions justify-content-end">
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
              {guardando ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
        {/* Al editar: quién tiene acceso, fuera del formulario (sus cambios
            se guardan al momento, no con «Guardar»). */}
        {inicial.id && (
          <div className="mz-panel-body pt-0">
            <AccesosHerramienta
              herramienta={inicial}
              onCambio={onCambioAccesos}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Editar estructura → Herramientas y licencias (pide `herramientas.gestionar`):
 * el catálogo de herramientas externas e internas, y quién usa cada una (lo
 * que se necesita al pedir desactivar, reasignar o comprar licencias).
 */
export function HerramientasPage() {
  const [uso, setUso] = useState(null);
  const [pestana, setPestana] = useState("uso");
  const [editando, setEditando] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [buscar, setBuscar] = useState("");

  const cargar = useCallback(
    () =>
      herramientasService
        .uso()
        .then((datos) => {
          setError(null);
          setUso(datos);
        })
        .catch((err) =>
          setError(
            mensajeDeError(err, "No se pudieron cargar las herramientas."),
          ),
        ),
    [],
  );

  useEffect(() => {
    cargar();
  }, [cargar]);

  /** Devuelve el error, si lo hubo, para que el editor lo muestre. */
  async function guardar(valores) {
    try {
      if (valores.id) await herramientasService.actualizar(valores.id, valores);
      else await herramientasService.crear(valores);
    } catch (err) {
      return err;
    }
    setEditando(null);
    setAviso(valores.id ? "Cambios guardados." : "Herramienta agregada.");
    await cargar();
    return null;
  }

  async function borrar(h) {
    if (
      !(await confirmar({
        titulo: `¿Borrar «${h.nombre}» del catálogo?`,
        accion: "Borrar",
      }))
    )
      return;
    setError(null);
    try {
      await herramientasService.eliminar(h.id);
      setAviso(`«${h.nombre}» se borró del catálogo.`);
      await cargar();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo borrar."));
    }
  }

  const filtradas = useMemo(() => {
    const texto = buscar.trim().toLowerCase();
    if (!uso || !texto) return uso ?? [];
    return uso.filter(
      (h) =>
        h.nombre.toLowerCase().includes(texto) ||
        h.usuarios.some(
          (u) =>
            u.nombre.toLowerCase().includes(texto) ||
            u.correo.toLowerCase().includes(texto),
        ),
    );
  }, [uso, buscar]);

  return (
    <div className="mz-stack">
      <div className="d-flex flex-wrap gap-2 align-items-center justify-content-between">
        <p className="mz-faint mb-0">
          Las herramientas externas e internas que se usan en la empresa y quién
          usa cada una. Cada persona indica las suyas en «Mi perfil»; las que
          necesita cada cargo se marcan en «Perfiles de cargo».
        </p>
        <div className="mz-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setEditando({ ...VACIA })}
          >
            <Icon name="plus-lg" /> Nueva herramienta
          </button>
        </div>
      </div>

      {/* Pestañas con flechas y su panel (auditoría UX/UI, fase 2,
          28/10/2026). */}
      <Pestanas
        etiqueta="Herramientas"
        idBase="herr"
        valor={pestana}
        onCambio={setPestana}
        opciones={[
          { id: "uso", etiqueta: "Quién usa qué" },
          { id: "catalogo", etiqueta: "Catálogo" },
        ]}
      />

      {aviso && (
        <div className="mz-alert mz-alert--ok" role="status">
          <Icon name="check-circle" />
          {aviso}
        </div>
      )}

      <PanelDePestana idBase="herr" valor={pestana} className="mz-stack">
        <EstadoDeCarga
          cargando={uso === null}
          error={error}
          onReintentar={error && uso === null ? cargar : undefined}
          vacio={uso?.length === 0}
          textoVacio="Todavía no hay herramientas en el catálogo."
        />

        {uso?.length > 0 && pestana === "uso" && (
          <>
            <input
              type="search"
              className="form-control form-control-sm perfil-cargo-buscar"
              placeholder="Buscar herramienta o persona…"
              aria-label="Buscar herramienta o persona"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
            />
            <div className="herramientas-uso">
              {filtradas.length === 0 && (
                <EstadoDeCarga
                  vacio
                  hayFiltros
                  onLimpiarFiltros={() => setBuscar("")}
                />
              )}
              {filtradas.map((h) => (
                <section key={h.id} className="mz-card">
                  <div className="mz-card-body">
                    <h4 className="inicio-titulo">
                      {h.nombre}{" "}
                      <span className="mz-faint mz-small">
                        · {TIPOS[h.tipo]} · {h.usuarios.length}{" "}
                        {h.usuarios.length === 1 ? "persona" : "personas"}
                        {!h.activa && " · inactiva"}
                      </span>
                    </h4>
                    {h.usuarios.length ? (
                      <ul className="perfil-cargo-lista">
                        {h.usuarios.map((u) => (
                          <li key={u.id}>
                            <span className="perfil-cargo-lista__nombre">
                              {u.nombre}
                              <small className="mz-faint"> · {u.correo}</small>
                              {!u.activo && (
                                <span className="perfil-cargo-estado perfil-cargo-estado--vacio ms-2">
                                  Cuenta deshabilitada
                                </span>
                              )}
                            </span>
                            {u.cuenta && (
                              <small className="mz-faint">
                                Usuario: {u.cuenta}
                              </small>
                            )}
                            {u.detalle && (
                              <small className="mis-herramientas__detalle">
                                {u.detalle}
                              </small>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mz-faint mb-0">Nadie la usa todavía.</p>
                    )}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}

        {uso?.length > 0 && pestana === "catalogo" && (
          <div className="mz-card">
            <div className="mz-card-body">
              <ul className="perfil-cargo-lista">
                {uso.map((h) => (
                  <li key={h.id}>
                    <span className="perfil-cargo-lista__nombre">
                      <strong>{h.nombre}</strong>
                      {h.descripcion && (
                        <small className="mz-faint"> · {h.descripcion}</small>
                      )}
                    </span>
                    <span className="perfil-cargo-estado perfil-cargo-estado--vacio">
                      {TIPOS[h.tipo]}
                    </span>
                    {!h.activa && (
                      <span className="perfil-cargo-estado perfil-cargo-estado--parcial">
                        Inactiva
                      </span>
                    )}
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm"
                      aria-label={`Editar ${h.nombre}`}
                      onClick={() => setEditando(h)}
                    >
                      <Icon name="pencil" />
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      aria-label={`Borrar ${h.nombre}`}
                      disabled={h.usuarios.length > 0}
                      title={
                        h.usuarios.length
                          ? "Hay personas que la usan: desactívela en vez de borrarla"
                          : undefined
                      }
                      onClick={() => borrar(h)}
                    >
                      <Icon name="trash" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </PanelDePestana>

      {editando && (
        <EditorHerramienta
          inicial={editando}
          onGuardar={guardar}
          onCambioAccesos={cargar}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
}
