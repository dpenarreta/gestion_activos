/*
 * Ajustes de Tareas (`tareas.administrar`): lo que en Nexo vivía en el
 * Centro de configuración (`TrabajoAvanzadoSection` y
 * `ActivityReasonsSection`).
 *
 * - Ajustes con vigencia: la ventana del registro retroactivo, las horas
 *   efectivas por día, las horas esperadas por mes y a quién se avisa. Un
 *   cambio rige desde ahora: lo ya calculado no cambia.
 * - Motivos de registro de horas, por rol: crear, editar, activar o
 *   desactivar y archivar (archivar lo desactiva; restaurar no lo reactiva,
 *   como en Nexo). Los registros antiguos conservan su motivo.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { errorDeTareas, tareasService } from "../../../api/tareasService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../../components/common/Campo/Campo";
import { confirmar } from "../../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { ModalDialog } from "../../../components/common/ModalDialog/ModalDialog";
import { TAREAS_ADMINISTRAR } from "../../../modulos/permisosGestionHumana";
import { Aviso, ErrorEnLinea, MenuDeAcciones, fechaHora } from "../comunes";
import {
  ConAccesoTareas,
  Encabezado,
  useMotivos,
  useTareas,
} from "./ContextoTareas";
import { ROL, ROLES, rolLegible } from "./tareasComunes";

export function AjustesTareas() {
  return (
    <ConAccesoTareas titulo="Ajustes de tareas" permiso={TAREAS_ADMINISTRAR}>
      <PantallaAjustes />
    </ConAccesoTareas>
  );
}

function CasillasDeRoles({ id, valor, onCambio, error, etiqueta }) {
  return (
    <fieldset
      className="mt-3"
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <legend className="form-label gt-legend">
        {etiqueta}
        <span className="mz-campo__obligatorio" aria-hidden="true">
          {" "}
          *
        </span>
        <span className="visually-hidden"> (obligatorio)</span>
      </legend>
      <div className="gt-roles">
        {ROLES.map((r) => (
          <label key={r} className="form-check">
            <input
              type="checkbox"
              className="form-check-input"
              checked={valor.includes(r)}
              onChange={() =>
                onCambio(
                  valor.includes(r)
                    ? valor.filter((x) => x !== r)
                    : [...valor, r],
                )
              }
            />
            <span className="form-check-label">{ROL[r]}</span>
          </label>
        ))}
      </div>
      {error && (
        <div id={`${id}-error`} className="mz-field-error" role="alert">
          {error}
        </div>
      )}
    </fieldset>
  );
}

function FormularioAjustes() {
  const [ajustes, setAjustes] = useState(null);
  const [valores, setValores] = useState(null);
  const [error, setError] = useState(null);
  const [errores, setErrores] = useState({});
  const [errorGuardar, setErrorGuardar] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);
  const caja = useRef(null);

  const aValores = (a) => ({
    retroactive_window_business_days: String(
      a.retroactive_window_business_days,
    ),
    horas_efectivas_dia: String(a.horas_efectivas_dia),
    horas_esperadas_mes: String(a.horas_esperadas_mes),
    first_comment_role: a.first_comment_role ?? "",
    retroactive_notify_roles: a.retroactive_notify_roles ?? [],
  });

  const cargar = useCallback(() => {
    setError(null);
    tareasService
      .ajustes()
      .then((a) => {
        setAjustes(a);
        setValores(aValores(a));
      })
      .catch((err) =>
        setError(
          errorDeTareas(err, "No se pudieron cargar los ajustes.").mensaje,
        ),
      );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const cambiar = (campo) => (e) =>
    setValores((v) => ({ ...v, [campo]: e.target.value }));

  async function guardar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const e = {};
    const ventana = Number(valores.retroactive_window_business_days);
    const efectivas = Number(valores.horas_efectivas_dia.replace(",", "."));
    const esperadas = Number(valores.horas_esperadas_mes.replace(",", "."));
    if (!Number.isInteger(ventana) || ventana < 1 || ventana > 15)
      e.retroactive_window_business_days = "Entre 1 y 15 días laborables.";
    if (Number.isNaN(efectivas) || efectivas < 0.5 || efectivas > 24)
      e.horas_efectivas_dia = "Entre 0,5 y 24 horas.";
    if (Number.isNaN(esperadas) || esperadas < 1 || esperadas > 400)
      e.horas_esperadas_mes = "Entre 1 y 400 horas.";
    setErrores(e);
    setErrorGuardar(null);
    if (Object.keys(e).length) {
      enfocarPrimerError(caja.current);
      return;
    }
    const cuerpo = {};
    if (ventana !== ajustes.retroactive_window_business_days)
      cuerpo.retroactive_window_business_days = ventana;
    if (efectivas !== ajustes.horas_efectivas_dia)
      cuerpo.horas_efectivas_dia = efectivas;
    if (esperadas !== ajustes.horas_esperadas_mes)
      cuerpo.horas_esperadas_mes = esperadas;
    if (
      (valores.first_comment_role || null) !==
      (ajustes.first_comment_role ?? null)
    )
      cuerpo.first_comment_role = valores.first_comment_role || null;
    const antes = [...(ajustes.retroactive_notify_roles ?? [])]
      .sort()
      .join("|");
    const ahora = [...valores.retroactive_notify_roles].sort().join("|");
    if (antes !== ahora)
      cuerpo.retroactive_notify_roles = valores.retroactive_notify_roles;
    if (!Object.keys(cuerpo).length) {
      setAviso({ tono: "info", texto: "No hay cambios para guardar." });
      return;
    }
    enCurso.current = true;
    setGuardando(true);
    try {
      const nuevos = await tareasService.guardarAjustes(cuerpo);
      setAjustes(nuevos);
      setValores(aValores(nuevos));
      setAviso({
        texto:
          "Ajustes guardados. Rigen desde ahora; lo ya calculado no cambia.",
      });
    } catch (err) {
      const fallo = errorDeTareas(err, "No se pudieron guardar los ajustes.");
      setErrores(fallo.campos);
      setErrorGuardar(fallo.mensaje);
      enfocarPrimerError(caja.current);
    } finally {
      enCurso.current = false;
      setGuardando(false);
    }
  }

  return (
    <section className="mz-card" aria-labelledby="gt-ajustes-titulo">
      <div className="mz-card-body">
        <h3 id="gt-ajustes-titulo" className="h6">
          Ajustes
        </h3>
        <EstadoDeCarga
          cargando={!valores && !error}
          error={error}
          onReintentar={cargar}
        />
        {valores && (
          <form ref={caja} onSubmit={guardar} noValidate>
            <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />
            <div className="gt-form-grid">
              <Campo
                id="gt-aj-ventana"
                etiqueta="Ventana del registro retroactivo (días laborables)"
                error={errores.retroactive_window_business_days}
                ayuda="Cuántos días laborables hacia atrás (sin contar hoy) se pueden registrar horas."
              >
                <input
                  type="number"
                  min={1}
                  max={15}
                  className="form-control"
                  value={valores.retroactive_window_business_days}
                  onChange={cambiar("retroactive_window_business_days")}
                />
              </Campo>
              <Campo
                id="gt-aj-efectivas"
                etiqueta="Horas efectivas por día"
                error={errores.horas_efectivas_dia}
              >
                <input
                  inputMode="decimal"
                  className="form-control"
                  value={valores.horas_efectivas_dia}
                  onChange={cambiar("horas_efectivas_dia")}
                />
              </Campo>
              <Campo
                id="gt-aj-esperadas"
                etiqueta="Horas esperadas por mes"
                error={errores.horas_esperadas_mes}
                ayuda="Se reparten entre los días hábiles del mes (base del cierre)."
              >
                <input
                  inputMode="decimal"
                  className="form-control"
                  value={valores.horas_esperadas_mes}
                  onChange={cambiar("horas_esperadas_mes")}
                />
              </Campo>
              <Campo
                id="gt-aj-primer"
                etiqueta="Además avisar del primer comentario de cada tarea a"
                error={errores.first_comment_role}
                ayuda="Del resto de comentarios se avisa al jefe inmediato según el organigrama."
              >
                <select
                  className="form-select"
                  value={valores.first_comment_role}
                  onChange={cambiar("first_comment_role")}
                >
                  <option value="">Nadie más</option>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROL[r]}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <fieldset className="mt-3">
              <legend className="form-label gt-legend">
                Avisar de los registros retroactivos a
              </legend>
              <div className="gt-roles">
                {ROLES.map((r) => (
                  <label key={r} className="form-check">
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={valores.retroactive_notify_roles.includes(r)}
                      onChange={() =>
                        setValores((v) => ({
                          ...v,
                          retroactive_notify_roles:
                            v.retroactive_notify_roles.includes(r)
                              ? v.retroactive_notify_roles.filter(
                                  (x) => x !== r,
                                )
                              : [...v.retroactive_notify_roles, r],
                        }))
                      }
                    />
                    <span className="form-check-label">{ROL[r]}</span>
                  </label>
                ))}
              </div>
              {errores.retroactive_notify_roles && (
                <div className="mz-field-error">
                  {errores.retroactive_notify_roles}
                </div>
              )}
            </fieldset>
            <ErrorEnLinea mensaje={errorGuardar} className="mt-3" />
            <div className="mt-3">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={guardando}
              >
                {guardando ? "Guardando…" : "Guardar ajustes"}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

function EditorDeMotivo({ motivo, onCerrar, onGuardado }) {
  const [etiqueta, setEtiqueta] = useState(motivo?.label ?? "");
  const [descripcion, setDescripcion] = useState(motivo?.description ?? "");
  const [roles, setRoles] = useState(motivo?.assigned_roles ?? []);
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);
  const panel = useRef(null);

  async function enviar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    const e = {};
    if (!etiqueta.trim()) e.label = "Escriba el nombre del motivo.";
    if (!roles.length) e.assigned_roles = "Elija al menos un rol.";
    setErrores(e);
    setError(null);
    if (Object.keys(e).length) {
      enfocarPrimerError(panel.current);
      return;
    }
    enCurso.current = true;
    setGuardando(true);
    const cuerpo = {
      label: etiqueta.trim(),
      description: descripcion.trim() || null,
      assigned_roles: roles,
    };
    try {
      const guardado = motivo
        ? await tareasService.actualizarMotivo(motivo.id, cuerpo)
        : await tareasService.crearMotivo(cuerpo);
      onGuardado(guardado, motivo ? "Motivo actualizado." : "Motivo creado.");
    } catch (err) {
      const fallo = errorDeTareas(err, "No se pudo guardar el motivo.");
      setErrores(fallo.campos);
      setError(fallo.mensaje);
      setGuardando(false);
      enCurso.current = false;
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo={motivo ? "Editar motivo" : "Nuevo motivo"}
      subtitulo="Solo quien tiene alguno de los roles elegidos puede usarlo al registrar horas."
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar={motivo ? "Guardar cambios" : "Crear motivo"}
      isSaving={guardando}
    >
      <div ref={panel}>
        <LeyendaObligatorios />
        <Campo
          id="gt-motivo-nombre"
          etiqueta="Nombre"
          obligatorio
          error={errores.label}
          className="mt-2"
        >
          <input
            className="form-control"
            maxLength={255}
            value={etiqueta}
            onChange={(e) => setEtiqueta(e.target.value)}
          />
        </Campo>
        <Campo
          id="gt-motivo-descripcion"
          etiqueta="Descripción"
          error={errores.description}
          className="mt-3"
        >
          <textarea
            className="form-control"
            rows={2}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </Campo>
        <CasillasDeRoles
          id="gt-motivo-roles"
          etiqueta="Roles que lo usan"
          valor={roles}
          onCambio={setRoles}
          error={errores.assigned_roles}
        />
        <ErrorEnLinea mensaje={error} className="mt-3" />
      </div>
    </ModalDialog>
  );
}

function Motivos() {
  const { fijarMotivos } = useTareas();
  const { motivos, errorMotivos, recargarMotivos } = useMotivos();
  const [editando, setEditando] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [verArchivados, setVerArchivados] = useState(false);

  function reemplazar(nuevo) {
    fijarMotivos((lista) => {
      const actual = lista ?? [];
      return actual.some((m) => m.id === nuevo.id)
        ? actual.map((m) => (m.id === nuevo.id ? nuevo : m))
        : [...actual, nuevo];
    });
  }

  async function actualizar(motivo, cambios, mensaje) {
    try {
      reemplazar(await tareasService.actualizarMotivo(motivo.id, cambios));
      setAviso({ texto: mensaje });
    } catch (err) {
      setAviso({
        tono: "bad",
        texto: errorDeTareas(err, "No se pudo actualizar el motivo.").mensaje,
      });
    }
  }

  async function archivar(motivo) {
    const seguir = await confirmar({
      titulo: `¿Archivar el motivo «${motivo.label}»?`,
      mensaje:
        "Deja de ofrecerse al registrar horas y queda desactivado. Los registros que ya lo usan lo conservan. Puede restaurarlo desde «Archivados», pero seguirá inactivo hasta que lo active.",
      accion: "Archivar",
    });
    if (seguir)
      actualizar(
        motivo,
        { is_archived: true },
        `Motivo «${motivo.label}» archivado.`,
      );
  }

  const vigentes = (motivos ?? []).filter((m) => !m.is_archived);
  const archivados = (motivos ?? []).filter((m) => m.is_archived);

  return (
    <section className="mz-card" aria-labelledby="gt-motivos-titulo">
      <div className="mz-card-body gh-page">
        <div className="gh-barra">
          <h3 id="gt-motivos-titulo" className="h6 mb-0">
            Motivos de registro de horas
          </h3>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setEditando({})}
          >
            <Icon name="plus-lg" /> Nuevo motivo
          </button>
        </div>
        <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />
        <EstadoDeCarga
          cargando={motivos === null && !errorMotivos}
          error={errorMotivos}
          onReintentar={recargarMotivos}
          vacio={motivos !== null && vigentes.length === 0}
          textoVacio="Todavía no hay motivos. Sin motivos nadie puede registrar horas."
        />
        {vigentes.length > 0 && (
          <ul className="gh-switch-lista">
            {vigentes.map((m) => (
              <li key={m.id}>
                <div className="gt-min0">
                  <strong>{m.label}</strong>{" "}
                  {m.is_active ? (
                    <span className="mz-pill mz-pill--ok">
                      <Icon name="check-circle" /> Activo
                    </span>
                  ) : (
                    <span className="mz-pill mz-pill--neutral">
                      <Icon name="pause-circle" /> Inactivo
                    </span>
                  )}
                  {m.description && (
                    <div className="mz-small">{m.description}</div>
                  )}
                  <div className="mz-small mz-faint">
                    {(m.assigned_roles ?? []).map(rolLegible).join(", ") ||
                      "Sin roles"}
                  </div>
                </div>
                <MenuDeAcciones
                  etiqueta={`Más acciones del motivo «${m.label}»`}
                  acciones={[
                    {
                      texto: "Editar",
                      onClick: () => setEditando({ motivo: m }),
                    },
                    {
                      texto: m.is_active ? "Desactivar" : "Activar",
                      onClick: () =>
                        actualizar(
                          m,
                          { is_active: !m.is_active },
                          `Motivo «${m.label}» ${m.is_active ? "desactivado" : "activado"}.`,
                        ),
                    },
                    {
                      texto: "Archivar",
                      onClick: () => archivar(m),
                      peligro: true,
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        )}
        {archivados.length > 0 && (
          <div>
            <button
              type="button"
              className="gh-enlace"
              aria-expanded={verArchivados}
              onClick={() => setVerArchivados((v) => !v)}
            >
              {verArchivados ? "Ocultar" : "Ver"} archivados (
              {archivados.length})
            </button>
            {verArchivados && (
              <ul className="gh-switch-lista mt-2">
                {archivados.map((m) => (
                  <li key={m.id}>
                    <div className="gt-min0">
                      <strong>{m.label}</strong>
                      <div className="mz-small mz-faint">
                        Archivado{" "}
                        {m.archived_at ? `el ${fechaHora(m.archived_at)}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() =>
                        actualizar(
                          m,
                          { is_archived: false },
                          `Motivo «${m.label}» restaurado. Sigue inactivo hasta que lo active.`,
                        )
                      }
                    >
                      Restaurar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {editando && (
        <EditorDeMotivo
          motivo={editando.motivo}
          onCerrar={() => setEditando(null)}
          onGuardado={(m, mensaje) => {
            reemplazar(m);
            setEditando(null);
            setAviso({ texto: mensaje });
          }}
        />
      )}
    </section>
  );
}

function PantallaAjustes() {
  return (
    <div className="gh-page">
      <Encabezado
        titulo="Ajustes de tareas"
        descripcion="Los ajustes con vigencia del módulo y el catálogo de motivos para registrar horas."
      />
      <FormularioAjustes />
      <Motivos />
    </div>
  );
}
