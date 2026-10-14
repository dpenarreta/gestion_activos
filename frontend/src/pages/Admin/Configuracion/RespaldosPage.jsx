import { useCallback, useEffect, useRef, useState } from "react";

import { respaldosService } from "../../../api/respaldosService";
import { Icon } from "../../../components/common/Icon/Icon";
import { usePermission } from "../../../hooks/usePermission";
import { mensajeDeError } from "../../../utils/errores";
import { RespaldosGuardados } from "./RespaldosGuardados";
import "./RespaldosPage.css";

const DIAS = [
  [0, "Lun", "Lunes"],
  [1, "Mar", "Martes"],
  [2, "Mié", "Miércoles"],
  [3, "Jue", "Jueves"],
  [4, "Vie", "Viernes"],
  [5, "Sáb", "Sábado"],
  [6, "Dom", "Domingo"],
];

const TODOS = [0, 1, 2, 3, 4, 5, 6];
const LABORABLES = [0, 1, 2, 3, 4];

/** Mientras hay un «Respaldar ahora» pendiente, cada cuánto se pregunta. */
const CONSULTA_MS = 10_000;

/**
 * Una fecha y hora del servidor, en la zona del sistema y no en la del
 * navegador: quien configura «02:30» tiene que leer «02:30» aunque abra la
 * pantalla desde un portátil con otra zona.
 */
function enHoraDelSistema(valor, zona) {
  if (!valor) return null;
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return String(valor);
  return fecha.toLocaleString("es-EC", {
    timeZone: zona || undefined,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mismasListas(a, b) {
  return a.length === b.length && a.every((valor, i) => valor === b[i]);
}

/**
 * Cuándo se respalda solo, y respaldar ya.
 *
 * El «cuándo» se decide aquí y no en el programador de tareas del servidor: el
 * programador es infraestructura, y cambiar la hora o los días no debería
 * necesitar un administrador de servidores. La tarea del sistema pasa cada
 * pocos minutos, siempre igual, y lo que se configura en esta pantalla decide
 * si toca.
 *
 * Se configura como un horario —qué días y a qué horas de cada uno—, en la
 * hora del sistema (Ecuador), no en UTC.
 */
export function RespaldosPage() {
  // Su propio permiso, separado de la apariencia del sistema: apagar el
  // respaldo automático decide de cuándo se puede volver si algo se pierde.
  const puedeEditar = usePermission("configuracion.respaldos");
  const [politica, setPolitica] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPidiendo, setIsPidiendo] = useState(false);
  const [horaNueva, setHoraNueva] = useState("");
  const esperandoRef = useRef(false);

  const cargar = useCallback(
    () =>
      respaldosService.politica().then((datos) => {
        setPolitica(datos);
        return datos;
      }),
    [],
  );

  useEffect(() => {
    cargar().catch((err) =>
      setError(
        mensajeDeError(err, "No se pudo cargar la configuración de respaldos."),
      ),
    );
  }, [cargar]);

  // Con un «Respaldar ahora» pendiente, se pregunta cada poco hasta que la
  // tarea lo cumple: quien lo pidió se queda mirando esta pantalla, y lo que
  // quiere saber es si ya está.
  const pendiente = Boolean(politica?.solicitado_en);
  useEffect(() => {
    if (!pendiente) return undefined;
    esperandoRef.current = true;
    const id = setInterval(() => {
      cargar()
        .then((datos) => {
          if (!datos.solicitado_en && esperandoRef.current) {
            esperandoRef.current = false;
            setAviso(
              datos.ultimo_error
                ? null
                : { tipo: "ok", texto: "Respaldo terminado y verificado." },
            );
          }
        })
        .catch(() => {});
    }, CONSULTA_MS);
    return () => clearInterval(id);
  }, [pendiente, cargar]);

  function fijar(campo, valor) {
    setAviso(null);
    setPolitica((actual) => ({ ...actual, [campo]: valor }));
  }

  function alternarDia(dia) {
    const dias = politica.dias.includes(dia)
      ? politica.dias.filter((d) => d !== dia)
      : [...politica.dias, dia].sort((a, b) => a - b);
    fijar("dias", dias);
  }

  function agregarHora() {
    if (!horaNueva || politica.horas.includes(horaNueva)) {
      setHoraNueva("");
      return;
    }
    fijar("horas", [...politica.horas, horaNueva].sort());
    setHoraNueva("");
  }

  async function guardar(evento) {
    evento.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const actualizada = await respaldosService.guardar({
        activo: politica.activo,
        dias: politica.dias,
        horas: politica.horas,
        destino: politica.destino,
        conservar: Number(politica.conservar),
      });
      setPolitica(actualizada);
      const proximo = enHoraDelSistema(
        actualizada.proximo,
        actualizada.zona_horaria,
      );
      setAviso({
        tipo: "ok",
        texto: `Configuración guardada.${proximo ? ` El próximo respaldo será el ${proximo}.` : ""}`,
      });
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo guardar la configuración."));
    } finally {
      setIsSaving(false);
    }
  }

  async function respaldarAhora() {
    setIsPidiendo(true);
    setError(null);
    setAviso(null);
    try {
      setPolitica(await respaldosService.respaldarAhora());
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo pedir el respaldo."));
    } finally {
      setIsPidiendo(false);
    }
  }

  if (error && !politica) {
    return (
      <div className="mz-alert mz-alert--bad" role="alert">
        <Icon name="x-octagon" />
        {error}
      </div>
    );
  }
  if (!politica) {
    return <div className="mz-empty">Cargando…</div>;
  }

  const zona = politica.zona_horaria;
  const proximo = enHoraDelSistema(politica.proximo, zona);
  const fallo = Boolean(politica.ultimo_error);

  return (
    <div>
      <div className="mz-view-head">
        <div>
          <h2>Respaldos</h2>
          <p className="mz-desc">
            La base y los adjuntos —facturas y actas firmadas— no se regeneran.
            Aquí se decide cuándo se copian solos, en hora de {zona}.
          </p>
        </div>
        {puedeEditar && (
          <div className="mz-view-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={respaldarAhora}
              disabled={isPidiendo || pendiente}
            >
              <Icon name="cloud-arrow-up" />{" "}
              {pendiente ? "Respaldo en cola…" : "Respaldar ahora"}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mz-alert mz-alert--bad" role="alert">
          <Icon name="x-octagon" />
          {error}
        </div>
      )}
      {aviso && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="check2-circle" />
          {aviso.texto}
        </div>
      )}
      {pendiente && (
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="hourglass-split" />
          Respaldo pedido el {enHoraDelSistema(politica.solicitado_en, zona)}.
          La tarea del sistema lo empieza en los próximos{" "}
          {politica.tarea_cada_minutos} minutos; esta pantalla avisa cuando
          termine.
        </div>
      )}

      <div className="mz-grid-2">
        <section className="mz-card">
          <div className="mz-card-head">
            <h3>Horario</h3>
          </div>
          <form onSubmit={guardar} className="mz-card-body">
            <div className="form-check form-switch mb-1">
              <input
                id="resp-activo"
                type="checkbox"
                className="form-check-input"
                disabled={!puedeEditar}
                checked={politica.activo}
                onChange={(e) => fijar("activo", e.target.checked)}
              />
              <label className="form-check-label" htmlFor="resp-activo">
                Respaldar automáticamente
              </label>
            </div>
            <p className="mz-small mz-faint">
              Apagado, no se respalda solo. «Respaldar ahora» sigue funcionando.
            </p>

            <div className="mz-section">
              <h4 id="resp-dias">Qué días</h4>
              <div className="respaldo-fila">
                <div
                  className="mz-chips"
                  role="group"
                  aria-labelledby="resp-dias"
                >
                  {DIAS.map(([valor, corto, largo]) => (
                    <button
                      key={valor}
                      type="button"
                      className={politica.dias.includes(valor) ? "is-on" : ""}
                      aria-pressed={politica.dias.includes(valor)}
                      aria-label={largo}
                      title={largo}
                      disabled={!puedeEditar}
                      onClick={() => alternarDia(valor)}
                    >
                      {corto}
                    </button>
                  ))}
                </div>
                {puedeEditar && (
                  <div className="respaldo-atajos">
                    <button
                      type="button"
                      className="btn btn-link btn-sm"
                      disabled={mismasListas(politica.dias, TODOS)}
                      onClick={() => fijar("dias", TODOS)}
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      className="btn btn-link btn-sm"
                      disabled={mismasListas(politica.dias, LABORABLES)}
                      onClick={() => fijar("dias", LABORABLES)}
                    >
                      Lunes a viernes
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="mz-section">
              <h4 id="resp-horas">A qué horas</h4>
              <ul className="respaldo-horas" aria-labelledby="resp-horas">
                {politica.horas.map((hora) => (
                  <li key={hora} className="mz-pill mz-pill--neutral">
                    <span className="mz-mono">{hora}</span>
                    {puedeEditar && politica.horas.length > 1 && (
                      <button
                        type="button"
                        className="respaldo-quitar"
                        aria-label={`Quitar ${hora}`}
                        onClick={() =>
                          fijar(
                            "horas",
                            politica.horas.filter((h) => h !== hora),
                          )
                        }
                      >
                        <Icon name="x" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {puedeEditar && (
                <div className="mz-inline-add">
                  <label className="visually-hidden" htmlFor="resp-hora-nueva">
                    Agregar hora
                  </label>
                  <input
                    id="resp-hora-nueva"
                    type="time"
                    className="form-control form-control-sm"
                    value={horaNueva}
                    onChange={(e) => setHoraNueva(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={agregarHora}
                    disabled={!horaNueva}
                  >
                    <Icon name="plus-lg" /> Agregar hora
                  </button>
                </div>
              )}
              <p className="mz-small mz-faint mt-2">
                El respaldo corre en segundo plano: no abre ventanas ni muestra
                avisos, y el sistema sigue disponible mientras dura.
              </p>
            </div>

            <div className="mz-field-grid">
              <div className="mz-field">
                <label htmlFor="resp-destino">Carpeta de destino</label>
                <input
                  id="resp-destino"
                  className="form-control"
                  disabled={!puedeEditar}
                  value={politica.destino}
                  onChange={(e) => fijar("destino", e.target.value)}
                />
              </div>
              <div className="mz-field">
                <label htmlFor="resp-conservar">Cuántos conservar</label>
                <input
                  id="resp-conservar"
                  type="number"
                  min="1"
                  className="form-control"
                  disabled={!puedeEditar}
                  value={politica.conservar}
                  onChange={(e) => fijar("conservar", e.target.value)}
                />
              </div>
            </div>
            <p className="mz-small mz-faint mt-2">
              Conviene que la carpeta esté fuera de esta máquina: un respaldo
              que vive junto a lo que protege no protege de perderla. Los más
              viejos se retiran al hacer uno nuevo.
            </p>

            {puedeEditar && (
              <div className="mz-actions justify-content-end mt-3">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSaving}
                >
                  {isSaving ? "Guardando…" : "Guardar"}
                </button>
              </div>
            )}
          </form>
        </section>

        <section className="mz-card">
          <div className="mz-card-head">
            <h3>Estado</h3>
            {politica.ultima_ejecucion && (
              <span
                className={`mz-pill ${fallo ? "mz-pill--bad" : "mz-pill--ok"}`}
              >
                <Icon name={fallo ? "exclamation-triangle" : "check2"} />{" "}
                {fallo ? "Último intento falló" : "Al día"}
              </span>
            )}
          </div>
          <div className="mz-card-body">
            <div className="mz-kv-grid">
              <div className="mz-kv mz-kv--full">
                <span className="mz-kv-label">Último respaldo en disco</span>
                {enHoraDelSistema(politica.ultimo_en_disco, zona) ??
                  "Ninguno todavía"}
              </div>
              <div className="mz-kv mz-kv--full">
                <span className="mz-kv-label">Próximo</span>
                {politica.activo
                  ? (proximo ?? "Sin determinar")
                  : "Respaldo automático apagado"}
              </div>
              <div className="mz-kv mz-kv--full">
                <span className="mz-kv-label">
                  Última ejecución de la tarea
                </span>
                {enHoraDelSistema(politica.ultima_ejecucion, zona) ??
                  "Todavía no ha respaldado"}
              </div>
            </div>
            {fallo && (
              <div className="mz-alert mz-alert--bad" role="alert">
                <Icon name="x-octagon" />
                <div>
                  <strong>El último respaldo no se completó.</strong>
                  <div className="respaldo-error mz-mono">
                    {politica.ultimo_error}
                  </div>
                </div>
              </div>
            )}
            <div className="mz-note">
              <Icon name="info-circle" />
              {/* Lo que casi nadie hace, y lo único que convierte un archivo
                  en un respaldo de verdad. */}
              Un respaldo que nunca se restauró no es un respaldo: pruebe la
              restauración en una base aparte de vez en cuando.
            </div>
          </div>
        </section>
      </div>

      <RespaldosGuardados
        puedeEditar={puedeEditar}
        zona={zona}
        version={politica.ultima_ejecucion}
      />
    </div>
  );
}
