/*
 * Mejora continua de Gestión Humana (`IdeasModule`/`IdeasBoard` de Nexo): el
 * tablero de ideas por etapa, la pestaña «Mis ideas» (`mine=1`), filtros por
 * impacto y para ocultar las rechazadas, el voto y «Proponer idea».
 *
 * En pantallas anchas, una columna por etapa; en las estrechas (≤ 880 px),
 * las etapas una debajo de otra como lista (`MejoraContinua.css`). Qué ideas
 * aparecen lo decide el servidor (las propias y las del equipo, o todas).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import {
  errorDeMejora,
  mejoraContinuaService,
} from "../../../api/mejoraContinuaService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../../components/common/Pestanas/Pestanas";
import { Aviso } from "../comunes";
import { Semaforo } from "../Desempeno/Componentes";
import { Encabezado } from "../Tareas/ContextoTareas";
import { ConAccesoMejora, useMejoraContinua } from "./ContextoMejoraContinua";
import { FormularioIdea } from "./FormularioIdea";
import { ETAPAS, IMPACTOS, idTarjetaIdea, rutaDeIdea } from "./mejoraComunes";
import { Autor, BarraDeAvance, BotonVoto, PildoraImpacto } from "./Piezas";

const TITULO = "Mejora continua";

export function MejoraContinua() {
  return (
    <ConAccesoMejora titulo={TITULO}>
      <Tablero />
    </ConAccesoMejora>
  );
}

function Tablero() {
  const { puedeProponer, puedeVotar, veTodas } = useMejoraContinua();
  const location = useLocation();
  const navigate = useNavigate();
  // Pestaña y filtros viven en la URL: al volver del detalle (o recargar)
  // el tablero queda como se dejó.
  const [parametros, setParametros] = useSearchParams();
  const vista = parametros.get("vista") === "mias" ? "mias" : "todas";
  const impacto = parametros.get("impacto") ?? "";
  const ocultarRechazadas = parametros.get("ocultar") === "1";
  const [ideas, setIdeas] = useState(null);
  const [error, setError] = useState(null);
  const [vez, setVez] = useState(0);
  const [proponiendo, setProponiendo] = useState(false);
  const [aviso, setAviso] = useState(location.state?.aviso ?? null);
  // La tarjeta de la que se vino (el «Volver» del detalle la manda).
  const desde = useRef(location.state?.desde ?? null);

  function fijar(clave, valor) {
    setParametros(
      (actuales) => {
        const nuevos = new URLSearchParams(actuales);
        if (valor) nuevos.set(clave, valor);
        else nuevos.delete(clave);
        return nuevos;
      },
      { replace: true },
    );
  }

  // El aviso llega en el estado de la navegación: se copia y se borra del
  // historial (conservando los filtros), si no reaparece al recargar.
  useEffect(() => {
    if (location.state)
      navigate(
        { pathname: location.pathname, search: location.search },
        { replace: true, state: null },
      );
    // Solo al llegar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // De vuelta del detalle, el foco regresa a la idea que se abrió.
  useEffect(() => {
    if (!ideas || !desde.current) return;
    document.getElementById(idTarjetaIdea(desde.current))?.focus();
    desde.current = null;
  }, [ideas]);

  useEffect(() => {
    let vigente = true;
    setError(null);
    setIdeas(null);
    mejoraContinuaService
      .listar({ soloMias: vista === "mias" })
      .then((lista) => {
        if (vigente) setIdeas(Array.isArray(lista) ? lista : []);
      })
      .catch((err) => {
        if (vigente)
          setError(
            errorDeMejora(err, "No se pudieron cargar las ideas.").mensaje,
          );
      });
    return () => {
      vigente = false;
    };
  }, [vista, vez]);

  const cambiarVoto = useCallback((id, voto) => {
    setIdeas((lista) =>
      (lista ?? []).map((i) => (i.id === id ? { ...i, ...voto } : i)),
    );
  }, []);

  const filtradas = useMemo(
    () => (ideas ?? []).filter((i) => !impacto || i.impact === impacto),
    [ideas, impacto],
  );
  const columnas = ocultarRechazadas
    ? ETAPAS.filter((e) => e.id !== "RECHAZADA")
    : ETAPAS;
  const hayFiltros = Boolean(impacto || ocultarRechazadas);
  const visibles = filtradas.filter((i) =>
    columnas.some((c) => c.id === i.status),
  );

  return (
    <div className="gh-page">
      <Encabezado
        titulo={TITULO}
        descripcion={
          veTodas
            ? "Las ideas de mejora de procesos de toda la empresa, por etapa."
            : "Sus ideas de mejora de procesos y las de su equipo, por etapa."
        }
      >
        {puedeProponer && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setProponiendo(true)}
          >
            <Icon name="plus-lg" /> Proponer idea
          </button>
        )}
      </Encabezado>

      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />

      <Pestanas
        etiqueta="Ideas"
        idBase="mc-ideas"
        valor={vista}
        onCambio={(v) => fijar("vista", v === "mias" ? "mias" : "")}
        opciones={[
          { id: "todas", etiqueta: "Tablero", icono: "kanban" },
          { id: "mias", etiqueta: "Mis ideas", icono: "person" },
        ]}
      />
      <PanelDePestana idBase="mc-ideas" valor={vista} className="gh-page">
        <form
          className="mz-filter-bar mc-filtros"
          role="search"
          aria-label="Filtrar ideas"
          onSubmit={(e) => e.preventDefault()}
        >
          <select
            className="form-select form-select-sm"
            aria-label="Filtrar por impacto"
            value={impacto}
            onChange={(e) => fijar("impacto", e.target.value)}
          >
            <option value="">Todo impacto</option>
            {IMPACTOS.map((i) => (
              <option key={i.id} value={i.id}>
                Impacto {i.texto.toLowerCase()}
              </option>
            ))}
          </select>
          <label className="mc-casilla">
            <input
              type="checkbox"
              className="form-check-input"
              checked={ocultarRechazadas}
              onChange={(e) => fijar("ocultar", e.target.checked ? "1" : "")}
            />
            Ocultar rechazadas
          </label>
        </form>

        <EstadoDeCarga
          cargando={ideas === null && !error}
          error={error}
          onReintentar={() => setVez((v) => v + 1)}
          vacio={ideas !== null && visibles.length === 0}
          hayFiltros={hayFiltros && ideas?.length > 0}
          onLimpiarFiltros={() =>
            setParametros(vista === "mias" ? { vista } : {}, { replace: true })
          }
          textoVacio={
            vista === "mias"
              ? "Todavía no ha propuesto ideas."
              : "Todavía no hay ideas en el tablero."
          }
          accionVacio={
            puedeProponer ? (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setProponiendo(true)}
              >
                Proponer la primera idea
              </button>
            ) : null
          }
        />

        {/* Siempre montado: una región viva que aparece ya con texto no se
            anuncia. */}
        <p className="mz-small mz-faint mb-0" role="status">
          {ideas !== null && visibles.length > 0
            ? `${visibles.length} ${visibles.length === 1 ? "idea" : "ideas"}`
            : ""}
        </p>
        {visibles.length > 0 && (
          <>
            <div
              className="mc-tablero"
              role="region"
              aria-label="Tablero de ideas"
              // Se desplaza en horizontal en escritorio: con foco para
              // recorrerlo con el teclado (WCAG 2.1.1).
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
              tabIndex={0}
            >
              {columnas.map((etapa) => (
                <Columna
                  key={etapa.id}
                  etapa={etapa}
                  ideas={filtradas.filter((i) => i.status === etapa.id)}
                  puedeVotar={puedeVotar}
                  onVoto={cambiarVoto}
                  onError={(texto) => setAviso({ tono: "bad", texto })}
                  volverA={location.search}
                />
              ))}
            </div>
          </>
        )}
      </PanelDePestana>

      {proponiendo && (
        <FormularioIdea
          onCerrar={() => setProponiendo(false)}
          onCreada={(idea) => {
            setProponiendo(false);
            setAviso({
              texto: `Idea «${idea.title}» propuesta. Quedó en la etapa Propuesta.`,
            });
            setIdeas((lista) => [idea, ...(lista ?? [])]);
          }}
        />
      )}
    </div>
  );
}

function Columna({ etapa, ideas, puedeVotar, onVoto, onError, volverA }) {
  const idTitulo = `mc-etapa-${etapa.id}`;
  // Vacía: estrecha en escritorio y una sola línea «Etapa · 0» en el
  // teléfono, para que las siete etapas entren sin desplazarse tanto.
  const vacia = ideas.length === 0;
  return (
    <section
      className={`mc-columna mc-columna--${etapa.tono}${vacia ? " mc-columna--vacia" : ""}`}
      aria-labelledby={idTitulo}
    >
      <h3 id={idTitulo} className="mc-columna__titulo">
        {/* El nombre se ajusta en varias líneas si hace falta; el contador
            nunca se parte y queda arriba a la derecha. */}
        <span className="mc-columna__nombre">
          <Icon name={etapa.icono} /> {etapa.texto}
        </span>
        <span className="mc-columna__cuenta">
          <span className="mc-columna__punto" aria-hidden="true">
            ·{" "}
          </span>
          {ideas.length}
          <span className="visually-hidden">
            {ideas.length === 1 ? " idea" : " ideas"}
          </span>
        </span>
      </h3>
      {ideas.length === 0 ? (
        <p className="mz-small mz-faint mb-0 mc-columna__vacia">
          Sin ideas en esta etapa.
        </p>
      ) : (
        <ul className="mc-tarjetas">
          {ideas.map((i) => (
            <TarjetaIdea
              key={i.id}
              idea={i}
              puedeVotar={puedeVotar}
              onVoto={(voto) => onVoto(i.id, voto)}
              onError={onError}
              volverA={volverA}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TarjetaIdea({ idea, puedeVotar, onVoto, onError, volverA }) {
  const conAvance =
    idea.status === "EN_DESARROLLO" ||
    idea.status === "EN_PRUEBAS" ||
    idea.progress > 0;
  return (
    <li className="mc-tarjeta">
      {/* El título va solo en su línea: con «Mi idea» al lado se partía a
          mitad de palabra. «Mi idea» va con el impacto. */}
      <Link
        id={idTarjetaIdea(idea.id)}
        to={rutaDeIdea(idea.id)}
        state={{ volverA }}
        className="mc-tarjeta__titulo"
      >
        {idea.title}
      </Link>
      <div className="mz-pill-row">
        {idea.is_mine && <Semaforo tono="info">Mi idea</Semaforo>}
        <PildoraImpacto impact={idea.impact} texto={idea.impact_label} />
        {idea.attachment && (
          <Semaforo tono="neutral">
            <Icon name="paperclip" /> Adjunto
          </Semaforo>
        )}
      </div>
      {conAvance && <BarraDeAvance valor={idea.progress} />}
      {idea.status === "RECHAZADA" && idea.latest_rejection_comment && (
        <p className="mz-small mb-0 mc-tarjeta__motivo">
          <span className="mz-strong">Motivo:</span>{" "}
          {idea.latest_rejection_comment}
        </p>
      )}
      <div className="mc-tarjeta__pie">
        <span className="mz-small mz-faint mc-tarjeta__autor">
          <Autor autor={idea.author} />
        </span>
        <BotonVoto
          idea={idea}
          puedeVotar={puedeVotar}
          onCambio={onVoto}
          onError={onError}
        />
      </div>
    </li>
  );
}
