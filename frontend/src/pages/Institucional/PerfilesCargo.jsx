import { useEffect, useMemo, useRef, useState } from "react";

import { herramientasService } from "../../api/herramientasService";
import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";
import { usePedirMotivo } from "../../components/common/PedirMotivo/PedirMotivo";

const ESTADO = {
  completo: ["Completo", "perfil-cargo-estado--completo"],
  parcial: ["A medias", "perfil-cargo-estado--parcial"],
  vacio: ["Sin perfil", "perfil-cargo-estado--vacio"],
};

/** Las listas del perfil: campo, título, cómo se llama cada entrada y un
 * ejemplo. Se escriben una por fila y «Mi cargo» las muestra numeradas. */
const LISTAS = [
  ["funciones", "Funciones", "función", "Gestionar la cartera vencida"],
  ["competencias", "Competencias", "competencia", "Negociación"],
  [
    "kpis",
    "KPIs o métricas de medición",
    "KPI o métrica",
    "Recuperación de cartera ≥ 90 % mensual",
  ],
];

let siguienteId = 0;
const entrada = (texto = "") => ({ id: ++siguienteId, texto });

/** Una lista del perfil editable fila por fila (27/10/2026): Enter agrega
 * la siguiente, Retroceso en una fila vacía la quita, las flechas cambian el
 * orden y pegar varias líneas crea una fila por línea. */
function ListaEditable({ campo, titulo, nombre, ejemplo, items, onChange }) {
  const filas = useRef(new Map());
  const [enfocar, setEnfocar] = useState(null);

  useEffect(() => {
    if (enfocar === null) return;
    filas.current.get(enfocar)?.focus();
    setEnfocar(null);
  }, [enfocar, items]);

  function cambiar(id, texto) {
    onChange(items.map((i) => (i.id === id ? { ...i, texto } : i)));
  }

  function insertar(despuesDe, textos = [""]) {
    const nuevas = textos.map((t) => entrada(t));
    const posicion = items.findIndex((i) => i.id === despuesDe) + 1;
    onChange([
      ...items.slice(0, posicion),
      ...nuevas,
      ...items.slice(posicion),
    ]);
    setEnfocar(nuevas[nuevas.length - 1].id);
  }

  function quitar(id) {
    const posicion = items.findIndex((i) => i.id === id);
    const quedan = items.filter((i) => i.id !== id);
    onChange(quedan.length ? quedan : [entrada()]);
    const vecina = quedan[Math.max(posicion - 1, 0)];
    if (vecina) setEnfocar(vecina.id);
  }

  function mover(id, paso) {
    const posicion = items.findIndex((i) => i.id === id);
    const destino = posicion + paso;
    if (destino < 0 || destino >= items.length) return;
    const copia = [...items];
    [copia[posicion], copia[destino]] = [copia[destino], copia[posicion]];
    onChange(copia);
    setEnfocar(id);
  }

  function teclas(evento, item) {
    if (evento.key === "Enter") {
      evento.preventDefault();
      insertar(item.id);
    } else if (
      evento.key === "Backspace" &&
      item.texto === "" &&
      items.length > 1
    ) {
      evento.preventDefault();
      quitar(item.id);
    }
  }

  function pegar(evento, item) {
    const lineas = evento.clipboardData
      .getData("text")
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:[-•·*]|\d+[.)])\s*/, "").trim())
      .filter(Boolean);
    if (lineas.length < 2) return;
    evento.preventDefault();
    const [primera, ...resto] = lineas;
    const conPrimera = items.map((i) =>
      i.id === item.id ? { ...i, texto: `${i.texto}${primera}` } : i,
    );
    const posicion = conPrimera.findIndex((i) => i.id === item.id) + 1;
    const nuevas = resto.map((t) => entrada(t));
    onChange([
      ...conPrimera.slice(0, posicion),
      ...nuevas,
      ...conPrimera.slice(posicion),
    ]);
    setEnfocar(nuevas[nuevas.length - 1].id);
  }

  return (
    <fieldset
      className="perfil-lista"
      aria-describedby={`perfil-${campo}-ayuda`}
    >
      <legend className="form-label mz-small">{titulo}</legend>
      <ol className="perfil-lista__filas">
        {items.map((item, i) => (
          <li key={item.id}>
            <span className="perfil-lista__numero" aria-hidden="true">
              {i + 1}.
            </span>
            <input
              ref={(nodo) =>
                nodo
                  ? filas.current.set(item.id, nodo)
                  : filas.current.delete(item.id)
              }
              type="text"
              className="form-control form-control-sm"
              aria-label={`${titulo}: ${nombre} ${i + 1}`}
              placeholder={i === 0 ? `Ej.: ${ejemplo}` : ""}
              value={item.texto}
              maxLength={500}
              onChange={(e) => cambiar(item.id, e.target.value)}
              onKeyDown={(e) => teclas(e, item)}
              onPaste={(e) => pegar(e, item)}
            />
            <div className="perfil-lista__acciones">
              <button
                type="button"
                className="btn btn-link btn-sm"
                aria-label={`Subir ${nombre} ${i + 1}`}
                disabled={i === 0}
                onClick={() => mover(item.id, -1)}
              >
                <Icon name="arrow-up" />
              </button>
              <button
                type="button"
                className="btn btn-link btn-sm"
                aria-label={`Bajar ${nombre} ${i + 1}`}
                disabled={i === items.length - 1}
                onClick={() => mover(item.id, 1)}
              >
                <Icon name="arrow-down" />
              </button>
              <button
                type="button"
                className="btn btn-link btn-sm text-danger"
                aria-label={`Quitar ${nombre} ${i + 1}`}
                onClick={() => quitar(item.id)}
              >
                <Icon name="x-lg" />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="d-flex flex-wrap gap-2 align-items-center">
        <button
          type="button"
          className="btn btn-outline-primary btn-sm"
          onClick={() => insertar(items[items.length - 1]?.id)}
        >
          <Icon name="plus-lg" /> Agregar {nombre}
        </button>
        <span id={`perfil-${campo}-ayuda`} className="form-text m-0">
          Una entrada por fila; Enter agrega la siguiente. Quien ocupe el cargo
          las ve numeradas, en este orden.
        </span>
      </div>
    </fieldset>
  );
}

const aFilas = (lista) =>
  lista?.length ? lista.map((t) => entrada(t)) : [entrada()];
const aLista = (filas) => filas.map((f) => f.texto.trim()).filter(Boolean);

function EditorPerfil({ cargo, onGuardado, onCerrar }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const [valores, setValores] = useState(null);
  const [catalogo, setCatalogo] = useState([]);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [pedirMotivo, dialogoMotivo] = usePedirMotivo();

  // El perfil guardado, con cada lista en filas, y el catálogo de
  // herramientas para marcar las que necesita el cargo.
  useEffect(() => {
    institucionalService
      .perfilCargo(cargo.id)
      .then((p) =>
        setValores({
          objetivo: p.objetivo,
          funciones: aFilas(p.funciones),
          competencias: aFilas(p.competencias),
          kpis: aFilas(p.kpis),
          herramientas: p.herramientas ?? [],
        }),
      )
      .catch((err) =>
        setError(mensajeDeError(err, "No se pudo cargar el perfil.")),
      );
    Promise.resolve(herramientasService.catalogo?.())
      .then((lista) => setCatalogo((lista ?? []).filter((h) => h.activa)))
      .catch(() => setCatalogo([]));
  }, [cargo.id]);

  function alternarHerramienta(id) {
    setValores((v) => ({
      ...v,
      herramientas: v.herramientas.includes(id)
        ? v.herramientas.filter((x) => x !== id)
        : [...v.herramientas, id],
    }));
  }

  async function guardar(evento) {
    evento.preventDefault();
    const motivo = await pedirMotivo(
      `Cambios en el perfil de «${cargo.nombre}».`,
    );
    if (!motivo) return;
    setGuardando(true);
    setError(null);
    try {
      await institucionalService.guardarPerfilCargo(
        cargo.id,
        {
          ...valores,
          funciones: aLista(valores.funciones),
          competencias: aLista(valores.competencias),
          kpis: aLista(valores.kpis),
        },
        motivo,
      );
      onGuardado();
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar el perfil."));
      setGuardando(false);
    }
  }

  return (
    <div
      className="mz-overlay mz-overlay--center"
      onClick={handleBackdropClick}
      role="presentation"
    >
      {dialogoMotivo}
      <div
        className="mz-modal mz-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="perfil-cargo-titulo"
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mz-panel-head">
          <div>
            <h3 id="perfil-cargo-titulo">Perfil de «{cargo.nombre}»</h3>
            <p className="mz-desc">
              Quien ocupe este cargo lo verá en «Mi perfil».
            </p>
          </div>
          <button
            type="button"
            className="mz-close"
            onClick={onCerrar}
            aria-label="Cerrar"
          >
            <Icon name="x-lg" />
          </button>
        </div>
        <form className="mz-panel-body mz-stack" onSubmit={guardar}>
          {error && (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              {error}
            </div>
          )}
          {!valores && !error && <p className="mz-faint">Cargando…</p>}
          {valores && (
            <div>
              <label className="form-label mz-small" htmlFor="perfil-objetivo">
                Objetivo del cargo
              </label>
              <textarea
                id="perfil-objetivo"
                rows={3}
                className="form-control form-control-sm"
                aria-describedby="perfil-objetivo-ayuda"
                value={valores.objetivo}
                onChange={(e) =>
                  setValores((v) => ({ ...v, objetivo: e.target.value }))
                }
              />
              <div id="perfil-objetivo-ayuda" className="form-text">
                Para qué existe el cargo, en una o dos frases.
              </div>
            </div>
          )}
          {valores &&
            LISTAS.map(([campo, titulo, nombre, ejemplo]) => (
              <ListaEditable
                key={campo}
                campo={campo}
                titulo={titulo}
                nombre={nombre}
                ejemplo={ejemplo}
                items={valores[campo]}
                onChange={(items) =>
                  setValores((v) => ({ ...v, [campo]: items }))
                }
              />
            ))}
          {valores && (
            <fieldset className="perfil-cargo-herramientas">
              <legend>Herramientas y licencias</legend>
              <p className="form-text mt-0">
                Las que necesita el cargo: con ellas debe venir configurado el
                equipo de quien lo ocupa.
              </p>
              {catalogo.length === 0 ? (
                <p className="mz-faint mb-0">
                  Todavía no hay herramientas en el catálogo: agréguelas en la
                  pestaña «Herramientas y licencias».
                </p>
              ) : (
                [
                  ["externa", "Externas"],
                  ["interna", "Internas"],
                ].map(([tipo, titulo]) => {
                  const lista = catalogo.filter((h) => h.tipo === tipo);
                  if (!lista.length) return null;
                  return (
                    <div
                      key={tipo}
                      className="perfil-cargo-herramientas__grupo"
                    >
                      <span className="mz-small mz-faint">{titulo}</span>
                      {lista.map((h) => (
                        <label key={h.id} className="form-check mb-0">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={valores.herramientas.includes(h.id)}
                            onChange={() => alternarHerramienta(h.id)}
                          />{" "}
                          <span className="form-check-label">{h.nombre}</span>
                        </label>
                      ))}
                    </div>
                  );
                })
              )}
            </fieldset>
          )}
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
              disabled={!valores || guardando}
            >
              {guardando ? "Guardando…" : "Guardar perfil"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * Pestaña «Perfiles de cargo» de Editar estructura: el objetivo, las
 * funciones, las competencias y los KPIs de cada cargo, por unidad. Lo ve en
 * «Mi perfil» quien ocupa el cargo.
 */
export function PerfilesCargo({ datos, onGuardado }) {
  const [editando, setEditando] = useState(null);
  const [buscar, setBuscar] = useState("");

  const porUnidad = useMemo(() => {
    const texto = buscar.trim().toLowerCase();
    return datos.unidades
      .map((u) => ({
        unidad: u,
        cargos: datos.cargos.filter(
          (c) =>
            c.unidad === u.id &&
            (!texto || c.nombre.toLowerCase().includes(texto)),
        ),
      }))
      .filter((g) => g.cargos.length > 0);
  }, [datos, buscar]);

  const completos = datos.cargos.filter((c) => c.perfil === "completo").length;

  return (
    <div className="mz-stack">
      <div className="d-flex flex-wrap gap-2 align-items-center justify-content-between">
        <p className="mz-faint mb-0">
          {completos} de {datos.cargos.length} cargos con su perfil completo
          (objetivo, funciones, competencias y KPIs).
        </p>
        <input
          type="search"
          className="form-control form-control-sm perfil-cargo-buscar"
          placeholder="Buscar cargo…"
          aria-label="Buscar cargo"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
        />
      </div>
      {porUnidad.map(({ unidad, cargos }) => (
        <section key={unidad.id} className="mz-card">
          <div className="mz-card-body">
            <h4 className="inicio-titulo">{unidad.nombre}</h4>
            <ul className="perfil-cargo-lista">
              {cargos.map((c) => {
                const [texto, clase] = ESTADO[c.perfil] ?? ESTADO.vacio;
                return (
                  <li key={c.id}>
                    <span className="perfil-cargo-lista__nombre">
                      {c.nombre}
                    </span>
                    <span className={`perfil-cargo-estado ${clase}`}>
                      {texto}
                    </span>
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm"
                      aria-label={`Editar perfil de ${c.nombre}`}
                      onClick={() => setEditando(c)}
                    >
                      <Icon name="pencil" /> Editar perfil
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ))}
      {editando && (
        <EditorPerfil
          cargo={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            onGuardado?.();
          }}
        />
      )}
    </div>
  );
}
