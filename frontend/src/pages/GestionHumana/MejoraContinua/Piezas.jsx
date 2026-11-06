/*
 * Piezas de Mejora continua compartidas por el tablero y el detalle: la
 * etapa, el impacto, el autor con su insignia «Innovador», la barra de avance
 * y el voto. El color nunca va solo: cada semáforo dice su texto.
 */
import { useRef, useState } from "react";

import {
  errorDeMejora,
  mejoraContinuaService,
} from "../../../api/mejoraContinuaService";
import { Icon } from "../../../components/common/Icon/Icon";
import { Semaforo } from "../Desempeno/Componentes";
import { ETAPA, IMPACTO } from "./mejoraComunes";

export function PildoraEtapa({ status, texto }) {
  const etapa = ETAPA[status];
  return (
    <Semaforo tono={etapa?.tono ?? "neutral"}>
      {etapa && <Icon name={etapa.icono} />}
      {texto || etapa?.texto || status}
    </Semaforo>
  );
}

export function PildoraImpacto({ impact, texto }) {
  const impacto = IMPACTO[impact];
  return (
    <Semaforo tono={impacto?.tono ?? "neutral"}>
      {impacto && <Icon name={impacto.icono} />}
      Impacto {(texto || impacto?.texto || impact || "").toLowerCase()}
    </Semaforo>
  );
}

/** La insignia de Nexo: quien tiene una idea implementada en la empresa. */
export function Innovador() {
  return (
    <Semaforo tono="ok" className="mc-innovador">
      <Icon name="award" /> Innovador
    </Semaforo>
  );
}

export function Autor({ autor, conRol = false }) {
  if (!autor) return <span>—</span>;
  return (
    <span className="mc-autor">
      <span>{autor.full_name || autor.name}</span>
      {conRol && autor.role_label && (
        <span className="mz-faint"> · {autor.role_label}</span>
      )}
      {autor.innovador && (
        <>
          {" "}
          <Innovador />
        </>
      )}
    </span>
  );
}

/** El avance de 0 a 100, con su número en texto. */
export function BarraDeAvance({ valor, etiqueta = "Avance" }) {
  const pct = Math.max(0, Math.min(100, Number(valor) || 0));
  return (
    <div className="mc-avance">
      <div className="mc-avance__texto">
        <span>{etiqueta}</span>
        <span className="mz-strong">{pct}%</span>
      </div>
      <div
        className="mc-avance__pista"
        role="progressbar"
        aria-label={etiqueta}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span className="mc-avance__relleno" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const votosEnTexto = (n) => `${n} ${n === 1 ? "voto" : "votos"}`;

/**
 * El voto tipo «me gusta». Optimista: el conteo cambia al instante y, si el
 * servidor falla, vuelve a lo que era y se avisa con `onError`. `onCambio`
 * recibe `{ vote_count, voted_by_me }` (el estimado y luego el del servidor).
 * Sin permiso para votar, solo se muestra el conteo.
 */
export function BotonVoto({ idea, puedeVotar, onCambio, onError }) {
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);
  const total = idea.vote_count ?? 0;

  if (!puedeVotar)
    return (
      <span className="mc-votos mz-small">
        <Icon name="hand-thumbs-up" /> {votosEnTexto(total)}
      </span>
    );

  async function alternar() {
    if (enCurso.current) return;
    enCurso.current = true;
    setEnviando(true);
    const antes = { vote_count: total, voted_by_me: Boolean(idea.voted_by_me) };
    const quiere = !antes.voted_by_me;
    onCambio({
      vote_count: Math.max(0, total + (quiere ? 1 : -1)),
      voted_by_me: quiere,
    });
    try {
      const respuesta = await (quiere
        ? mejoraContinuaService.votar(idea.id)
        : mejoraContinuaService.quitarVoto(idea.id));
      onCambio({
        vote_count: respuesta.vote_count,
        voted_by_me: respuesta.voted_by_me,
      });
    } catch (err) {
      onCambio(antes);
      onError?.(
        errorDeMejora(
          err,
          quiere
            ? "No se pudo registrar su voto. Intente de nuevo."
            : "No se pudo quitar su voto. Intente de nuevo.",
        ).mensaje,
      );
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  return (
    <button
      type="button"
      className={`btn btn-sm mc-voto${idea.voted_by_me ? " mc-voto--hecho" : ""}`}
      aria-pressed={Boolean(idea.voted_by_me)}
      aria-label={`Votar por «${idea.title}» (${votosEnTexto(total)})`}
      aria-busy={enviando || undefined}
      onClick={alternar}
    >
      <Icon
        name={idea.voted_by_me ? "hand-thumbs-up-fill" : "hand-thumbs-up"}
      />{" "}
      {total}
    </button>
  );
}
