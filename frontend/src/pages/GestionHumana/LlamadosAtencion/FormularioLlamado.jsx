/*
 * Emitir (Gestión Humana, `llamados.emitir`) o solicitar (el jefe, solo con
 * `llamados.solicitar`) un llamado de atención. El sistema propone el nivel
 * según el historial de la persona en la causa dentro del plazo de
 * reincidencia, contado hasta la fecha del hecho; quien emite puede cambiarlo
 * con una justificación y revisa todo en un último paso antes de emitir.
 * Quien solicita no elige nivel ni monto: lo decide Gestión Humana al
 * confirmar, y el historial tampoco se le muestra.
 */
import { useEffect, useRef, useState } from "react";

import { llamadosService } from "../../../api/llamadosService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { Icon } from "../../../components/common/Icon/Icon";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { useAuth } from "../../../hooks/useAuth";
import {
  erroresPorCampo,
  hayErroresGenerales,
  mensajeDeError,
} from "../../../utils/errores";
import { ErrorEnLinea, hoyLocal } from "../comunes";
import { SelectorDePersonas, coincide } from "../SelectorDePersonas";
import { CamposDeNivel } from "./CamposDeNivel";
import { HistorialDeLaPersona } from "./HistorialDeLaPersona";
import {
  SANCION,
  TIPOS,
  comoPersona,
  jefeDe,
  montoANumero,
  nivelPropuesto,
  nivelesDe,
  nombreDe,
} from "./llamadosComunes";
import { RevisionDeEmision } from "./RevisionDeEmision";

const TIPOS_DE_ADJUNTO = ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx";

export function FormularioLlamado({
  modo,
  causas,
  onCerrar,
  onGuardado,
  adjuntoMaximoMb = 10,
}) {
  const emitir = modo === "emitir";
  const { user } = useAuth();
  const [paso, setPaso] = useState("formulario");
  const [persona, setPersona] = useState([]);
  const [causaId, setCausaId] = useState("");
  const [propuesta, setPropuesta] = useState(null);
  const [calculando, setCalculando] = useState(false);
  const [errorPropuesta, setErrorPropuesta] = useState(null);
  const [avisoRecalculo, setAvisoRecalculo] = useState(null);
  const [vezPropuesta, setVezPropuesta] = useState(0);
  const [nivelId, setNivelId] = useState("");
  const [justificacion, setJustificacion] = useState("");
  // Vacía y obligatoria: un valor por omisión (hoy) se aceptaría sin mirarlo.
  const [fechaHecho, setFechaHecho] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [monto, setMonto] = useState("");
  const [adjunto, setAdjunto] = useState(null);
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const contenedor = useRef(null);
  // Si la persona ya eligió un nivel, una propuesta recalculada no lo pisa.
  const nivelTocado = useRef(false);
  const claveAnterior = useRef("");
  const propuestoAnterior = useRef(null);

  const causa = causas.find((c) => String(c.id) === String(causaId));
  const niveles = nivelesDe(causa);
  const propuestoId = nivelPropuesto(propuesta);
  const personaId = persona[0]?.id;
  const fechaValida = Boolean(fechaHecho) && fechaHecho <= hoyLocal();

  // El nivel propuesto, su historial y el monto sugerido, al elegir persona,
  // causa o fecha. Una respuesta vieja no pisa a la nueva.
  useEffect(() => {
    const clave = `${personaId}|${causaId}`;
    if (claveAnterior.current !== clave) {
      claveAnterior.current = clave;
      nivelTocado.current = false;
      propuestoAnterior.current = null;
      setNivelId("");
      setJustificacion("");
      setMonto("");
    }
    setPropuesta(null);
    setErrorPropuesta(null);
    setAvisoRecalculo(null);
    if (!personaId || !causaId || !fechaValida) {
      setCalculando(false);
      return undefined;
    }
    let vigente = true;
    setCalculando(true);
    llamadosService
      .propuesta(personaId, causaId, { fechaHecho, modo })
      .then((datos) => {
        if (!vigente) return;
        setPropuesta(datos);
        setCalculando(false);
        const id = nivelPropuesto(datos);
        if (id === null) return;
        if (!nivelTocado.current) {
          setNivelId(String(id));
          const sugerido =
            datos.monto_sugerido ??
            niveles.find((n) => String(n.id) === String(id))?.monto_sugerido;
          if (sugerido !== null && sugerido !== undefined) {
            setMonto(String(sugerido));
          }
        } else if (
          propuestoAnterior.current !== null &&
          String(propuestoAnterior.current) !== String(id)
        ) {
          const nuevo = niveles.find((n) => String(n.id) === String(id));
          setAvisoRecalculo(
            `La propuesta cambió a «${nombreDe(nuevo ?? datos.nivel_propuesto)}». Se mantuvo el nivel que usted eligió.`,
          );
        }
        propuestoAnterior.current = id;
      })
      .catch((err) => {
        if (!vigente) return;
        setCalculando(false);
        setErrorPropuesta(
          mensajeDeError(err, "No se pudo calcular el nivel propuesto."),
        );
      });
    return () => {
      vigente = false;
    };
    // `niveles` sale de `causaId`; no debe volver a pedir la propuesta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personaId, causaId, fechaHecho, modo, vezPropuesta]);

  // Un error de campo llegado durante la revisión: al volver al formulario,
  // el foco va al primer campo con error.
  useEffect(() => {
    if (paso === "formulario" && Object.keys(errores).length) {
      enfocarPrimerError(contenedor.current);
    }
    // Solo al volver de un paso a otro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paso]);

  // Al cambiar de nivel, el monto parte del sugerido de ese nivel.
  function elegirNivel(id) {
    nivelTocado.current = true;
    setNivelId(id);
    const nivel = niveles.find((n) => String(n.id) === String(id));
    if (nivel?.tipo === SANCION && nivel.monto_sugerido != null) {
      setMonto(String(nivel.monto_sugerido));
    }
  }

  function buscarPersonas(texto) {
    return llamadosService
      .personas(texto, modo)
      .then((lista) =>
        lista.map(comoPersona).filter((p) => coincide(p, texto)),
      );
  }

  function validar() {
    const faltan = {};
    if (!personaId) faltan.persona = "Elija a la persona.";
    if (!fechaHecho) faltan.fecha_hecho = "Indique la fecha del hecho.";
    else if (fechaHecho > hoyLocal()) {
      faltan.fecha_hecho = "La fecha del hecho no puede ser futura.";
    }
    if (!causaId) faltan.causa = "Elija la causa.";
    if (!descripcion.trim()) faltan.descripcion = "Describa el hecho.";
    if (emitir) {
      const nivel = niveles.find((n) => String(n.id) === String(nivelId));
      if (!nivel) faltan.nivel = "Elija el nivel.";
      if (
        nivel &&
        propuestoId !== null &&
        String(nivel.id) !== String(propuestoId) &&
        !justificacion.trim()
      ) {
        faltan.justificacion_cambio =
          "Justifique por qué cambia el nivel propuesto.";
      }
      if (nivel?.tipo === SANCION && montoANumero(monto) === null) {
        faltan.monto = "Indique un monto válido, por ejemplo 10,50.";
      }
    }
    if (adjunto && adjunto.size > adjuntoMaximoMb * 1024 * 1024) {
      faltan.adjunto = `El adjunto no puede pasar de ${adjuntoMaximoMb} MB.`;
    }
    return faltan;
  }

  async function enviar() {
    setError(null);
    const nivel = niveles.find((n) => String(n.id) === String(nivelId));
    const cambia =
      emitir && propuestoId !== null && String(nivelId) !== String(propuestoId);
    const campos = {
      persona: personaId,
      causa: causaId,
      fecha_hecho: fechaHecho,
      descripcion: descripcion.trim(),
      ...(emitir ? { nivel: nivelId } : {}),
      ...(cambia ? { justificacion_cambio: justificacion.trim() } : {}),
      ...(emitir && nivel?.tipo === SANCION
        ? { monto: montoANumero(monto) }
        : {}),
    };
    setGuardando(true);
    try {
      const creado = await llamadosService.crear(campos, adjunto);
      onGuardado(creado, emitir);
    } catch (err) {
      const campos = erroresPorCampo(err);
      setErrores(campos);
      setError(
        hayErroresGenerales(err) || !Object.keys(campos).length
          ? mensajeDeError(err, "No se pudo registrar el llamado.")
          : "Revise los campos marcados.",
      );
      // Un error de un campo se corrige en el formulario.
      if (Object.keys(campos).length) setPaso("formulario");
      enfocarPrimerError(contenedor.current);
      setGuardando(false);
    }
  }

  function continuar(evento) {
    evento.preventDefault();
    setError(null);
    const faltan = validar();
    setErrores(faltan);
    if (Object.keys(faltan).length) {
      enfocarPrimerError(contenedor.current);
      return;
    }
    if (emitir) setPaso("revision");
    else enviar();
  }

  const nivelElegido = niveles.find((n) => String(n.id) === String(nivelId));
  const propuestoNivel = niveles.find(
    (n) => String(n.id) === String(propuestoId),
  );
  // Con lo escrito, cerrar pregunta «¿Descartar?» también al volver de la
  // revisión (los campos ya no están en pantalla).
  const sucio = Boolean(
    personaId || causaId || fechaHecho || descripcion.trim() || adjunto,
  );
  const listo =
    !calculando &&
    !errorPropuesta &&
    (!(personaId && causaId && fechaValida) || propuesta !== null);

  if (paso === "revision" && nivelElegido) {
    return (
      <RevisionDeEmision
        titulo="Revise antes de emitir"
        persona={persona[0]}
        causa={nombreDe(causa)}
        nivel={nivelElegido}
        monto={monto}
        fechaHecho={fechaHecho}
        descripcion={descripcion}
        jefe={jefeDe(propuesta)}
        personaTieneCorreo={propuesta?.persona_tiene_correo}
        emitidoPor={user?.full_name ?? user?.name}
        guardando={guardando}
        error={error}
        onVolver={() => {
          setError(null);
          setPaso("formulario");
        }}
        onEmitir={(e) => {
          e.preventDefault();
          enviar();
        }}
      />
    );
  }

  return (
    <ModalDialog
      titulo={
        emitir ? "Emitir llamado de atención" : "Solicitar llamado de atención"
      }
      subtitulo={
        emitir
          ? "Antes de emitir verá un resumen del llamado y del correo."
          : "Gestión Humana lo revisa y lo confirma. No se avisa a la persona hasta entonces."
      }
      onCerrar={onCerrar}
      onSubmit={continuar}
      textoConfirmar={emitir ? "Revisar y emitir" : "Solicitar"}
      textoGuardando="Enviando…"
      isSaving={guardando}
      sucio={sucio}
      puedeConfirmar={listo}
      noValidate
      anchoMaximo="42rem"
    >
      <div className="mz-stack" ref={contenedor}>
        <LeyendaObligatorios />
        {error && <ErrorEnLinea mensaje={error} />}
        <SelectorDePersonas
          id="llamado-persona"
          leyenda="Persona"
          etiquetaBuscador="Buscar persona"
          obligatorio
          multiple={false}
          elegidos={persona}
          onCambio={setPersona}
          buscar={buscarPersonas}
          error={errores.persona}
          autofoco
          deshabilitado={guardando}
          textoNadie={
            emitir
              ? "No hay personas para elegir."
              : "No tiene personas a su cargo en el organigrama."
          }
        />
        <Campo
          id="llamado-fecha"
          etiqueta="Fecha del hecho"
          obligatorio
          error={errores.fecha_hecho}
          ayuda="El nivel propuesto se calcula con los llamados anteriores hasta esta fecha."
        >
          <input
            type="date"
            className="form-control"
            value={fechaHecho}
            max={hoyLocal()}
            disabled={guardando}
            onChange={(e) => setFechaHecho(e.target.value)}
          />
        </Campo>
        <Campo
          id="llamado-causa"
          etiqueta="Causa"
          obligatorio
          error={errores.causa}
        >
          <select
            className="form-select"
            value={causaId}
            disabled={guardando}
            onChange={(e) => setCausaId(e.target.value)}
          >
            <option value="">Elija una causa</option>
            {causas
              .filter((c) => c.activa !== false)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
          </select>
        </Campo>

        {calculando && (
          <p className="mz-small mz-faint mb-0" role="status">
            <span
              className="spinner-border spinner-border-sm me-2"
              aria-hidden="true"
            />
            Calculando el nivel propuesto…
          </p>
        )}
        {errorPropuesta && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <span className="flex-grow-1">
              {errorPropuesta} No se puede continuar hasta calcularlo.
            </span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm mz-tactil"
              onClick={() => setVezPropuesta((v) => v + 1)}
            >
              Reintentar
            </button>
          </div>
        )}
        {avisoRecalculo && (
          <p className="mz-alert mz-alert--warn mb-0" role="status">
            {avisoRecalculo}
          </p>
        )}

        {personaId && causaId && propuesta && emitir && (
          <HistorialDeLaPersona
            historial={propuesta.historial ?? []}
            plazoMeses={
              causa?.plazo_reincidencia_meses ?? causa?.plazo_reincidencia
            }
            propuesto={
              propuestoNivel
                ? `${propuestoNivel.nombre} (${TIPOS[propuestoNivel.tipo] ?? propuestoNivel.tipo})`
                : null
            }
          />
        )}
        {personaId && causaId && propuesta && !emitir && (
          <p className="mz-small mb-0">
            Gestión Humana revisará el historial y decidirá el nivel.
            {propuestoNivel && (
              <>
                {" "}
                Nivel propuesto (orientativo):{" "}
                <strong>{propuestoNivel.nombre}</strong>.
              </>
            )}
          </p>
        )}

        {emitir && causaId && (
          <CamposDeNivel
            prefijo="llamado"
            niveles={niveles}
            propuestoId={propuestoId}
            nivelId={nivelId}
            onNivel={elegirNivel}
            justificacion={justificacion}
            onJustificacion={setJustificacion}
            monto={monto}
            onMonto={setMonto}
            errores={errores}
            deshabilitado={guardando || calculando}
          />
        )}

        <Campo
          id="llamado-descripcion"
          etiqueta="Descripción del hecho"
          obligatorio
          error={errores.descripcion}
        >
          <textarea
            className="form-control"
            rows={4}
            value={descripcion}
            disabled={guardando}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </Campo>
        {adjunto ? (
          <div className="mz-campo">
            <span className="form-label d-block" id="llamado-adjunto-etiqueta">
              Evidencia (opcional)
            </span>
            <div
              className="d-flex flex-wrap align-items-center gap-2"
              role="group"
              aria-labelledby="llamado-adjunto-etiqueta"
            >
              <span id="llamado-adjunto">
                <Icon name="paperclip" /> {adjunto.name}
              </span>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm mz-tactil"
                disabled={guardando}
                onClick={() => {
                  setAdjunto(null);
                  // El texto desaparece: el foco va al campo que lo reemplaza.
                  requestAnimationFrame(() =>
                    document.getElementById("llamado-adjunto")?.focus(),
                  );
                }}
              >
                Quitar
                <span className="visually-hidden">
                  {" "}
                  la evidencia {adjunto.name}
                </span>
              </button>
            </div>
            {errores.adjunto && (
              <div className="mz-field-error">{errores.adjunto}</div>
            )}
          </div>
        ) : (
          <Campo
            id="llamado-adjunto"
            etiqueta="Evidencia (opcional)"
            error={errores.adjunto}
            ayuda={`Un archivo de hasta ${adjuntoMaximoMb} MB: PDF, imagen, Word o Excel.`}
          >
            <input
              type="file"
              className="form-control"
              accept={TIPOS_DE_ADJUNTO}
              disabled={guardando}
              onChange={(e) => setAdjunto(e.target.files?.[0] ?? null)}
            />
          </Campo>
        )}
      </div>
    </ModalDialog>
  );
}
