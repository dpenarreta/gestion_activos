/*
 * Programar o editar una reunión (`MeetingFormModalDashboard` de Nexo, sin
 * Zoom): título, fecha y hora, duración, descripción, el enlace que pega
 * quien organiza (Zoom, Teams, Meet…, siempre `https://`), su clave y los
 * invitados, elegidos con un buscador sobre `reuniones/invitables/`.
 *
 * Al editar solo se manda lo que cambió; los invitados van como la lista
 * completa (`invitee_ids`), y quienes siguen conservan su asistencia. El
 * servidor vuelve a validar todo (el enlace, que cada invitado tenga acceso)
 * y su motivo se muestra bajo el campo.
 */
import { useId, useRef, useState } from "react";

import {
  errorDeReuniones,
  reunionesService,
} from "../../../api/reunionesService";
import {
  Campo,
  LeyendaObligatorios,
} from "../../../components/common/Campo/Campo";
import { Icon } from "../../../components/common/Icon/Icon";
import { SelectorDePersonas } from "../SelectorDePersonas";
import { Ventana } from "../Tareas/Ventanas";
import { useReuniones } from "./ContextoReuniones";
import {
  DURACIONES_SUGERIDAS,
  aCampoLocal,
  deCampoLocal,
  duracionEnTexto,
  problemaDelEnlace,
} from "./reunionesComunes";

const ORDEN = [
  "title",
  "meeting_date",
  "duration",
  "description",
  "join_url",
  "join_password",
  "invitee_ids",
];

/** La próxima hora en punto: un valor razonable para empezar. */
function proximaHora() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return aCampoLocal(d.toISOString());
}

function valoresIniciales(reunion) {
  return {
    title: reunion?.title ?? "",
    meeting_date: reunion ? aCampoLocal(reunion.meeting_date) : proximaHora(),
    duration: String(reunion?.duration ?? 30),
    description: reunion?.description ?? "",
    join_url: reunion?.join_url ?? "",
    join_password: reunion?.join_password ?? "",
  };
}

export function FormularioReunion({ reunion = null, onCerrar, onGuardada }) {
  const { limites } = useReuniones();
  const editando = Boolean(reunion);
  const base = useId();
  const ids = {
    title: `${base}-titulo`,
    meeting_date: `${base}-fecha`,
    duration: `${base}-duracion`,
    description: `${base}-descripcion`,
    join_url: `${base}-enlace`,
    join_password: `${base}-clave`,
    invitee_ids: `${base}-invitados`,
    formulario: `${base}-formulario`,
  };
  const [valores, setValores] = useState(() => valoresIniciales(reunion));
  // Los invitados elegidos, con su nombre (para mostrarlos aunque el
  // buscador ya no los liste).
  const [invitados, setInvitados] = useState(() =>
    (reunion?.invitees ?? []).map((i) => i.user).filter(Boolean),
  );
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enCurso = useRef(false);

  function cambiar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    setErrores((e) => {
      const resto = { ...e };
      delete resto[campo];
      return resto;
    });
  }

  function validar() {
    const e = {};
    if (!valores.title.trim()) e.title = "Escriba el título de la reunión.";
    if (!valores.meeting_date || !deCampoLocal(valores.meeting_date))
      e.meeting_date = "Elija la fecha y la hora de inicio.";
    const minutos = Number(valores.duration);
    if (
      valores.duration === "" ||
      !Number.isInteger(minutos) ||
      minutos < 1 ||
      minutos > limites.duration_max
    )
      e.duration = `La duración tiene que ser un número entero de minutos, entre 1 y ${limites.duration_max}.`;
    const enlace = problemaDelEnlace(valores.join_url);
    if (enlace) e.join_url = enlace;
    if (invitados.length > limites.invitees_max)
      e.invitee_ids = `Una reunión admite hasta ${limites.invitees_max} invitados.`;
    return e;
  }

  function enfocar(campos) {
    const primero = ORDEN.find((c) => campos[c]);
    if (primero) document.getElementById(ids[primero])?.focus();
  }

  /** Lo que se manda: todo al crear; al editar, solo lo que cambió. */
  function cuerpo() {
    const completo = {
      title: valores.title.trim(),
      meeting_date: deCampoLocal(valores.meeting_date),
      duration: Number(valores.duration),
      description: valores.description.trim() || null,
      join_url: valores.join_url.trim() || null,
      join_password: valores.join_password.trim() || null,
      invitee_ids: invitados.map((p) => p.id),
    };
    if (!editando) return completo;
    const antes = {
      title: reunion.title,
      meeting_date: new Date(reunion.meeting_date).toISOString(),
      duration: reunion.duration,
      description: reunion.description || null,
      join_url: reunion.join_url || null,
      join_password: reunion.join_password || null,
    };
    const cambios = {};
    for (const [campo, valor] of Object.entries(antes))
      if (completo[campo] !== valor) cambios[campo] = completo[campo];
    const previos = (reunion.invitees ?? []).map((i) => i.user?.id).sort();
    const ahora = [...completo.invitee_ids].sort();
    if (previos.join(",") !== ahora.join(","))
      cambios.invitee_ids = completo.invitee_ids;
    return cambios;
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
    const datos = cuerpo();
    if (editando && Object.keys(datos).length === 0) {
      // Nada cambió: no hace falta molestar al servidor ni a los invitados.
      onCerrar();
      return;
    }
    enCurso.current = true;
    setEnviando(true);
    setErrorGeneral(null);
    try {
      const guardada = editando
        ? await reunionesService.editar(reunion.id, datos)
        : await reunionesService.crear(datos);
      onGuardada(guardada);
    } catch (err) {
      const e = errorDeReuniones(
        err,
        editando
          ? "No se pudo guardar la reunión."
          : "No se pudo programar la reunión.",
      );
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

  const minutos = Number(valores.duration);

  return (
    <Ventana
      titulo={editando ? "Editar la reunión" : "Programar una reunión"}
      subtitulo={
        editando
          ? "Si cambia la fecha, la duración o el enlace, a los invitados les llega el aviso."
          : "A cada invitado le llega el aviso con la fecha y el enlace."
      }
      onCerrar={onCerrar}
      bloqueada={enviando}
      ancha
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
                Guardando…
              </>
            ) : editando ? (
              <>
                <Icon name="check2" /> Guardar cambios
              </>
            ) : (
              <>
                <Icon name="calendar-plus" /> Programar reunión
              </>
            )}
          </button>
        </>
      }
    >
      <form
        id={ids.formulario}
        className="re-formulario"
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
        <Campo
          id={ids.title}
          etiqueta="Título"
          obligatorio
          error={errores.title}
          ayuda={`${valores.title.length} de ${limites.title} caracteres.`}
        >
          <input
            type="text"
            data-autofocus
            className="form-control"
            value={valores.title}
            maxLength={limites.title}
            placeholder="Por ejemplo: Revisión semanal del equipo"
            onChange={(e) => cambiar("title", e.target.value)}
          />
        </Campo>
        <div className="re-formulario__fila">
          <Campo
            id={ids.meeting_date}
            etiqueta="Fecha y hora de inicio"
            obligatorio
            error={errores.meeting_date}
          >
            <input
              type="datetime-local"
              className="form-control"
              value={valores.meeting_date}
              onChange={(e) => cambiar("meeting_date", e.target.value)}
            />
          </Campo>
          {/* Los atajos van junto a su campo (auditoría UX/UI): debajo
              del número de minutos, en la misma columna. */}
          <div className="re-duracion">
            <Campo
              id={ids.duration}
              etiqueta="Duración (minutos)"
              obligatorio
              error={errores.duration}
              ayuda={
                Number.isInteger(minutos) && minutos > 0
                  ? `${duracionEnTexto(minutos)}. Máximo ${limites.duration_max} minutos.`
                  : `Entre 1 y ${limites.duration_max} minutos.`
              }
            >
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={limites.duration_max}
                step={1}
                className="form-control"
                value={valores.duration}
                onChange={(e) => cambiar("duration", e.target.value)}
              />
            </Campo>
            <div
              className="re-duraciones"
              role="group"
              aria-label="Duraciones frecuentes"
            >
              {DURACIONES_SUGERIDAS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="btn btn-sm re-alternar"
                  aria-pressed={minutos === m}
                  onClick={() => cambiar("duration", String(m))}
                >
                  {minutos === m && <Icon name="check2" />}
                  {duracionEnTexto(m)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <Campo
          id={ids.description}
          etiqueta="Descripción (opcional)"
          error={errores.description}
          ayuda={`${valores.description.length} de ${limites.description} caracteres.`}
        >
          <textarea
            className="form-control"
            rows={3}
            value={valores.description}
            maxLength={limites.description}
            placeholder="Temas a tratar, qué preparar…"
            onChange={(e) => cambiar("description", e.target.value)}
          />
        </Campo>
        <div className="re-formulario__fila">
          <Campo
            id={ids.join_url}
            etiqueta="Enlace de la reunión (opcional)"
            error={errores.join_url}
            ayuda="Pegue el enlace completo de Zoom, Teams, Meet u otra plataforma; tiene que empezar con https://."
          >
            <input
              type="url"
              inputMode="url"
              className="form-control"
              value={valores.join_url}
              maxLength={limites.url}
              placeholder="https://"
              autoComplete="off"
              onChange={(e) => cambiar("join_url", e.target.value)}
            />
          </Campo>
          <Campo
            id={ids.join_password}
            etiqueta="Clave de acceso (opcional)"
            error={errores.join_password}
            ayuda="La ven solo quienes están en la reunión."
          >
            <input
              type="text"
              className="form-control"
              value={valores.join_password}
              maxLength={limites.password}
              autoComplete="off"
              onChange={(e) => cambiar("join_password", e.target.value)}
            />
          </Campo>
        </div>
        <SelectorDePersonas
          id={ids.invitee_ids}
          leyenda="Invitados"
          etiquetaBuscador="Buscar personas para invitar"
          elegidos={invitados}
          maximo={limites.invitees_max}
          buscar={reunionesService.invitables}
          mensajeDeError="No se pudo buscar a quién invitar."
          textoNadie="No hay personas para invitar."
          textoSinElegir="Todavía no ha invitado a nadie."
          textoElegidos={(n) =>
            `${n} ${n === 1 ? "persona invitada" : "personas invitadas"} (máximo ${limites.invitees_max}).`
          }
          error={errores.invitee_ids}
          deshabilitado={enviando}
          onCambio={(lista) => {
            setInvitados(lista);
            setErrores((e) => {
              const resto = { ...e };
              delete resto.invitee_ids;
              return resto;
            });
          }}
        />
      </form>
    </Ventana>
  );
}
