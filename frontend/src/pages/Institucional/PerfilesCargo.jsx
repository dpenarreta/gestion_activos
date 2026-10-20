import { useEffect, useMemo, useState } from "react";

import { herramientasService } from "../../api/herramientasService";
import { institucionalService } from "../../api/institucionalService";
import { Icon } from "../../components/common/Icon/Icon";
import { useModalA11y } from "../../hooks/useModalA11y";
import { mensajeDeError } from "../../utils/errores";

const ESTADO = {
  completo: ["Completo", "perfil-cargo-estado--completo"],
  parcial: ["A medias", "perfil-cargo-estado--parcial"],
  vacio: ["Sin perfil", "perfil-cargo-estado--vacio"],
};

const CAMPOS = [
  [
    "objetivo",
    "Objetivo del cargo",
    "Para qué existe el cargo, en una o dos frases.",
    3,
  ],
  [
    "funciones",
    "Funciones",
    "Una por línea. Ej.: Gestionar la cartera vencida.",
    6,
  ],
  [
    "competencias",
    "Competencias",
    "Una por línea. Ej.: Negociación, Orientación a resultados.",
    4,
  ],
  [
    "kpis",
    "KPIs o métricas de medición",
    "Uno por línea, con su meta. Ej.: Recuperación de cartera ≥ 90 % mensual.",
    4,
  ],
];

function EditorPerfil({ cargo, onGuardado, onCerrar }) {
  const { panelRef, handleBackdropClick } = useModalA11y({
    isOpen: true,
    onRequestClose: onCerrar,
  });
  const [valores, setValores] = useState(null);
  const [catalogo, setCatalogo] = useState([]);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  // El perfil guardado, con las listas como texto (una por línea), y el
  // catálogo de herramientas para marcar las que necesita el cargo.
  useEffect(() => {
    institucionalService
      .perfilCargo(cargo.id)
      .then((p) =>
        setValores({
          objetivo: p.objetivo,
          funciones: p.funciones.join("\n"),
          competencias: p.competencias.join("\n"),
          kpis: p.kpis.join("\n"),
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
    setGuardando(true);
    setError(null);
    try {
      await institucionalService.guardarPerfilCargo(cargo.id, valores);
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
          {valores &&
            CAMPOS.map(([campo, etiqueta, ayuda, filas]) => (
              <div key={campo}>
                <label
                  className="form-label mz-small"
                  htmlFor={`perfil-${campo}`}
                >
                  {etiqueta}
                </label>
                <textarea
                  id={`perfil-${campo}`}
                  rows={filas}
                  className="form-control form-control-sm"
                  aria-describedby={`perfil-${campo}-ayuda`}
                  value={valores[campo]}
                  onChange={(e) =>
                    setValores((v) => ({ ...v, [campo]: e.target.value }))
                  }
                />
                <div id={`perfil-${campo}-ayuda`} className="form-text">
                  {ayuda}
                </div>
              </div>
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
