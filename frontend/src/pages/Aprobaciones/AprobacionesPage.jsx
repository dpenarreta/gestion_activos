import { useCallback, useEffect, useRef, useState } from "react";

import { soporteService } from "../../api/soporteService";
import { Icon } from "../../components/common/Icon/Icon";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { formatearFecha } from "../../utils/formato";
import { mensajeDeError } from "../../utils/errores";
import "../Soporte/Soporte.css";

/**
 * Las solicitudes que esperan el visto bueno de quien entra (jefe de área,
 * Talento Humano…). El correo trae aquí: se aprueba con la cuenta, no desde
 * un enlace suelto. No hace falta ningún permiso de la mesa de ayuda; basta
 * con ser el aprobador. Quien coordina ve además las que no tienen aprobador.
 */
export function AprobacionesPage() {
  const [pendientes, setPendientes] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const avisoRef = useRef(null);

  const cargar = useCallback(() => {
    setError(null);
    soporteService
      .aprobaciones()
      .then(setPendientes)
      .catch((err) =>
        setError(
          mensajeDeError(err, "No se pudieron cargar las aprobaciones."),
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Tras decidir, la tarjeta desaparece y el foco caía en el <body>: se
  // lleva al aviso de éxito, que dice qué pasó (revisión final UX/UI,
  // 28/10/2026).
  useEffect(() => {
    if (aviso) avisoRef.current?.focus();
  }, [aviso]);

  /* Devuelve el mensaje de error, o null si salió bien: el error se muestra
     en la propia tarjeta, junto a los botones, y no arriba de la página lejos
     de lo que se intentó (auditoría UX/UI, fase 2, 28/10/2026). */
  async function decidir(aprobacion, aprobar, nota) {
    setAviso(null);
    try {
      await soporteService.decidirAprobacion(aprobacion.id, aprobar, nota);
      setAviso(
        aprobar
          ? `${aprobacion.ticket.numero} aprobado: entra a la cola de soporte.`
          : `${aprobacion.ticket.numero} no aprobado: se le avisó a quien lo pidió.`,
      );
      cargar();
      return null;
    } catch (err) {
      return mensajeDeError(err, "No se pudo registrar la decisión.");
    }
  }

  return (
    <div className="soporte-page mz-stack">
      <div className="mz-view-head">
        <div>
          <h2>Aprobaciones</h2>
          <p className="mz-desc">
            Solicitudes de soporte que necesitan su visto bueno. Mientras no las
            apruebe, no entran a la cola.
          </p>
        </div>
      </div>
      {aviso && (
        <div
          ref={avisoRef}
          tabIndex={-1}
          className="mz-alert mz-alert--ok"
          role="status"
        >
          <Icon name="check2-circle" />
          {aviso}
        </div>
      )}
      {/* Mientras `pendientes` es null la página quedaba en blanco: ahora
          dice que carga, y si falla ofrece reintentar (fase 2). */}
      <EstadoDeCarga
        cargando={pendientes === null}
        error={error}
        onReintentar={cargar}
      />
      {!error && pendientes?.length === 0 && (
        <div className="mz-empty">
          <Icon name="check2-all" /> No tiene aprobaciones pendientes.
        </div>
      )}
      {(pendientes ?? []).map((a) => (
        <TarjetaAprobacion key={a.id} aprobacion={a} onDecidir={decidir} />
      ))}
    </div>
  );
}

function TarjetaAprobacion({ aprobacion, onDecidir }) {
  const [nota, setNota] = useState("");
  // Qué decisión se está enviando («aprobar» / «rechazar»), para que el
  // botón pulsado diga «Enviando…» y los dos queden quietos mientras tanto.
  const [enviando, setEnviando] = useState(null);
  const [error, setError] = useState(null);
  const { ticket } = aprobacion;
  const idNota = `ap-nota-${aprobacion.id}`;
  const sinNota = nota.trim() === "";

  async function decidir(aprobar) {
    setError(null);
    setEnviando(aprobar ? "aprobar" : "rechazar");
    const fallo = await onDecidir(aprobacion, aprobar, nota);
    setEnviando(null);
    if (fallo) setError(fallo);
  }

  return (
    <section className="mz-card" aria-label={`Aprobación de ${ticket.numero}`}>
      <div className="mz-card-head">
        <h3>
          <span className="mz-mono">{ticket.numero}</span> ·{" "}
          {ticket.codigo && <span className="mz-mono">{ticket.codigo} </span>}
          {ticket.caso}
        </h3>
        <span className="mz-small mz-faint">
          {aprobacion.rol}
          {aprobacion.sin_aprobador && " · sin responsable con cuenta"} ·{" "}
          {formatearFecha(aprobacion.creada, true)}
        </span>
      </div>
      <div className="mz-card-body">
        <div className="mz-kv-grid mb-2">
          <div className="mz-kv">
            <span className="mz-kv-label">Pide</span>
            {ticket.solicitante} · {ticket.correo}
          </div>
          {ticket.area && (
            <div className="mz-kv">
              <span className="mz-kv-label">Área</span>
              {ticket.area}
            </div>
          )}
          {ticket.agencia && (
            <div className="mz-kv">
              <span className="mz-kv-label">Agencia</span>
              {ticket.agencia}
            </div>
          )}
          <div className="mz-kv">
            <span className="mz-kv-label">Prioridad</span>
            {ticket.prioridad_display}
          </div>
          {ticket.datos_adicionales.map((d) => (
            <div className="mz-kv" key={d.clave}>
              <span className="mz-kv-label">{d.etiqueta}</span>
              {d.valor}
            </div>
          ))}
        </div>
        <p className="soporte-publico__descripcion">{ticket.descripcion}</p>
        <label className="form-label" htmlFor={idNota}>
          Nota (obligatoria si no aprueba)
        </label>
        <textarea
          id={idNota}
          className="form-control form-control-sm"
          rows={2}
          maxLength={500}
          value={nota}
          aria-describedby={sinNota ? `${idNota}-ayuda` : undefined}
          onChange={(e) => setNota(e.target.value)}
        />
        {/* «No aprobar» sin nota lo rechazaba el servidor después del clic:
            ahora el botón espera a la nota y dice por qué (fase 2). */}
        {sinNota && (
          <div id={`${idNota}-ayuda`} className="form-text">
            Escriba una nota para poder no aprobarla.
          </div>
        )}
        {error && (
          <div className="mz-alert mz-alert--bad mt-2" role="alert">
            <Icon name="x-octagon" />
            {error}
          </div>
        )}
        <div className="mz-actions justify-content-end mt-2">
          <button
            type="button"
            className="btn btn-outline-danger btn-sm"
            disabled={enviando !== null || sinNota}
            aria-describedby={sinNota ? `${idNota}-ayuda` : undefined}
            onClick={() => decidir(false)}
          >
            {enviando === "rechazar" ? "Enviando…" : "No aprobar"}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={enviando !== null}
            onClick={() => decidir(true)}
          >
            {enviando === "aprobar" ? "Enviando…" : "Aprobar"}
          </button>
        </div>
      </div>
    </section>
  );
}
