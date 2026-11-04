/*
 * Ventanas del módulo: cierre de período, corrección autorizada, cambio de
 * estado, acciones del Administrador sobre un colaborador y eliminación de
 * un registro de horas extras. Todas las vuelve a autorizar el servidor:
 * mostrarlas solo a quien corresponde no es la barrera de seguridad.
 */
import { useEffect, useRef, useState } from "react";

import { errorDeNovedades, novedadesService } from "../../api/novedadesService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import { ESTADO_COLABORADOR, ErrorEnLinea, fecha } from "./comunes";

/** Un motivo obligatorio u opcional, con su error bajo el campo. */
function CampoMotivo({
  id,
  valor,
  onCambio,
  obligatorio = true,
  error,
  ayuda,
  etiqueta = "Motivo",
}) {
  return (
    <Campo
      id={id}
      etiqueta={etiqueta}
      obligatorio={obligatorio}
      error={error}
      ayuda={ayuda}
      className="mb-3"
    >
      <textarea
        className="form-control"
        rows={3}
        maxLength={500}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
      />
    </Campo>
  );
}

/**
 * Cerrar el período 23 → 22 de UN equipo. Muestra el resumen que calcula el
 * servidor y exige marcar que se revisó: al cerrar, los registros quedan
 * bloqueados y solo se corrigen por el procedimiento autorizado.
 */
export function CerrarPeriodo({
  periodo,
  supervisorId,
  hoy,
  finDelPeriodo,
  onCerrar,
  onCerrado,
}) {
  const [resumen, setResumen] = useState(null);
  const enCurso = useRef(false);
  const [error, setError] = useState(null);
  const [revisado, setRevisado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vigente = true;
    novedadesService
      .resumenDeCierre(periodo, supervisorId)
      .then((datos) => vigente && setResumen(datos))
      .catch(
        (err) =>
          vigente &&
          setError(
            errorDeNovedades(err, "No se pudo calcular el resumen.").mensaje,
          ),
      );
    return () => {
      vigente = false;
    };
  }, [periodo, supervisorId]);

  async function cerrar(evento) {
    evento.preventDefault();
    if (!revisado || enCurso.current) return;
    // Un doble clic llega antes de que se pinte el botón deshabilitado.
    enCurso.current = true;
    setGuardando(true);
    setError(null);
    try {
      const resultado = await novedadesService.cerrarPeriodo(
        periodo,
        supervisorId,
      );
      onCerrado(
        resultado.already_closed
          ? "El período ya estaba cerrado."
          : `Período ${resumen?.period_label ?? periodo} cerrado para ${resumen?.supervisor_name ?? "el equipo"}. Se habilitó el siguiente período (${resultado.next_period}).`,
      );
    } catch (err) {
      setError(errorDeNovedades(err, "No se pudo cerrar el período.").mensaje);
      setGuardando(false);
      enCurso.current = false;
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo="Cerrar período"
      subtitulo="Solo afecta a este equipo: los demás supervisores siguen trabajando."
      onCerrar={onCerrar}
      onSubmit={cerrar}
      textoConfirmar="Cerrar período"
      variante="danger"
      isSaving={guardando}
      puedeConfirmar={Boolean(resumen) && revisado}
    >
      {!resumen && !error && <EstadoDeCarga cargando />}
      {resumen && (
        <>
          <p>
            Cierre de <strong>{resumen.period_label}</strong> para{" "}
            <strong>{resumen.supervisor_name}</strong>.
          </p>
          <dl className="gh-tarjeta-kv gh-tarjeta-kv--estrecha gh-recuadro mb-3">
            <dt>Colaboradores activos</dt>
            <dd>{resumen.active_collaborators}</dd>
            <dt>Celdas con horas</dt>
            <dd>{resumen.worked_day_cells}</dd>
            <dt>Celdas reportadas en 0</dt>
            <dd>{resumen.zero_cells}</dd>
            <dt>Celdas pendientes (vacías, días hábiles)</dt>
            <dd>{resumen.pending_cells}</dd>
            <dt>Horas laboradas</dt>
            <dd>{resumen.worked_hours}</dd>
          </dl>
          {hoy && finDelPeriodo && hoy < finDelPeriodo && (
            <div className="mz-alert mz-alert--warn mb-3" role="status">
              <span>
                El período termina el {fecha(finDelPeriodo)}: si lo cierra
                ahora, no se podrán registrar los días restantes.
              </span>
            </div>
          )}
          {resumen.pending_cells > 0 && (
            <div className="mz-alert mz-alert--warn mb-3" role="status">
              <span>
                Hay {resumen.pending_cells} celda(s) vacía(s) en días hábiles.
                Vacío significa «no reportado», distinto de 0.
              </span>
            </div>
          )}
          <p className="mz-small mz-faint">
            Horas extras va por mes calendario y se cierra aparte, con «Cerrar
            mes» en Horas extras.
          </p>
          <div className="form-check">
            <input
              id="gh-cierre-revisado"
              className="form-check-input"
              type="checkbox"
              checked={revisado}
              onChange={(e) => setRevisado(e.target.checked)}
            />
            <label className="form-check-label" htmlFor="gh-cierre-revisado">
              Revisé la información. Entiendo que, al cerrar, los registros de
              este período quedan bloqueados y solo podrán corregirse mediante
              el procedimiento autorizado.
            </label>
          </div>
        </>
      )}
      <ErrorEnLinea mensaje={error} className="mt-3" />
    </ModalDialog>
  );
}

/**
 * Corrección excepcional sobre un período o mes ya cerrado (solo el
 * Administrador): siempre con motivo; el valor original queda en el
 * historial.
 */
export function Correccion({
  tipo,
  titulo,
  valorActual,
  cuerpo,
  permitirAnular = false,
  onCerrar,
  onHecho,
}) {
  const [valor, setValor] = useState(valorActual ?? "");
  const [anular, setAnular] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const panel = useRef(null);
  const enCurso = useRef(false);

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    if (!motivo.trim()) {
      setErrores({ motivo: "Escriba el motivo de la corrección." });
      enfocarPrimerError(panel.current);
      return;
    }
    enCurso.current = true;
    setGuardando(true);
    setError(null);
    try {
      if (tipo === "dia") {
        await novedadesService.corregirDia({
          ...cuerpo,
          hours: valor.trim() === "" ? null : valor.replace(",", "."),
          reason: motivo.trim(),
        });
      } else {
        await novedadesService.corregirHorasExtras({
          ...cuerpo,
          overtime_hours: valor.replace(",", "."),
          delete: anular,
          reason: motivo.trim(),
        });
      }
      onHecho(
        "Corrección registrada. El valor original queda en el historial.",
      );
    } catch (err) {
      setError(
        errorDeNovedades(err, "No se pudo registrar la corrección.").mensaje,
      );
      setGuardando(false);
      enCurso.current = false;
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo={
        tipo === "dia"
          ? "Corrección de período cerrado"
          : "Corrección de mes cerrado"
      }
      subtitulo={titulo}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar="Registrar corrección"
      isSaving={guardando}
    >
      <div ref={panel}>
        <LeyendaObligatorios />
        <p className="mz-small mt-2">
          Valor original: <strong>{valorActual || "vacío"}</strong> — se
          conserva en el historial.
        </p>
        {!anular && (
          <Campo
            id="gh-correccion-valor"
            etiqueta={tipo === "dia" ? "Nuevo valor en horas" : "Horas extras"}
            ayuda={
              tipo === "dia"
                ? "Vacío = sin reporte; 0 = cero horas."
                : undefined
            }
            className="mb-3"
          >
            <input
              className="form-control"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </Campo>
        )}
        {permitirAnular && (
          <div className="form-check mb-3">
            <input
              id="gh-correccion-anular"
              className="form-check-input"
              type="checkbox"
              checked={anular}
              onChange={(e) => setAnular(e.target.checked)}
            />
            <label className="form-check-label" htmlFor="gh-correccion-anular">
              Anular el registro
            </label>
          </div>
        )}
        <CampoMotivo
          id="gh-correccion-motivo"
          etiqueta="Motivo de la corrección"
          valor={motivo}
          onCambio={(v) => {
            setMotivo(v);
            if (v.trim()) setErrores({});
          }}
          error={errores.motivo}
        />
        <ErrorEnLinea mensaje={error} />
      </div>
    </ModalDialog>
  );
}

const CORREO_SALIDA = {
  PENDING: "La notificación por correo está pendiente de envío.",
  SENDING: "La notificación por correo está pendiente de envío.",
  SENT: "La notificación por correo fue enviada.",
  FAILED:
    "La notificación por correo falló: el Administrador puede reintentarla desde la Configuración del módulo.",
};

/** Cambiar el estado operativo de un colaborador (Activo, Suspendido, Inactivo). */
export function CambiarEstado({ colaborador, onCerrar, onHecho }) {
  const opciones = Object.keys(ESTADO_COLABORADOR).filter(
    (e) => e !== colaborador.status,
  );
  // Sin estado preelegido: se confirma solo lo que se eligió.
  const [estado, setEstado] = useState("");
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const panel = useRef(null);
  const pideMotivo = Boolean(estado) && estado !== "ACTIVE";
  const correo =
    colaborador.status === "ACTIVE" && estado === "INACTIVE"
      ? "de salida"
      : colaborador.status === "ACTIVE" && estado === "SUSPENDED"
        ? "de suspensión"
        : null;

  async function enviar(evento) {
    evento.preventDefault();
    if (!estado) {
      setErrores({ estado: "Elija el nuevo estado." });
      enfocarPrimerError(panel.current);
      return;
    }
    if (pideMotivo && !motivo.trim()) {
      setErrores({ motivo: "Escriba el motivo del cambio de estado." });
      enfocarPrimerError(panel.current);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const resultado = await novedadesService.cambiarEstado(
        colaborador.id,
        estado,
        motivo.trim(),
      );
      // El cambio ya está confirmado; el correo tiene su propio estado y su
      // falla no es una falla del cambio.
      const envio = resultado?.exit_notification;
      onHecho(
        `Cambio de estado confirmado: ${colaborador.full_name} — ${ESTADO_COLABORADOR[estado]}.${envio ? ` ${CORREO_SALIDA[envio.status] ?? ""}` : ""}`,
        envio?.status === "FAILED" ? "warn" : "ok",
      );
    } catch (err) {
      setError(errorDeNovedades(err, "No se pudo cambiar el estado.").mensaje);
      setGuardando(false);
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo="Cambiar estado operativo"
      subtitulo={`${colaborador.full_name} · estado actual: ${ESTADO_COLABORADOR[colaborador.status] ?? colaborador.status}`}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar="Confirmar cambio"
      variante={pideMotivo ? "danger" : "primary"}
      isSaving={guardando}
      puedeConfirmar={Boolean(estado)}
    >
      <div ref={panel}>
        <LeyendaObligatorios />
        <Campo
          id="gh-estado-nuevo"
          etiqueta="Nuevo estado"
          obligatorio
          error={errores.estado}
          className="mt-2 mb-3"
        >
          <select
            className="form-select"
            value={estado}
            onChange={(e) => {
              setEstado(e.target.value);
              setErrores({});
            }}
          >
            <option value="">Seleccione…</option>
            {opciones.map((e) => (
              <option key={e} value={e}>
                {ESTADO_COLABORADOR[e]}
              </option>
            ))}
          </select>
        </Campo>
        <CampoMotivo
          id="gh-estado-motivo"
          valor={motivo}
          obligatorio={pideMotivo}
          onCambio={(v) => {
            setMotivo(v);
            if (v.trim()) setErrores({});
          }}
          error={errores.motivo}
        />
        {pideMotivo && (
          <p className="mz-small mz-faint">
            El historial y las horas ya registradas se conservan. Se notificará
            al Administrador de inmediato.
          </p>
        )}
        {correo && (
          <div className="mz-alert mz-alert--warn mb-3" role="status">
            <span>
              Al confirmar se enviará por correo la notificación {correo} con el
              detalle de Días laborados del período.
            </span>
          </div>
        )}
        <ErrorEnLinea mensaje={error} />
      </div>
    </ModalDialog>
  );
}

/**
 * Retirar de Días laborados (eliminación lógica) o restaurar: solo el
 * Administrador, con motivo. No borra nada ni cambia el estado.
 */
export function RetirarDeDias({
  colaborador,
  restaurar = false,
  onCerrar,
  onHecho,
}) {
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const panel = useRef(null);

  async function enviar(evento) {
    evento.preventDefault();
    if (!motivo.trim()) {
      setErrores({ motivo: "Escriba el motivo." });
      enfocarPrimerError(panel.current);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      if (restaurar)
        await novedadesService.restaurarEnDias(colaborador.id, motivo.trim());
      else await novedadesService.retirarDeDias(colaborador.id, motivo.trim());
      onHecho(
        restaurar
          ? `${colaborador.full_name} vuelve a aparecer en Días laborados.`
          : `${colaborador.full_name} fue retirado de Días laborados.`,
      );
    } catch (err) {
      setError(errorDeNovedades(err).mensaje);
      setGuardando(false);
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo={
        restaurar ? "Restaurar en Días laborados" : "Retirar de Días laborados"
      }
      subtitulo={`${colaborador.full_name} · cédula ${colaborador.cedula}`}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar={restaurar ? "Restaurar" : "Retirar"}
      variante={restaurar ? "primary" : "danger"}
      isSaving={guardando}
    >
      <div ref={panel}>
        <p>
          {restaurar
            ? "Volverá a aparecer en Días laborados desde el período en curso."
            : "Dejará de aparecer en Días laborados desde el período en curso y no contará en cierres ni exportaciones. No se borra nada: se conservan sus días, horas extras, historial y auditoría, y se puede restaurar. No cambia su estado ni envía el correo de salida."}
        </p>
        <CampoMotivo
          id="gh-retiro-motivo"
          valor={motivo}
          onCambio={(v) => {
            setMotivo(v);
            if (v.trim()) setErrores({});
          }}
          error={errores.motivo}
        />
        <ErrorEnLinea mensaje={error} />
      </div>
    </ModalDialog>
  );
}

/** Corrección administrativa de la cédula (solo el Administrador). */
export function CorregirCedula({ colaborador, onCerrar, onHecho }) {
  // En listas y grillas la cédula llega enmascarada: la completa se pide al
  // detalle, que el servidor solo entrega a quien puede verla.
  const [actual, setActual] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [cedula, setCedula] = useState("");
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const panel = useRef(null);
  const enCurso = useRef(false);

  useEffect(() => {
    let vigente = true;
    novedadesService
      .colaborador(colaborador.id)
      .then((d) => {
        if (!vigente) return;
        setActual(d.cedula);
        setCedula(d.cedula);
      })
      .catch(
        (err) =>
          vigente &&
          setErrorCarga(
            errorDeNovedades(err, "No se pudo leer la cédula actual.").mensaje,
          ),
      );
    return () => {
      vigente = false;
    };
  }, [colaborador.id]);

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current || actual === null) return;
    const faltan = {};
    if (!cedula.trim()) faltan.cedula = "Escriba la cédula correcta.";
    else if (cedula.trim() === actual)
      faltan.cedula = "La cédula es la misma que la actual.";
    if (!motivo.trim()) faltan.motivo = "Escriba el motivo.";
    setErrores(faltan);
    if (Object.keys(faltan).length) {
      enfocarPrimerError(panel.current);
      return;
    }
    enCurso.current = true;
    setGuardando(true);
    setError(null);
    try {
      const actualizado = await novedadesService.corregirCedula(
        colaborador.id,
        cedula.trim(),
        motivo.trim(),
      );
      onHecho(
        `Cédula de ${colaborador.full_name} corregida: ${actualizado.cedula}.`,
      );
    } catch (err) {
      setError(errorDeNovedades(err, "No se pudo corregir la cédula.").mensaje);
      setGuardando(false);
      enCurso.current = false;
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo="Corregir cédula"
      subtitulo={colaborador.full_name}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar="Guardar cédula"
      isSaving={guardando}
      puedeConfirmar={actual !== null}
    >
      <EstadoDeCarga
        cargando={actual === null && !errorCarga}
        error={errorCarga}
      />
      <div ref={panel}>
        <LeyendaObligatorios />
        <Campo
          id="gh-cedula-nueva"
          etiqueta="Cédula correcta"
          obligatorio
          error={errores.cedula}
          className="mt-2 mb-3"
        >
          <input
            className="form-control"
            maxLength={40}
            value={cedula}
            onChange={(e) => setCedula(e.target.value)}
          />
        </Campo>
        <CampoMotivo
          id="gh-cedula-motivo"
          valor={motivo}
          onCambio={setMotivo}
          error={errores.motivo}
          ayuda="Solo cambia la cédula; sus días, horas extras e historial siguen asociados al mismo colaborador."
        />
        <ErrorEnLinea mensaje={error} />
      </div>
    </ModalDialog>
  );
}

/**
 * Eliminar un registro de horas extras YA GUARDADO (borrado lógico): el
 * colaborador sigue en la base y el Administrador recibe una alerta.
 * `onHecho(yaNoExistia)` avisa si otra persona lo había eliminado antes.
 */
export function EliminarHorasExtras({ registro, onCerrar, onHecho }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);

  async function enviar(evento) {
    evento.preventDefault();
    // Un doble clic llega antes de que se pinte el botón deshabilitado.
    if (enCurso.current) return;
    enCurso.current = true;
    setGuardando(true);
    setError(null);
    try {
      await novedadesService.eliminarHorasExtras(registro.id, motivo.trim());
      onHecho(false);
    } catch (err) {
      const fallo = errorDeNovedades(err, "No se pudo eliminar el registro.");
      if (fallo.estado === 404) {
        onHecho(true);
        return;
      }
      setError(fallo.mensaje);
      setGuardando(false);
      enCurso.current = false;
    }
  }

  const horas = [
    registro.overtime_hours && registro.overtime_hours !== "0"
      ? `${registro.overtime_hours} h extra`
      : "",
    registro.saturday_hours && registro.saturday_hours !== "0"
      ? `${registro.saturday_hours} h sábado`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo="Eliminar registro de horas extras"
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar="Eliminar registro"
      variante="danger"
      isSaving={guardando}
    >
      <dl className="gh-tarjeta-kv gh-recuadro mb-3">
        <dt>Colaborador</dt>
        <dd>{registro.full_name}</dd>
        <dt>Cédula</dt>
        <dd className="gh-mono">{registro.cedula}</dd>
        <dt>Fecha</dt>
        <dd>{fecha(registro.date)}</dd>
        {horas && (
          <>
            <dt>Horas</dt>
            <dd>{horas}</dd>
          </>
        )}
      </dl>
      <p>
        Solo se elimina este registro: el colaborador{" "}
        <strong>sigue en la base</strong>. Queda en el historial y se alerta al
        Administrador.
      </p>
      <CampoMotivo
        id="gh-eliminar-motivo"
        valor={motivo}
        onCambio={setMotivo}
        obligatorio={false}
      />
      <ErrorEnLinea mensaje={error} />
    </ModalDialog>
  );
}
