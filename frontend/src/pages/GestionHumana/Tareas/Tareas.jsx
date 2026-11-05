/*
 * Tareas (`TasksModule` de Nexo): sus tareas activas en Kanban, Tabla o
 * Gantt, y el Repositorio de meses cerrados, como pestañas. La vista elegida
 * va en la dirección (`?vista=`), así se comparte y se recuerda al volver.
 *
 * Los avisos de la campana enlazan a `/tareas/<id>`: se abre esa tarea
 * aunque sea de alguien de su equipo (el servidor decide si la puede ver).
 *
 * Sin sondeo: la lista se vuelve a pedir al guardar, al registrar horas y al
 * importar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { errorDeTareas, tareasService } from "../../../api/tareasService";
import { confirmar } from "../../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  PanelDePestana,
  Pestanas,
} from "../../../components/common/Pestanas/Pestanas";
import {
  RUTA_GESTION_HUMANA,
  TAREAS_ACCEDER,
  TAREAS_ADMINISTRAR,
  TAREAS_CERRAR_MES,
  TAREAS_VALIDAR,
} from "../../../modulos/permisosGestionHumana";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { Aviso, MenuDeAcciones } from "../comunes";
import { ConAccesoTareas, Encabezado, useTareas } from "./ContextoTareas";
import { FormularioTarea } from "./FormularioTarea";
import { PanelActividades } from "./PanelActividades";
import { PanelComentarios } from "./PanelComentarios";
import { RegistroRetroactivo } from "./RegistroRetroactivo";
import { Ventana } from "./Ventanas";
import { VistaGantt } from "./VistaGantt";
import { VistaKanban } from "./VistaKanban";
import { VistaRepositorio } from "./VistaRepositorio";
import { VistaTabla } from "./VistaTabla";
import {
  COLORES,
  ESTADO,
  claseDeColor,
  mesLargo,
  nombreDe,
} from "./tareasComunes";

const VISTAS = [
  { id: "kanban", etiqueta: "Kanban", icono: "kanban" },
  { id: "tabla", etiqueta: "Tabla", icono: "table" },
  { id: "gantt", etiqueta: "Gantt", icono: "bar-chart-steps" },
  { id: "repositorio", etiqueta: "Repositorio", icono: "archive" },
];

export function Tareas() {
  return (
    <ConAccesoTareas titulo="Tareas" permiso={TAREAS_ACCEDER}>
      <PantallaTareas />
    </ConAccesoTareas>
  );
}

function ElegirColor({ tarea, onCerrar, onElegido }) {
  const [valor, setValor] = useState(tarea.color || "");
  const [guardando, setGuardando] = useState(false);
  return (
    <Ventana
      titulo="Color de la tarjeta"
      subtitulo={`«${tarea.title}». Solo le sirve a usted para ordenarse.`}
      onCerrar={onCerrar}
      pie={
        <>
          <button type="button" className="btn btn-cancelar" onClick={onCerrar}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={guardando}
            onClick={async () => {
              setGuardando(true);
              await onElegido(valor || null);
              setGuardando(false);
            }}
          >
            {guardando ? "Guardando…" : "Aplicar color"}
          </button>
        </>
      }
    >
      <fieldset>
        <legend className="visually-hidden">Color</legend>
        <div className="gt-colores">
          {[{ valor: "", nombre: "Sin color" }, ...COLORES].map((c) => (
            <label key={c.valor || "ninguno"} className="gt-color-opcion">
              <input
                type="radio"
                name="gt-color"
                value={c.valor}
                checked={valor === c.valor}
                onChange={() => setValor(c.valor)}
              />
              <span
                className={`gt-color-muestra ${claseDeColor(c.valor)}`}
                aria-hidden="true"
              />
              <span>{c.nombre}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </Ventana>
  );
}

function AvisoDeMesesSinCerrar() {
  const [pendientes, setPendientes] = useState(null);
  const [error, setError] = useState(null);

  const cargar = useCallback(() => {
    setError(null);
    tareasService
      .vistaPreviaDelCierre()
      .then((d) => setPendientes(d?.pending_closures ?? []))
      .catch((err) =>
        setError(
          errorDeTareas(err, "No se pudo revisar si hay meses sin cerrar.")
            .mensaje,
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error) return <EstadoDeCarga error={error} onReintentar={cargar} />;
  if (!pendientes?.length) return null;
  const primero = pendientes[0];
  return (
    <div className="mz-alert mz-alert--warn" role="status">
      <Icon name="exclamation-triangle" />
      <span className="flex-grow-1">
        <strong>
          {pendientes.length === 1
            ? `${mesLargo(primero.year, primero.month)} quedó sin cerrar.`
            : `${pendientes.length} meses quedaron sin cerrar: ${pendientes
                .map((p) => mesLargo(p.year, p.month))
                .join(", ")}.`}
        </strong>{" "}
        Hasta que se cierre, sus tareas no pasan al repositorio y las
        recurrentes no generan la del mes siguiente.
      </span>
      <Link
        className="btn btn-outline-secondary btn-sm"
        to={`${RUTA_GESTION_HUMANA}/cierre-de-mes?year=${primero.year}&month=${primero.month}`}
      >
        Cerrar {mesLargo(primero.year, primero.month)}
      </Link>
    </div>
  );
}

function PantallaTareas() {
  const { usuarioId, can } = useTareas();
  const { tareaId } = useParams();
  const [parametros, setParametros] = useSearchParams();
  const vista = VISTAS.some((v) => v.id === parametros.get("vista"))
    ? parametros.get("vista")
    : "kanban";
  const [tareas, setTareas] = useState(null);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [aviso, setAviso] = useState(null);
  const [formulario, setFormulario] = useState(null);
  const [comentando, setComentando] = useState(null);
  const [registrando, setRegistrando] = useState(null);
  const [retroactiva, setRetroactiva] = useState(null);
  const [coloreando, setColoreando] = useState(null);
  // La tarea recién movida: su título recibe el foco en la nueva columna.
  const [foco, setFoco] = useState(null);
  const estrecha = useMediaQuery("(max-width: 600px)");
  const [importando, setImportando] = useState(false);
  const [resultadoImportacion, setResultadoImportacion] = useState(null);
  const archivo = useRef(null);
  const enlaceAbierto = useRef(null);

  const contexto = useMemo(
    () => ({
      usuarioId,
      administra: can(TAREAS_ADMINISTRAR),
      valida: can(TAREAS_VALIDAR),
    }),
    [usuarioId, can],
  );

  const cargar = useCallback(() => {
    setError(null);
    return tareasService
      .listar()
      .then((lista) => setTareas(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setError(
          errorDeTareas(err, "No se pudieron cargar sus tareas.").mensaje,
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // El enlace de un aviso abre los comentarios de esa tarea (como en Nexo).
  useEffect(() => {
    if (!tareaId || enlaceAbierto.current === tareaId) return;
    enlaceAbierto.current = tareaId;
    tareasService
      .obtener(tareaId)
      .then((t) => setComentando(t))
      .catch((err) =>
        setAviso({
          tono: "warn",
          texto: errorDeTareas(
            err,
            "No se pudo abrir la tarea del aviso: es posible que ya no exista o que no tenga acceso.",
          ).mensaje,
        }),
      );
  }, [tareaId]);

  const reemplazar = (nueva) =>
    setTareas((lista) =>
      lista?.some((t) => t.id === nueva.id)
        ? lista.map((t) => (t.id === nueva.id ? nueva : t))
        : lista,
    );

  const mover = useCallback(async (tarea, estado) => {
    if (tarea.status === estado) return;
    const anterior = tarea.status;
    setTareas((lista) =>
      lista?.map((t) => (t.id === tarea.id ? { ...t, status: estado } : t)),
    );
    try {
      const nueva = await tareasService.actualizar(tarea.id, {
        status: estado,
      });
      setTareas((lista) => lista?.map((t) => (t.id === nueva.id ? nueva : t)));
      setAviso({ texto: `«${tarea.title}» pasó a ${ESTADO[estado]}.` });
      setFoco({ id: tarea.id });
    } catch (err) {
      setTareas((lista) =>
        lista?.map((t) => (t.id === tarea.id ? { ...t, status: anterior } : t)),
      );
      setFoco({ id: tarea.id });
      setAviso({
        tono: "bad",
        texto: errorDeTareas(err, "No se pudo cambiar el estado de la tarea.")
          .mensaje,
      });
    }
  }, []);

  async function eliminar(tarea) {
    const seguir = await confirmar({
      titulo: `¿Eliminar la tarea «${tarea.title}»?`,
      mensaje:
        "Se eliminan también sus actividades registradas y sus comentarios. No se puede deshacer.",
      accion: "Eliminar tarea",
    });
    if (!seguir) return;
    try {
      await tareasService.eliminar(tarea.id);
      setTareas((lista) => lista?.filter((t) => t.id !== tarea.id));
      setAviso({ texto: `Tarea «${tarea.title}» eliminada.` });
    } catch (err) {
      setAviso({
        tono: "bad",
        texto: errorDeTareas(err, "No se pudo eliminar la tarea.").mensaje,
      });
    }
  }

  async function eliminarVarias(lista) {
    const resultados = await Promise.allSettled(
      lista.map((t) => tareasService.eliminar(t.id)),
    );
    const borradas = lista.filter(
      (_, i) => resultados[i].status === "fulfilled",
    );
    const fallidas = lista.length - borradas.length;
    const ids = new Set(borradas.map((t) => t.id));
    setTareas((l) => l?.filter((t) => !ids.has(t.id)));
    setAviso({
      tono: fallidas ? "warn" : "ok",
      texto: `${borradas.length} tarea${borradas.length === 1 ? "" : "s"} eliminada${borradas.length === 1 ? "" : "s"}.${fallidas ? ` ${fallidas} no se pudieron eliminar; revise sus permisos e intente de nuevo.` : ""}`,
    });
  }

  async function aplicarColor(tarea, color) {
    try {
      reemplazar(await tareasService.actualizar(tarea.id, { color }));
      setColoreando(null);
    } catch (err) {
      setColoreando(null);
      setAviso({
        tono: "bad",
        texto: errorDeTareas(err, "No se pudo cambiar el color.").mensaje,
      });
    }
  }

  async function importar(evento) {
    const elegido = evento.target.files?.[0];
    evento.target.value = "";
    if (!elegido) return;
    setImportando(true);
    setResultadoImportacion(null);
    try {
      const r = await tareasService.importar(elegido);
      setResultadoImportacion(r);
      if (r.imported > 0) cargar();
    } catch (err) {
      setAviso({
        tono: "bad",
        texto: errorDeTareas(err, "No se pudo importar el archivo.").mensaje,
      });
    } finally {
      setImportando(false);
    }
  }

  async function plantilla() {
    try {
      await tareasService.descargarPlantilla();
    } catch (err) {
      setAviso({
        tono: "bad",
        texto: errorDeTareas(err, "No se pudo descargar la plantilla.").mensaje,
      });
    }
  }

  const manejadores = {
    mover,
    actividades: setRegistrando,
    retroactiva: setRetroactiva,
    comentarios: setComentando,
    editar: (t) => setFormulario({ tarea: t }),
    color: setColoreando,
    eliminar,
  };

  const texto = busqueda.trim().toLowerCase();
  const filtradas = useMemo(() => {
    if (!tareas || !texto) return tareas ?? [];
    return tareas.filter(
      (t) =>
        t.title.toLowerCase().includes(texto) ||
        (t.description ?? "").toLowerCase().includes(texto) ||
        nombreDe(t.assigned_to).toLowerCase().includes(texto),
    );
  }, [tareas, texto]);

  const nueva = (estado = "PENDIENTE") =>
    setFormulario({ tarea: null, estado });
  const enLista = vista !== "repositorio";
  const sinResultados =
    Boolean(texto) && tareas?.length > 0 && !filtradas.length;

  return (
    <div className="gh-page">
      <Encabezado
        titulo="Tareas"
        descripcion="Sus tareas activas, su registro de horas y el repositorio de meses cerrados."
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => nueva()}
        >
          <Icon name="plus-lg" /> Nueva tarea
        </button>
        {estrecha ? (
          // En el teléfono, lo de uso ocasional va en «⋯».
          <MenuDeAcciones
            etiqueta="Más acciones de Tareas"
            acciones={[
              {
                texto: importando ? "Importando…" : "Importar desde Excel",
                onClick: () => archivo.current?.click(),
              },
              { texto: "Descargar plantilla", onClick: plantilla },
            ]}
          />
        ) : (
          <>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => archivo.current?.click()}
              disabled={importando}
            >
              <Icon name="upload" />{" "}
              {importando ? "Importando…" : "Importar desde Excel"}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={plantilla}
            >
              <Icon name="file-earmark-arrow-down" /> Descargar plantilla
            </button>
          </>
        )}
        <input
          ref={archivo}
          type="file"
          accept=".xlsx"
          className="visually-hidden"
          tabIndex={-1}
          aria-label="Archivo de Excel con tareas"
          onChange={importar}
        />
      </Encabezado>

      {can(TAREAS_CERRAR_MES) && <AvisoDeMesesSinCerrar />}
      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />
      {resultadoImportacion && (
        <div
          className={`mz-alert ${resultadoImportacion.errors?.length ? "mz-alert--warn" : "mz-alert--ok"}`}
          role="status"
        >
          <Icon
            name={
              resultadoImportacion.errors?.length
                ? "exclamation-triangle"
                : "check2-circle"
            }
          />
          <div className="flex-grow-1">
            <strong>
              {resultadoImportacion.imported} tarea
              {resultadoImportacion.imported === 1 ? "" : "s"} importada
              {resultadoImportacion.imported === 1 ? "" : "s"}
              {resultadoImportacion.errors?.length
                ? ` · ${resultadoImportacion.errors.length} fila(s) con errores`
                : ""}
              .
            </strong>
            {resultadoImportacion.errors?.length > 0 && (
              <ul className="gh-lista-errores">
                {resultadoImportacion.errors.map((e) => (
                  <li key={`${e.row}-${e.error}`}>
                    Fila {e.row}: {e.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="mz-close"
            aria-label="Cerrar el resultado de la importación"
            onClick={() => setResultadoImportacion(null)}
          >
            <Icon name="x-lg" />
          </button>
        </div>
      )}

      <Pestanas
        etiqueta="Vista de tareas"
        idBase="gt-vistas"
        valor={vista}
        onCambio={(v) => setParametros({ vista: v }, { replace: true })}
        opciones={VISTAS}
        className="gt-pestanas"
      />
      <PanelDePestana idBase="gt-vistas" valor={vista} className="gh-page">
        {enLista && (
          <div className="gt-busqueda">
            <label className="form-label" htmlFor="gt-buscar">
              Buscar
            </label>
            <input
              id="gt-buscar"
              type="search"
              className="form-control"
              placeholder="Título, descripción o persona"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
        )}
        {enLista && (
          <EstadoDeCarga
            cargando={tareas === null && !error}
            error={error}
            onReintentar={cargar}
            // El Kanban vacío muestra sus columnas (cada una con «Nueva
            // tarea»); la Tabla y el Gantt, el aviso con la acción.
            vacio={
              tareas !== null &&
              (vista === "kanban" ? sinResultados : filtradas.length === 0)
            }
            hayFiltros={Boolean(texto) && tareas?.length > 0}
            onLimpiarFiltros={() => setBusqueda("")}
            textoVacio="Todavía no tiene tareas activas."
            accionVacio={
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => nueva()}
              >
                Crear una tarea
              </button>
            }
          />
        )}
        {tareas && !error && vista === "kanban" && !sinResultados && (
          <VistaKanban
            tareas={filtradas}
            contexto={contexto}
            manejadores={manejadores}
            onNueva={nueva}
            foco={foco}
          />
        )}
        {tareas && !error && vista === "tabla" && filtradas.length > 0 && (
          <VistaTabla
            tareas={filtradas}
            contexto={contexto}
            manejadores={manejadores}
            onEliminarVarias={eliminarVarias}
            foco={foco}
          />
        )}
        {tareas && !error && vista === "gantt" && filtradas.length > 0 && (
          <VistaGantt
            tareas={filtradas}
            usuarioId={usuarioId}
            onAbrir={setRegistrando}
          />
        )}
        {vista === "repositorio" && (
          <VistaRepositorio administra={contexto.administra} />
        )}
      </PanelDePestana>

      {formulario && (
        <FormularioTarea
          tarea={formulario.tarea}
          estadoInicial={formulario.estado}
          usuarioId={usuarioId}
          onCerrar={() => setFormulario(null)}
          onGuardada={(guardada, mensaje) => {
            setFormulario(null);
            setAviso({ texto: mensaje });
            cargar();
          }}
        />
      )}
      {comentando && (
        <PanelComentarios
          tarea={comentando}
          onCerrar={() => setComentando(null)}
          onVistos={(id) =>
            setTareas((l) =>
              l?.map((t) =>
                t.id === id ? { ...t, has_unread_comments: false } : t,
              ),
            )
          }
          onComentado={(id) =>
            setTareas((l) =>
              l?.map((t) =>
                t.id === id
                  ? { ...t, comment_count: (t.comment_count ?? 0) + 1 }
                  : t,
              ),
            )
          }
        />
      )}
      {registrando && (
        <PanelActividades
          tarea={registrando}
          onCerrar={() => setRegistrando(null)}
          onCambio={cargar}
          onRetroactiva={(t) => {
            setRegistrando(null);
            setRetroactiva(t);
          }}
        />
      )}
      {retroactiva && (
        <RegistroRetroactivo
          tarea={retroactiva}
          onCerrar={() => setRetroactiva(null)}
          onGuardado={(mensaje) => {
            setRetroactiva(null);
            setAviso({ texto: mensaje });
            cargar();
          }}
        />
      )}
      {coloreando && (
        <ElegirColor
          tarea={coloreando}
          onCerrar={() => setColoreando(null)}
          onElegido={(color) => aplicarColor(coloreando, color)}
        />
      )}
    </div>
  );
}
