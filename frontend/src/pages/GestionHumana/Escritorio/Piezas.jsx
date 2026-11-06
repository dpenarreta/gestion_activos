/*
 * Piezas del Escritorio compartidas por las notas y los recordatorios: el
 * semáforo de una opción (prioridad, estado), el adjunto (PDF e imagen en el
 * visor interno; Word y Excel se descargan) y la bitácora, que se pide solo
 * al abrirla.
 */
import { useId, useState } from "react";

import { errorDeEscritorio } from "../../../api/escritorioService";
import { Icon } from "../../../components/common/Icon/Icon";
import { useVisorDeAdjuntos } from "../../Soporte/VisorAdjunto";
import { ErrorEnLinea, fechaHora } from "../comunes";
import { Semaforo } from "../Desempeno/Componentes";
import { tamano } from "../MejoraContinua/mejoraComunes";
import { buscarOpcion, nombreDe } from "./escritorioComunes";

/** Una opción con su tono, su ícono y su texto. */
export function Pildora({ opciones, valor, prefijo = "" }) {
  const o = buscarOpcion(opciones, valor);
  return (
    <Semaforo tono={o.tono}>
      <Icon name={o.icono} />
      {prefijo}
      {o.texto}
    </Semaforo>
  );
}

/** El adjunto de una nota o de un recordatorio. `url` es la ruta protegida
 * de la API: se pide con la sesión y nunca se pone en un `href`. */
export function Adjunto({ adjunto, idBase }) {
  const { abrir, abriendo, visor, error } = useVisorDeAdjuntos();
  if (!adjunto) return null;
  const adentro = Boolean(adjunto.viewer);
  const url = adentro ? adjunto.url : `${adjunto.url}?download=1`;
  return (
    <div>
      <div className="ed-archivo">
        <Icon name={adentro ? "file-earmark-richtext" : "file-earmark"} />
        <span className="ed-archivo__nombre">
          {adjunto.name}
          {adjunto.size ? (
            <span className="mz-faint"> ({tamano(adjunto.size)})</span>
          ) : null}
        </span>
        <button
          type="button"
          className="btn btn-outline-primary btn-sm"
          disabled={abriendo === idBase}
          onClick={() => abrir({ id: idBase, url, nombre: adjunto.name })}
        >
          <Icon name={adentro ? "eye" : "download"} />{" "}
          {abriendo === idBase ? "Abriendo…" : adentro ? "Ver" : "Descargar"}
          <span className="visually-hidden"> {adjunto.name}</span>
        </button>
      </div>
      <ErrorEnLinea mensaje={error} className="mt-2" />
      {visor}
    </div>
  );
}

/**
 * «Ver historial»: un botón que despliega la bitácora (se pide al abrirla,
 * no antes). `cargar` es la función del servicio que la trae.
 */
export function Historial({ cargar }) {
  const idPanel = `${useId()}-historial`;
  const [abierto, setAbierto] = useState(false);
  const [eventos, setEventos] = useState(null);
  const [error, setError] = useState(null);

  function pedir() {
    setError(null);
    setEventos(null);
    cargar()
      .then((lista) => setEventos(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setError(
          errorDeEscritorio(err, "No se pudo cargar el historial.").mensaje,
        ),
      );
  }

  function alternar() {
    const abrir = !abierto;
    setAbierto(abrir);
    if (abrir && eventos === null) pedir();
  }

  return (
    <div>
      <button
        type="button"
        className="btn btn-link btn-sm px-0"
        aria-expanded={abierto}
        aria-controls={idPanel}
        onClick={alternar}
      >
        <Icon name={abierto ? "chevron-up" : "chevron-down"} />{" "}
        {abierto ? "Ocultar historial" : "Ver historial"}
      </button>
      <div id={idPanel} hidden={!abierto}>
        {abierto &&
          (error ? (
            <div className="mz-alert mz-alert--bad" role="alert">
              <Icon name="x-octagon" />
              <span className="flex-grow-1">{error}</span>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={pedir}
              >
                Reintentar
              </button>
            </div>
          ) : eventos === null ? (
            <p className="mz-small mz-faint mb-0" role="status">
              Cargando…
            </p>
          ) : eventos.length === 0 ? (
            <p className="mz-small mz-faint mb-0">Sin movimientos.</p>
          ) : (
            <ol className="ed-historial">
              {eventos.map((e) => (
                <li key={e.id}>
                  <span className="mz-strong">
                    {e.action_label || e.action}
                  </span>
                  <span className="mz-small mz-faint">
                    {" "}
                    · {fechaHora(e.created_at)}
                    {e.user ? ` · ${nombreDe(e.user)}` : " · El sistema"}
                  </span>
                </li>
              ))}
            </ol>
          ))}
      </div>
    </div>
  );
}
