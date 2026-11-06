/*
 * «Nueva nota» (`NewNoteModal` de Nexo): destinatario, mensaje (hasta 500
 * caracteres, con su contador), prioridad, color y un adjunto opcional. El
 * adjunto se revisa aquí con las reglas que da el servidor en `me/`
 * (formatos y tamaño) para avisar antes de subir; el servidor lo vuelve a
 * validar, también por la firma del contenido, y su motivo
 * (`details.attachment`) se muestra bajo el campo.
 */
import { useCallback, useId, useRef, useState } from "react";

import {
  errorDeEscritorio,
  escritorioService,
} from "../../../api/escritorioService";
import {
  Campo,
  LeyendaObligatorios,
} from "../../../components/common/Campo/Campo";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  listaDeFormatos,
  problemaDelAdjunto,
  tamano,
} from "../MejoraContinua/mejoraComunes";
import { SelectorDePersonas, coincide } from "../SelectorDePersonas";
import { Ventana } from "../Tareas/Ventanas";
import { useEscritorio } from "./ContextoEscritorio";
import { MENSAJE_MAX, claseDeColor } from "./escritorioComunes";

const ORDEN = ["recipient", "message", "priority", "color", "attachment"];

export function FormularioNota({ onCerrar, onCreada }) {
  const { reglasAdjunto, prioridadesNota, colores } = useEscritorio();
  const base = useId();
  const ids = {
    recipient: `${base}-destinatario`,
    message: `${base}-mensaje`,
    priority: `${base}-prioridad`,
    color: `${base}-color`,
    attachment: `${base}-adjunto`,
    formulario: `${base}-formulario`,
  };
  const [valores, setValores] = useState({
    message: "",
    priority: "INFORMACION",
    color: "AMARILLO",
  });
  // El destinatario elegido (como lista de una persona, la forma del
  // selector común).
  const [para, setPara] = useState([]);
  // `notes/recipients/` no filtra: se pide una vez y se busca aquí. Si
  // falla, se olvida para que «Reintentar» vuelva a pedirla.
  const lista = useRef(null);
  const buscarDestinatarios = useCallback((texto) => {
    lista.current ??= escritorioService.destinatarios().catch((err) => {
      lista.current = null;
      throw err;
    });
    return lista.current.then((personas) =>
      (personas ?? []).filter((p) => coincide(p, texto)),
    );
  }, []);
  const [archivo, setArchivo] = useState(null);
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);
  const selector = useRef(null);

  function limpiarError(campo) {
    setErrores((e) => {
      const resto = { ...e };
      delete resto[campo];
      return resto;
    });
  }

  function cambiar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    limpiarError(campo);
  }

  function elegirArchivo(evento) {
    const elegido = evento.target.files?.[0] ?? null;
    const problema = problemaDelAdjunto(elegido, reglasAdjunto);
    if (problema) {
      // No se guarda: el campo queda vacío y dice por qué.
      setArchivo(null);
      evento.target.value = "";
      setErrores((e) => ({ ...e, attachment: problema }));
      return;
    }
    setArchivo(elegido);
    limpiarError("attachment");
  }

  function quitarArchivo() {
    setArchivo(null);
    if (selector.current) {
      selector.current.value = "";
      selector.current.focus();
    }
  }

  function validar() {
    const e = {};
    if (para.length === 0) e.recipient = "Elija a quién le deja la nota.";
    if (!valores.message.trim()) e.message = "Escriba el mensaje de la nota.";
    else if (valores.message.length > MENSAJE_MAX)
      e.message = `El mensaje no puede pasar de ${MENSAJE_MAX} caracteres.`;
    const problema = problemaDelAdjunto(archivo, reglasAdjunto);
    if (problema) e.attachment = problema;
    return e;
  }

  function enfocar(campos) {
    const primero = ORDEN.find((c) => campos[c]);
    if (primero) document.getElementById(ids[primero])?.focus();
  }

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const locales = validar();
    if (Object.keys(locales).length) {
      setErrores(locales);
      setErrorGeneral(null);
      enfocar(locales);
      return;
    }
    enCurso.current = true;
    setEnviando(true);
    setErrorGeneral(null);
    try {
      const nota = await escritorioService.crearNota({
        recipient: para[0].id,
        message: valores.message.trim(),
        priority: valores.priority,
        color: valores.color,
        archivo,
      });
      onCreada(nota);
    } catch (err) {
      const e = errorDeEscritorio(err, "No se pudo dejar la nota.");
      if (Object.keys(e.campos).length) {
        setErrores(e.campos);
        enfocar(e.campos);
      }
      setErrorGeneral(e.mensaje);
    } finally {
      enCurso.current = false;
      setEnviando(false);
    }
  }

  const aceptados = (reglasAdjunto.extensions ?? []).join(",");

  return (
    <Ventana
      titulo="Dejar una nota"
      subtitulo="Le llega a la persona en su Escritorio, como un post-it."
      onCerrar={onCerrar}
      bloqueada={enviando}
      pie={
        <>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={onCerrar}
            disabled={enviando}
          >
            Cancelar
          </button>
          <button
            type="submit"
            form={ids.formulario}
            className="btn btn-primary"
            disabled={enviando}
          >
            {enviando ? (
              <>
                <span
                  className="spinner-border spinner-border-sm"
                  aria-hidden="true"
                />{" "}
                Enviando…
              </>
            ) : (
              <>
                <Icon name="send" /> Dejar nota
              </>
            )}
          </button>
        </>
      }
    >
      <form
        id={ids.formulario}
        className="ed-formulario"
        onSubmit={enviar}
        noValidate
        aria-busy={enviando}
      >
        <LeyendaObligatorios />
        {errorGeneral && (
          <div className="mz-alert mz-alert--bad" role="alert">
            <Icon name="x-octagon" />
            <span>{errorGeneral}</span>
          </div>
        )}
        {/* El buscador recibe el foco al abrir: nunca se deshabilita
            mientras carga (auditoría UX/UI, 06/11/2026). */}
        <SelectorDePersonas
          id={ids.recipient}
          leyenda="Para"
          etiquetaBuscador="Buscar a quién dejarle la nota"
          obligatorio
          multiple={false}
          autofoco
          elegidos={para}
          buscar={buscarDestinatarios}
          mensajeDeError="No se pudo cargar a quién dejar la nota."
          textoNadie="No hay personas con Escritorio a quienes dejar una nota."
          textoSinElegir="Elija una persona de la lista."
          error={errores.recipient}
          deshabilitado={enviando}
          onCambio={(elegida) => {
            setPara(elegida);
            setErrores((e) => {
              const resto = { ...e };
              delete resto.recipient;
              return resto;
            });
          }}
        />
        <Campo
          id={ids.message}
          etiqueta="Mensaje"
          obligatorio
          error={errores.message}
          ayuda={`${valores.message.length} de ${MENSAJE_MAX} caracteres.`}
        >
          <textarea
            className="form-control"
            rows={4}
            value={valores.message}
            maxLength={MENSAJE_MAX}
            placeholder="Escriba un mensaje corto"
            onChange={(e) => cambiar("message", e.target.value)}
          />
        </Campo>
        <fieldset
          className="ed-grupo"
          aria-describedby={
            errores.priority ? `${ids.priority}-error` : undefined
          }
        >
          <legend className="ed-grupo__titulo">Prioridad</legend>
          <div
            className="gt-opciones ed-prioridades"
            id={ids.priority}
            tabIndex={-1}
          >
            {prioridadesNota.map((p) => (
              <label key={p.id} className="gt-opcion">
                <input
                  type="radio"
                  name={`${base}-prioridad`}
                  value={p.id}
                  checked={valores.priority === p.id}
                  onChange={() => cambiar("priority", p.id)}
                />
                <span className="gt-opcion__texto">
                  <Icon name={p.icono} /> {p.texto}
                </span>
              </label>
            ))}
          </div>
          {errores.priority && (
            <p id={`${ids.priority}-error`} className="mz-field-error mb-0">
              {errores.priority}
            </p>
          )}
        </fieldset>
        <fieldset
          className="ed-grupo"
          aria-describedby={errores.color ? `${ids.color}-error` : undefined}
        >
          <legend className="ed-grupo__titulo">Color de la nota</legend>
          {/* Cada muestra dice su nombre: el color nunca va solo. */}
          <div className="ed-colores" id={ids.color} tabIndex={-1}>
            {colores.map((c) => (
              <label
                key={c.id}
                className={`ed-color-opcion ${claseDeColor(c.id)}`}
              >
                <input
                  type="radio"
                  name={`${base}-color`}
                  value={c.id}
                  checked={valores.color === c.id}
                  onChange={() => cambiar("color", c.id)}
                />
                <span>{c.texto}</span>
              </label>
            ))}
          </div>
          {errores.color && (
            <p id={`${ids.color}-error`} className="mz-field-error mb-0">
              {errores.color}
            </p>
          )}
        </fieldset>
        <Campo
          id={ids.attachment}
          etiqueta="Archivo adjunto (opcional)"
          error={errores.attachment}
          ayuda={`${listaDeFormatos(reglasAdjunto.extensions ?? [])}, hasta ${tamano(reglasAdjunto.max_bytes)}.`}
        >
          <input
            ref={selector}
            type="file"
            className="form-control"
            accept={aceptados}
            onChange={elegirArchivo}
          />
        </Campo>
        {archivo && (
          <div className="ed-archivo">
            <Icon name="paperclip" />
            <span className="ed-archivo__nombre">
              Listo para adjuntar ({tamano(archivo.size)})
            </span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={quitarArchivo}
              disabled={enviando}
            >
              Quitar <span className="visually-hidden">{archivo.name}</span>
            </button>
          </div>
        )}
      </form>
    </Ventana>
  );
}
