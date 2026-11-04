/*
 * Configuración del módulo (Administrador): permisos por rol operativo,
 * excepciones individuales, plazos de registro y de cierre, destinatarios de
 * los correos de ingreso y salida, y quién consulta Ingresos y Salidas.
 * Solo se ofrece como interruptor lo que la matriz de roles declara
 * configurable; las restricciones obligatorias no aparecen como opción. Todo
 * lo valida y audita el servidor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { errorDeNovedades, novedadesService } from "../../api/novedadesService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
import { confirmar } from "../../components/common/Confirmar/confirmar";
import {
  EstadoDeCarga,
  FilaDeEstado,
} from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import {
  PanelDePestana,
  Pestanas,
} from "../../components/common/Pestanas/Pestanas";
import { PERM } from "../../modulos/permisosGestionHumana";
import { Aviso, ErrorEnLinea, ROL_OPERATIVO, fechaHora } from "./comunes";
import { ConAcceso, Encabezado, useNovedades } from "./ContextoNovedades";

const ESTADO_PERMISO = {
  mandatory: ["Obligatorio", "mz-pill--ok"],
  configurable: ["Configurable", "mz-pill--info"],
  unavailable: ["No disponible", "mz-pill--neutral"],
};

export function ConfiguracionModulo() {
  return (
    <ConAcceso titulo="Configuración del módulo">
      <PantallaConfiguracion />
    </ConAcceso>
  );
}

function PantallaConfiguracion() {
  const { me, can } = useNovedades();
  const opciones = [
    can(PERM.permisos) && {
      id: "permisos",
      etiqueta: "Permisos",
      icono: "shield-check",
    },
    { id: "plazos", etiqueta: "Plazos", icono: "hourglass-split" },
    me.is_admin && { id: "correos", etiqueta: "Correos", icono: "envelope" },
    me.is_admin && {
      id: "movimientos",
      etiqueta: "Ingresos y salidas",
      icono: "arrow-left-right",
    },
  ].filter(Boolean);
  const [vista, setVista] = useState(opciones[0].id);

  return (
    <div className="gh-page">
      <Encabezado
        titulo="Configuración del módulo"
        descripcion="Permisos por rol y excepciones, plazos, destinatarios de correos y quién consulta Ingresos y Salidas."
      />
      <Pestanas
        etiqueta="Configuración del módulo"
        idBase="gh-conf"
        valor={vista}
        onCambio={setVista}
        opciones={opciones}
      />
      <PanelDePestana idBase="gh-conf" valor={vista}>
        {vista === "permisos" && <Permisos />}
        {vista === "plazos" && <Plazos />}
        {vista === "correos" && <Correos />}
        {vista === "movimientos" && <PermisosDeMovimientos />}
      </PanelDePestana>
    </div>
  );
}

/** Un motivo para un cambio de configuración (queda en el historial). */
function PedirMotivo({
  titulo,
  mensaje,
  obligatorio = false,
  textoConfirmar = "Confirmar",
  onCerrar,
  onConfirmar,
}) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(null);
  const [errorCampo, setErrorCampo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const panel = useRef(null);
  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo={titulo}
      onCerrar={onCerrar}
      textoConfirmar={textoConfirmar}
      isSaving={guardando}
      onSubmit={async (e) => {
        e.preventDefault();
        if (obligatorio && !motivo.trim()) {
          setErrorCampo("Escriba el motivo.");
          enfocarPrimerError(panel.current);
          return;
        }
        setGuardando(true);
        const fallo = await onConfirmar(motivo.trim());
        if (fallo) {
          setError(fallo);
          setGuardando(false);
        }
      }}
    >
      <div ref={panel}>
        <p>{mensaje}</p>
        <Campo
          id="gh-conf-motivo"
          etiqueta="Motivo"
          obligatorio={obligatorio}
          error={errorCampo}
          ayuda={
            obligatorio
              ? undefined
              : "Recomendado: queda en el historial de cambios de permisos."
          }
          className="mb-3"
        >
          <textarea
            className="form-control"
            rows={3}
            maxLength={500}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </Campo>
        <ErrorEnLinea mensaje={error} />
      </div>
    </ModalDialog>
  );
}

// --- Permisos por rol, excepciones y permisos efectivos ------------------

function Permisos() {
  const { me } = useNovedades();
  const [roles, setRoles] = useState(null);
  const [usuarios, setUsuarios] = useState([]);
  const [excepciones, setExcepciones] = useState([]);
  const [cambiosDePermisos, setCambiosDePermisos] = useState([]);
  const [error, setError] = useState(null);
  const [dialogo, setDialogo] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [usuarioEfectivo, setUsuarioEfectivo] = useState("");
  const [efectivos, setEfectivos] = useState(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [config, lista, exc, hist] = await Promise.all([
        novedadesService.permisosPorRol(),
        novedadesService.usuariosOperativos(),
        novedadesService.excepciones(),
        novedadesService
          .historial({ kind: "permissions", limit: 50 })
          .catch(() => ({ results: [] })),
      ]);
      setRoles(config.roles);
      setUsuarios(lista);
      setExcepciones(exc);
      setCambiosDePermisos(hist.results ?? []);
    } catch (err) {
      setRoles([]);
      setError(
        errorDeNovedades(err, "No se pudieron cargar los permisos del módulo.")
          .mensaje,
      );
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!usuarioEfectivo) {
      setEfectivos(null);
      return undefined;
    }
    let vigente = true;
    novedadesService
      .permisosEfectivos(usuarioEfectivo)
      .then((d) => vigente && setEfectivos(d))
      .catch(
        (err) =>
          vigente && setEfectivos({ error: errorDeNovedades(err).mensaje }),
      );
    return () => {
      vigente = false;
    };
  }, [usuarioEfectivo, excepciones, roles]);

  const etiquetas = useMemo(
    () =>
      Object.fromEntries(
        (roles ?? []).flatMap((r) =>
          r.permissions.map((p) => [p.codename, p.label]),
        ),
      ),
    [roles],
  );

  if (roles === null || error) {
    return (
      <EstadoDeCarga cargando={!error} error={error} onReintentar={cargar} />
    );
  }

  return (
    <div className="gh-page">
      <div className="mz-alert mz-alert--info" role="note">
        <Icon name="info-circle" />
        <span>
          Siempre obligatorias: cada supervisor solo ve y modifica su propio
          equipo; el Asistente de Operaciones no gestiona colaboradores ni
          cierra períodos; los períodos cerrados no admiten edición ordinaria;
          nadie se otorga permisos a sí mismo. Habilitar una facultad nunca
          amplía el ámbito de datos.
        </span>
      </div>
      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />
      {roles.map((r) => (
        <section
          key={r.role}
          className="mz-card"
          aria-labelledby={`gh-rol-${r.role}`}
        >
          <div className="mz-card-body">
            <div className="mz-row-between">
              <h3 id={`gh-rol-${r.role}`} className="h6 mb-0">
                {ROL_OPERATIVO[r.role] ?? r.role}
              </h3>
              <span className="mz-small mz-faint">
                {r.last_change
                  ? `Último cambio: ${r.last_change.by} · ${fechaHora(r.last_change.at)}`
                  : "Sin cambios desde la configuración inicial"}
              </span>
            </div>
            <ul className="gh-switch-lista">
              {r.permissions.map((p) => (
                <li key={p.codename}>
                  <div>
                    <div
                      className={
                        p.state === "unavailable" ? "mz-faint" : undefined
                      }
                    >
                      {p.label}
                    </div>
                    <span className={`mz-pill ${ESTADO_PERMISO[p.state][1]}`}>
                      {ESTADO_PERMISO[p.state][0]}
                    </span>
                  </div>
                  {p.state === "configurable" ? (
                    <div className="form-check form-switch m-0">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        role="switch"
                        id={`gh-rol-${r.role}-${p.codename}`}
                        checked={p.enabled}
                        disabled={me.role === r.role}
                        onChange={() =>
                          setDialogo({
                            tipo: "rol",
                            role: r.role,
                            codename: p.codename,
                            label: p.label,
                            enabled: !p.enabled,
                          })
                        }
                      />
                      <label
                        className="form-check-label visually-hidden"
                        htmlFor={`gh-rol-${r.role}-${p.codename}`}
                      >
                        {p.label} para {ROL_OPERATIVO[r.role] ?? r.role}
                      </label>
                    </div>
                  ) : (
                    <span className="mz-small mz-faint">
                      {p.enabled ? "Activo" : "—"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}

      <section className="mz-card" aria-labelledby="gh-excepciones">
        <div className="mz-card-body">
          <div className="mz-row-between mb-2">
            <h3 id="gh-excepciones" className="h6 mb-0">
              Excepciones individuales
            </h3>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!usuarios.length}
              onClick={() => setDialogo({ tipo: "excepcion" })}
            >
              <Icon name="plus-lg" /> Nueva excepción
            </button>
          </div>
          {excepciones.length === 0 ? (
            <p className="mz-faint mb-0">No hay excepciones individuales.</p>
          ) : (
            <ul className="gh-switch-lista">
              {excepciones.map((o) => (
                <li key={o.id}>
                  <div>
                    <strong>{o.user_name}</strong>{" "}
                    <span
                      className={`mz-pill ${o.effect === "GRANT" ? "mz-pill--ok" : "mz-pill--bad"}`}
                    >
                      {o.effect === "GRANT" ? "Concede" : "Restringe"}
                    </span>{" "}
                    {etiquetas[o.codename] ?? o.codename}
                    <div className="mz-small mz-faint">
                      Motivo: {o.reason} · {o.created_by} ·{" "}
                      {fechaHora(o.created_at)}
                      {o.revoked_at &&
                        ` · Revocada por ${o.revoked_by} (${fechaHora(o.revoked_at)})${o.revoke_reason ? `: ${o.revoke_reason}` : ""}`}
                    </div>
                  </div>
                  {!o.revoked_at && (
                    <button
                      type="button"
                      className="btn btn-outline-danger btn-sm"
                      aria-label={`Revocar la excepción de ${o.user_name}`}
                      onClick={() =>
                        setDialogo({ tipo: "revocar", excepcion: o })
                      }
                    >
                      Revocar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mz-card" aria-labelledby="gh-efectivos">
        <div className="mz-card-body">
          <h3 id="gh-efectivos" className="h6">
            Permisos efectivos por usuario
          </h3>
          <div className="mz-campo gh-ancho-medio">
            <label className="form-label" htmlFor="gh-efectivos-usuario">
              Usuario
            </label>
            <select
              id="gh-efectivos-usuario"
              className="form-select"
              value={usuarioEfectivo}
              onChange={(e) => setUsuarioEfectivo(e.target.value)}
            >
              <option value="">Seleccione un usuario…</option>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {ROL_OPERATIVO[u.role] ?? u.role}
                </option>
              ))}
            </select>
          </div>
          {efectivos?.error && (
            <ErrorEnLinea mensaje={efectivos.error} className="mt-2" />
          )}
          {efectivos?.effective && (
            <div className="mt-2" aria-live="polite">
              <p className="mz-small mb-1">
                Ámbito:{" "}
                {efectivos.effective.national_write
                  ? "nacional (escritura)"
                  : efectivos.effective.national_read
                    ? "nacional (solo lectura)"
                    : "solo su equipo"}
              </p>
              <div className="mz-pill-row">
                {efectivos.effective.permissions.length === 0 && (
                  <span className="mz-faint">Sin permisos en el módulo.</span>
                )}
                {efectivos.effective.permissions.map((p) => (
                  <span key={p} className="mz-pill mz-pill--info">
                    {etiquetas[p] ?? p}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="mz-card" aria-labelledby="gh-hist-permisos">
        <div className="mz-card-body">
          <h3 id="gh-hist-permisos" className="h6">
            Historial de cambios de permisos
          </h3>
          {cambiosDePermisos.length === 0 ? (
            <p className="mz-faint mb-0">Sin cambios registrados.</p>
          ) : (
            <ul className="mz-timeline">
              {cambiosDePermisos.map((h) => (
                <li key={h.id} className="mz-tl-item">
                  <div className="mz-tl-what">
                    <strong>{h.actor_name}</strong> ·{" "}
                    {ROL_OPERATIVO[h.target_label] ?? h.target_label} ·{" "}
                    {etiquetas[h.field] ?? h.field}:{" "}
                    {h.old_value ? `${h.old_value} → ` : ""}
                    {h.new_value}
                  </div>
                  <div className="mz-tl-when">{fechaHora(h.created_at)}</div>
                  {h.reason && (
                    <div className="mz-tl-why">Motivo: {h.reason}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {dialogo?.tipo === "rol" && (
        <PedirMotivo
          titulo={`${dialogo.enabled ? "Habilitar" : "Deshabilitar"} para ${ROL_OPERATIVO[dialogo.role] ?? dialogo.role}`}
          mensaje={`«${dialogo.label}». El cambio afecta a todos los usuarios con este rol y se aplica en su siguiente acción, sin cerrar sesión.`}
          textoConfirmar={dialogo.enabled ? "Habilitar" : "Deshabilitar"}
          onCerrar={() => setDialogo(null)}
          onConfirmar={async (reason) => {
            try {
              const datos = await novedadesService.cambiarPermisoDeRol({
                role: dialogo.role,
                codename: dialogo.codename,
                enabled: dialogo.enabled,
                reason,
              });
              setRoles(datos.roles);
              setDialogo(null);
              setAviso({ texto: "Permiso actualizado.", tono: "ok" });
              cargar();
              return null;
            } catch (err) {
              return errorDeNovedades(err).mensaje;
            }
          }}
        />
      )}
      {dialogo?.tipo === "revocar" && (
        <PedirMotivo
          titulo="Revocar excepción"
          mensaje={`${dialogo.excepcion.user_name}: ${etiquetas[dialogo.excepcion.codename] ?? dialogo.excepcion.codename}.`}
          textoConfirmar="Revocar"
          onCerrar={() => setDialogo(null)}
          onConfirmar={async (reason) => {
            try {
              await novedadesService.revocarExcepcion(
                dialogo.excepcion.id,
                reason,
              );
              setDialogo(null);
              setAviso({ texto: "Excepción revocada.", tono: "ok" });
              cargar();
              return null;
            } catch (err) {
              return errorDeNovedades(err).mensaje;
            }
          }}
        />
      )}
      {dialogo?.tipo === "excepcion" && (
        <NuevaExcepcion
          usuarios={usuarios}
          roles={roles}
          onCerrar={() => setDialogo(null)}
          onCreada={() => {
            setDialogo(null);
            setAviso({ texto: "Excepción registrada.", tono: "ok" });
            cargar();
          }}
        />
      )}
    </div>
  );
}

function NuevaExcepcion({ usuarios, roles, onCerrar, onCreada }) {
  const [usuarioId, setUsuarioId] = useState(String(usuarios[0]?.id ?? ""));
  const [codename, setCodename] = useState("");
  const [efecto, setEfecto] = useState("GRANT");
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const panel = useRef(null);
  const usuario = usuarios.find((u) => String(u.id) === usuarioId);
  const configurables =
    roles
      .find((r) => r.role === usuario?.role)
      ?.permissions.filter((p) => p.state === "configurable") ?? [];

  async function enviar(evento) {
    evento.preventDefault();
    const faltan = {};
    if (!usuarioId) faltan.usuario = "Elija al usuario.";
    if (!codename) faltan.facultad = "Elija la facultad.";
    if (!motivo.trim()) faltan.motivo = "Escriba el motivo.";
    setErrores(faltan);
    if (Object.keys(faltan).length) {
      enfocarPrimerError(panel.current);
      return;
    }
    setGuardando(true);
    try {
      await novedadesService.crearExcepcion({
        user_id: Number(usuarioId),
        codename,
        effect: efecto,
        reason: motivo.trim(),
      });
      onCreada();
    } catch (err) {
      setError(errorDeNovedades(err).mensaje);
      setGuardando(false);
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo="Nueva excepción individual"
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar="Guardar"
      isSaving={guardando}
    >
      <div ref={panel}>
        <LeyendaObligatorios />
        <Campo
          id="gh-exc-usuario"
          etiqueta="Usuario"
          obligatorio
          error={errores.usuario}
          className="mt-2 mb-3"
        >
          <select
            className="form-select"
            value={usuarioId}
            onChange={(e) => {
              setUsuarioId(e.target.value);
              setCodename("");
            }}
          >
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {ROL_OPERATIVO[u.role] ?? u.role}
              </option>
            ))}
          </select>
        </Campo>
        <Campo
          id="gh-exc-facultad"
          etiqueta="Facultad"
          obligatorio
          error={errores.facultad}
          ayuda="Solo las configurables para el rol del usuario."
          className="mb-3"
        >
          <select
            className="form-select"
            value={codename}
            onChange={(e) => setCodename(e.target.value)}
          >
            <option value="">Seleccione…</option>
            {configurables.map((p) => (
              <option key={p.codename} value={p.codename}>
                {p.label}
              </option>
            ))}
          </select>
        </Campo>
        <Campo
          id="gh-exc-efecto"
          etiqueta="Efecto"
          obligatorio
          className="mb-3"
        >
          <select
            className="form-select"
            value={efecto}
            onChange={(e) => setEfecto(e.target.value)}
          >
            <option value="GRANT">Conceder</option>
            <option value="DENY">Restringir</option>
          </select>
        </Campo>
        <Campo
          id="gh-exc-motivo"
          etiqueta="Motivo"
          obligatorio
          error={errores.motivo}
          className="mb-3"
        >
          <textarea
            className="form-control"
            rows={3}
            maxLength={500}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </Campo>
        <p className="mz-small mz-faint">
          La excepción no amplía el ámbito de datos del usuario y puede
          revocarse en cualquier momento.
        </p>
        <ErrorEnLinea mensaje={error} />
      </div>
    </ModalDialog>
  );
}

// --- Plazos ---------------------------------------------------------------

function Plazos() {
  const { me } = useNovedades();
  const [plazos, setPlazos] = useState(null);
  const [valores, setValores] = useState({});
  const [mes, setMes] = useState(null);
  const [valorMes, setValorMes] = useState("");
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [p, m] = await Promise.all([
        novedadesService.plazos(),
        novedadesService.plazoDeMes(),
      ]);
      setPlazos(p);
      setValores(
        Object.fromEntries(p.items.map((i) => [i.kind, String(i.hours)])),
      );
      setMes(m);
      setValorMes(String(m.grace_hours));
    } catch (err) {
      setError(
        errorDeNovedades(err, "No se pudieron cargar los plazos.").mensaje,
      );
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!plazos || !mes)
    return (
      <EstadoDeCarga cargando={!error} error={error} onReintentar={cargar} />
    );

  const fueraDeRango = (v, min, max) => {
    const n = Number(v);
    return !Number.isInteger(n) || n < min || n > max;
  };
  const cambiados = plazos.items.filter(
    (i) => valores[i.kind] !== String(i.hours),
  );
  const plazosInvalidos = plazos.items.some((i) =>
    fueraDeRango(valores[i.kind], plazos.min_hours, plazos.max_hours),
  );
  const mesInvalido = fueraDeRango(valorMes, mes.min_hours, mes.max_hours);

  async function guardarPlazos(evento) {
    evento.preventDefault();
    if (!cambiados.length || plazosInvalidos) return;
    setGuardando("plazos");
    try {
      const datos = await novedadesService.guardarPlazos(
        Object.fromEntries(
          cambiados.map((i) => [i.kind, Number(valores[i.kind])]),
        ),
      );
      setPlazos(datos);
      setValores(
        Object.fromEntries(datos.items.map((i) => [i.kind, String(i.hours)])),
      );
      setAviso({ texto: "Plazos de registro actualizados.", tono: "ok" });
    } catch (err) {
      setAviso({ texto: errorDeNovedades(err).mensaje, tono: "bad" });
    } finally {
      setGuardando(null);
    }
  }

  async function guardarMes(evento) {
    evento.preventDefault();
    if (mesInvalido || Number(valorMes) === mes.grace_hours) return;
    setGuardando("mes");
    try {
      const datos = await novedadesService.guardarPlazoDeMes(Number(valorMes));
      setMes(datos);
      setValorMes(String(datos.grace_hours));
      setAviso({
        texto: `Plazo de Horas extras: ${datos.grace_hours} horas laborables.`,
        tono: "ok",
      });
    } catch (err) {
      setAviso({ texto: errorDeNovedades(err).mensaje, tono: "bad" });
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="gh-page">
      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />
      <section className="mz-card" aria-labelledby="gh-plazos">
        <form className="mz-card-body" onSubmit={guardarPlazos} noValidate>
          <h3 id="gh-plazos" className="h6">
            Plazo de registro por fecha de trabajo
          </h3>
          <p className="mz-small">
            {plazos.mode} Vencido el plazo, el Supervisor ya no modifica esa
            fecha; el Asistente de Operaciones y el Administrador sí (queda
            auditado). Nadie registra fechas futuras. {plazos.policy}
          </p>
          <div className="mz-field-grid">
            {plazos.items.map((i) => (
              <Campo
                key={i.kind}
                id={`gh-plazo-${i.kind}`}
                etiqueta={`${i.label} (horas laborables)`}
                error={
                  fueraDeRango(
                    valores[i.kind],
                    plazos.min_hours,
                    plazos.max_hours,
                  )
                    ? `Un número entero entre ${plazos.min_hours} y ${plazos.max_hours}.`
                    : undefined
                }
                ayuda={
                  i.configured
                    ? `Última modificación: ${fechaHora(i.updated_at)} por ${i.updated_by}`
                    : "Valor inicial (sin modificaciones)"
                }
              >
                <input
                  type="number"
                  className="form-control"
                  min={plazos.min_hours}
                  max={plazos.max_hours}
                  step={1}
                  disabled={!plazos.can_edit}
                  value={valores[i.kind] ?? ""}
                  onChange={(e) =>
                    setValores((v) => ({ ...v, [i.kind]: e.target.value }))
                  }
                />
              </Campo>
            ))}
          </div>
          {plazos.can_edit ? (
            <button
              type="submit"
              className="btn btn-primary btn-sm mt-3"
              disabled={
                !cambiados.length || plazosInvalidos || guardando === "plazos"
              }
            >
              {guardando === "plazos" ? "Guardando…" : "Guardar plazos"}
            </button>
          ) : (
            <p className="mz-small mz-faint mt-2 mb-0">
              Solo el Administrador puede modificar estos plazos.
            </p>
          )}
        </form>
      </section>
      <section className="mz-card" aria-labelledby="gh-plazo-mes">
        <form className="mz-card-body" onSubmit={guardarMes} noValidate>
          <h3 id="gh-plazo-mes" className="h6">
            Plazo de cierre de Horas extras
          </h3>
          <p className="mz-small">
            Horas extras va por mes calendario. Al empezar el mes siguiente, el
            anterior se puede completar y corregir durante este plazo, contado
            en días hábiles (lunes a viernes sin feriados, 24 horas cada uno,
            hora de Ecuador). No hay cierre automático: al vencer solo se avisa,
            y el mes se cierra con «Cerrar mes». Un cambio aplica a los plazos
            que todavía no empezaron.
          </p>
          <Campo
            id="gh-plazo-mes-horas"
            etiqueta="Horas laborables"
            error={
              mesInvalido
                ? `Un número entero entre ${mes.min_hours} y ${mes.max_hours}.`
                : undefined
            }
            ayuda={`Entre ${mes.min_hours} y ${mes.max_hours}.`}
          >
            <input
              type="number"
              className="form-control gh-ancho-corto"
              min={mes.min_hours}
              max={mes.max_hours}
              step={1}
              disabled={!me.national_write}
              value={valorMes}
              onChange={(e) => setValorMes(e.target.value)}
            />
          </Campo>
          {me.national_write && (
            <button
              type="submit"
              className="btn btn-primary btn-sm mt-3"
              disabled={
                mesInvalido ||
                Number(valorMes) === mes.grace_hours ||
                guardando === "mes"
              }
            >
              {guardando === "mes" ? "Guardando…" : "Guardar"}
            </button>
          )}
        </form>
      </section>
    </div>
  );
}

// --- Correos de ingreso y salida -------------------------------------------

const LISTA = {
  ENTRY: "Ingresos de colaboradores",
  EXIT: "Salidas y suspensiones",
};
const ESTADO_CORREO = {
  WAITING: "mz-pill--neutral",
  PENDING: "mz-pill--warn",
  SENDING: "mz-pill--info",
  SENT: "mz-pill--ok",
  FAILED: "mz-pill--bad",
};

function Correos() {
  const [config, setConfig] = useState(null);
  const [envios, setEnvios] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [nuevo, setNuevo] = useState({ kind: "ENTRY", email: "", area: "" });
  const [errores, setErrores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [ocupado, setOcupado] = useState(null);
  const formulario = useRef(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [c, e] = await Promise.all([
        novedadesService.destinatarios(),
        novedadesService.correosEnviados(),
      ]);
      setConfig(c);
      setEnvios(e);
    } catch (err) {
      setError(
        errorDeNovedades(err, "No se pudieron cargar los correos del módulo.")
          .mensaje,
      );
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function agregar(evento) {
    evento.preventDefault();
    if (!nuevo.email.trim()) {
      setErrores({ email: "Escriba la dirección de correo." });
      enfocarPrimerError(formulario.current);
      return;
    }
    setGuardando(true);
    setErrores({});
    try {
      await novedadesService.crearDestinatario({
        ...nuevo,
        email: nuevo.email.trim(),
      });
      setNuevo((n) => ({ ...n, email: "" }));
      setAviso({
        texto: `${nuevo.email.trim()} agregado a la lista de ${LISTA[nuevo.kind].toLowerCase()}.`,
        tono: "ok",
      });
      cargar();
    } catch (err) {
      const fallo = errorDeNovedades(err);
      setErrores({ email: fallo.mensaje });
      enfocarPrimerError(formulario.current);
    } finally {
      setGuardando(false);
    }
  }

  async function alternar(r) {
    if (r.is_active) {
      const si = await confirmar({
        titulo: `¿Desactivar ${r.email}?`,
        mensaje: `Deja de recibir los correos de ${LISTA[r.kind].toLowerCase()}. Se puede volver a activar.`,
        accion: "Desactivar",
      });
      if (!si) return;
    }
    setOcupado(r.id);
    try {
      await novedadesService.editarDestinatario(r.id, {
        is_active: !r.is_active,
      });
      setAviso({
        texto: `${r.email} ${r.is_active ? "desactivado" : "activado"}.`,
        tono: "ok",
      });
      cargar();
    } catch (err) {
      setAviso({ texto: errorDeNovedades(err).mensaje, tono: "bad" });
    } finally {
      setOcupado(null);
    }
  }

  async function reintentar(e) {
    setOcupado(`envio-${e.kind}-${e.id}`);
    try {
      const r = await novedadesService.reintentarCorreo(e.kind, e.id);
      setAviso({
        texto: `Correo de ${e.collaborator.full_name}: ${r.status_label}.`,
        tono: r.status === "SENT" ? "ok" : "warn",
      });
      cargar();
    } catch (err) {
      setAviso({ texto: errorDeNovedades(err).mensaje, tono: "bad" });
    } finally {
      setOcupado(null);
    }
  }

  if (!config)
    return (
      <EstadoDeCarga cargando={!error} error={error} onReintentar={cargar} />
    );

  return (
    <div className="gh-page">
      {config.delivery === "console" && (
        <div className="mz-alert mz-alert--warn" role="status">
          <Icon name="exclamation-triangle" />
          <span>
            El correo del sistema está en modo de prueba: los mensajes no salen
            a los destinatarios.
          </span>
        </div>
      )}
      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />
      <section className="mz-card" aria-labelledby="gh-dest">
        <div className="mz-card-body">
          <h3 id="gh-dest" className="h6">
            Destinatarios de los correos
          </h3>
          <p className="mz-small">
            Cada lista es independiente: una dirección de la lista de ingresos
            no recibe salidas salvo que también esté en esa lista. Los correos
            nunca llevan la cédula.
          </p>
          <form
            ref={formulario}
            className="mz-filter-bar"
            onSubmit={agregar}
            noValidate
            aria-label="Agregar destinatario"
          >
            <Campo id="gh-dest-lista" etiqueta="Lista">
              <select
                className="form-select form-select-sm"
                value={nuevo.kind}
                onChange={(e) => setNuevo({ ...nuevo, kind: e.target.value })}
              >
                {Object.entries(LISTA).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo
              id="gh-dest-correo"
              etiqueta="Correo"
              obligatorio
              error={errores.email}
            >
              <input
                type="email"
                className="form-control form-control-sm"
                autoComplete="off"
                value={nuevo.email}
                onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })}
              />
            </Campo>
            <Campo id="gh-dest-area" etiqueta="Área">
              <select
                className="form-select form-select-sm"
                value={nuevo.area}
                onChange={(e) => setNuevo({ ...nuevo, area: e.target.value })}
              >
                <option value="">Sin área</option>
                {config.areas.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Campo>
            <button
              type="submit"
              className="btn btn-primary btn-sm align-self-end"
              disabled={guardando}
            >
              {guardando ? "Guardando…" : "Agregar"}
            </button>
          </form>
          {Object.entries(LISTA).map(([tipo, titulo]) => {
            const lista = config.recipients.filter((r) => r.kind === tipo);
            return (
              <div key={tipo} className="mt-3">
                <h4 className="h6">
                  {titulo}{" "}
                  <span className="mz-small mz-faint">
                    ({config.active_count?.[tipo] ?? 0} activos)
                  </span>
                </h4>
                {lista.length === 0 ? (
                  <p className="mz-faint mb-0">
                    Sin destinatarios: nadie recibe estos correos.
                  </p>
                ) : (
                  <ul className="gh-switch-lista">
                    {lista.map((r) => (
                      <li key={r.id}>
                        <div>
                          <span
                            className={r.is_active ? undefined : "mz-faint"}
                          >
                            {r.email}
                          </span>
                          {r.area_label && (
                            <span className="mz-small mz-faint">
                              {" "}
                              · {r.area_label}
                            </span>
                          )}
                          <div className="mz-small mz-faint">
                            {r.is_active ? "Activo" : "Inactivo"} ·{" "}
                            {r.updated_by} · {fechaHora(r.updated_at)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className={`btn btn-sm ${r.is_active ? "btn-outline-danger" : "btn-outline-primary"}`}
                          disabled={ocupado === r.id}
                          onClick={() => alternar(r)}
                        >
                          {r.is_active ? "Desactivar" : "Activar"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>
      <section className="mz-card" aria-labelledby="gh-envios">
        <div className="mz-card-body">
          <h3 id="gh-envios" className="h6">
            Últimos correos
          </h3>
          <div className="mz-table-wrap">
            <table className="mz-table">
              <caption className="visually-hidden">
                Últimos correos de ingreso y salida
              </caption>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Colaborador</th>
                  <th scope="col">Supervisor</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Intentos</th>
                  <th scope="col">
                    <span className="visually-hidden">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(envios ?? []).map((e) => (
                  <tr key={`${e.kind}-${e.id}`}>
                    <td>{fechaHora(e.changed_at)}</td>
                    <td>
                      {e.kind === "ENTRY"
                        ? "Ingreso"
                        : e.new_status === "SUSPENDED"
                          ? "Suspensión"
                          : "Salida"}
                    </td>
                    <td>{e.collaborator.full_name}</td>
                    <td>{e.supervisor}</td>
                    <td>
                      <span
                        className={`mz-pill ${ESTADO_CORREO[e.status] ?? "mz-pill--neutral"}`}
                      >
                        {e.status_label}
                      </span>
                      {e.last_error && (
                        <div className="mz-small mz-faint">{e.last_error}</div>
                      )}
                    </td>
                    <td className="num">{e.attempts}</td>
                    <td className="num">
                      {(e.status === "FAILED" || e.status === "PENDING") && (
                        <button
                          type="button"
                          className="btn btn-outline-secondary btn-sm"
                          disabled={ocupado === `envio-${e.kind}-${e.id}`}
                          aria-label={`Reintentar el correo de ${e.collaborator.full_name}`}
                          onClick={() => reintentar(e)}
                        >
                          Reintentar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <FilaDeEstado
                  columnas={7}
                  vacio={envios?.length === 0}
                  textoVacio="Todavía no se ha enviado ningún correo."
                />
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

// --- Quién consulta Ingresos y Salidas ---------------------------------------

function PermisosDeMovimientos() {
  const [busqueda, setBusqueda] = useState("");
  const [usuarios, setUsuarios] = useState(null);
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      setUsuarios(
        await novedadesService.permisosDeMovimientos(busqueda.trim()),
      );
    } catch (err) {
      setUsuarios([]);
      setError(
        errorDeNovedades(err, "No se pudieron cargar los usuarios.").mensaje,
      );
    }
  }, [busqueda]);

  useEffect(() => {
    const reloj = setTimeout(cargar, 300);
    return () => clearTimeout(reloj);
  }, [cargar]);

  async function cambiar(u, tipo, valor) {
    setOcupado(`${u.id}-${tipo}`);
    try {
      const actualizado = await novedadesService.cambiarPermisoDeMovimientos(
        u.id,
        { [tipo]: valor },
      );
      setUsuarios((lista) =>
        lista.map((x) => (x.id === u.id ? actualizado : x)),
      );
      setAviso({
        texto: `${u.name}: ${tipo === "entries" ? "Ingresos" : "Salidas"} ${valor ? "habilitado" : "retirado"}.`,
        tono: "ok",
      });
    } catch (err) {
      setAviso({ texto: errorDeNovedades(err).mensaje, tono: "bad" });
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="gh-page">
      <p className="mz-small mb-0">
        Cada pestaña es un permiso individual e independiente del acceso al
        resto del módulo. Lo concedido por el rol se muestra aparte y se cambia
        desde los roles.
      </p>
      <div className="mz-filter-bar">
        <div className="mz-fb-search">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Buscar usuario por nombre o correo"
            placeholder="Buscar usuario"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
      </div>
      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />
      <div className="mz-table-wrap">
        <table className="mz-table">
          <caption className="visually-hidden">
            Permisos de Ingresos y Salidas por usuario
          </caption>
          <thead>
            <tr>
              <th scope="col">Usuario</th>
              <th scope="col">Rol</th>
              <th scope="col">Ingresos</th>
              <th scope="col">Salidas</th>
            </tr>
          </thead>
          <tbody>
            {(usuarios ?? []).map((u) => (
              <tr key={u.id}>
                <td>
                  {u.name}
                  <div className="mz-small mz-faint">{u.email}</div>
                </td>
                <td className="mz-faint">{ROL_OPERATIVO[u.role] ?? u.role}</td>
                {["entries", "exits"].map((tipo) => (
                  <td key={tipo}>
                    <div className="form-check form-switch m-0">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        role="switch"
                        id={`gh-mov-${u.id}-${tipo}`}
                        checked={u[tipo].direct}
                        disabled={ocupado === `${u.id}-${tipo}`}
                        onChange={(e) => cambiar(u, tipo, e.target.checked)}
                      />
                      <label
                        className="form-check-label"
                        htmlFor={`gh-mov-${u.id}-${tipo}`}
                      >
                        <span className="visually-hidden">
                          {tipo === "entries" ? "Ingresos" : "Salidas"} para{" "}
                          {u.name}
                        </span>
                        {u[tipo].by_role && (
                          <span className="mz-small mz-faint">por su rol</span>
                        )}
                      </label>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
            <FilaDeEstado
              columnas={4}
              cargando={usuarios === null && !error}
              error={error}
              onReintentar={cargar}
              vacio={usuarios?.length === 0}
              textoVacio="No hay usuarios en esta empresa."
              hayFiltros={Boolean(busqueda.trim())}
              onLimpiarFiltros={() => setBusqueda("")}
            />
          </tbody>
        </table>
      </div>
    </div>
  );
}
