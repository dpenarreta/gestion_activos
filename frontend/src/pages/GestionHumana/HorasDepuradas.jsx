/*
 * Horas depuradas: una copia INDEPENDIENTE del consolidado de Horas extras,
 * por mes calendario. El Jefe de Operaciones la ajusta (guardado automático);
 * el Administrador la consulta y la exporta. Nada de esta pantalla escribe en
 * lo que reportaron los supervisores: el servidor lo garantiza y la pantalla
 * solo lo refleja.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { errorDeNovedades, novedadesService } from "../../api/novedadesService";
import { confirmar } from "../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import {
  Aviso,
  HORAS_MIENTRAS_ESCRIBE,
  IndicadorDeGuardado,
  fecha,
  fechaHora,
  respaldo,
  useColaDeGuardado,
} from "./comunes";
import {
  BarraDeAlcance,
  ConAcceso,
  Encabezado,
  useNovedades,
} from "./ContextoNovedades";

const CAMPO = {
  overtime_hours: "# Horas extras",
  saturday_hours: "# Horas sábado",
  is_saturday: "Sábado",
  is_sunday: "Domingo",
  is_holiday: "Feriado",
  work_done: "Trabajo realizado",
  observations: "Observaciones",
  excluded: "Excluido",
};

const numero = (v) => Number(String(v ?? "").replace(",", ".") || 0);

export function HorasDepuradas() {
  return (
    <ConAcceso titulo="Horas depuradas">
      <PantallaDepuradas />
    </ConAcceso>
  );
}

function PantallaDepuradas() {
  const { me, mes } = useNovedades();
  if (!me.can_view_depuration) {
    return (
      <div className="gh-page">
        <Encabezado titulo="Horas depuradas" />
        <div className="mz-alert mz-alert--info" role="status">
          <Icon name="info-circle" />
          <span>
            Horas depuradas la trabaja el Jefe de Operaciones y la consulta el
            Administrador del módulo.
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="gh-page">
      <Encabezado
        titulo="Horas depuradas"
        descripcion="Copia independiente del consolidado de Horas extras: ajustarla no modifica lo reportado por los supervisores."
      />
      <BarraDeAlcance tipo="mes" todos={false} idBase="gh-dep" />
      {mes && <Base key={mes} periodo={mes} />}
    </div>
  );
}

function Base({ periodo }) {
  const { me, marcarPendientes } = useNovedades();
  const [estado, setEstado] = useState(null);
  const [filas, setFilas] = useState([]);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  const [creando, setCreando] = useState(false);
  const [historial, setHistorial] = useState(null);
  const [aviso, setAviso] = useState(null);
  const filasRef = useRef(filas);
  filasRef.current = filas;
  const almacen = useMemo(
    () => respaldo(`depuradas|${periodo}|${me.user?.id}`),
    [periodo, me.user?.id],
  );
  const editable = Boolean(estado?.can_edit && estado.exists);

  const cola = useColaDeGuardado(async ({ alEmpezar }) => {
    if (!editable) return null;
    const aEnviar = filasRef.current.filter((f) => f.pendiente && !f.error);
    if (!aEnviar.length) return null;
    alEmpezar();
    const revisiones = new Map(aEnviar.map((f) => [f.id, f.rev ?? 0]));
    let respuesta;
    try {
      respuesta = await novedadesService.guardarDepuradas(
        periodo,
        aEnviar.map((f) => ({
          client_key: String(f.id),
          id: f.id,
          version: f.version,
          ...f.current,
          overtime_hours: String(f.current.overtime_hours).replace(",", "."),
          saturday_hours: String(f.current.saturday_hours).replace(",", "."),
          excluded: f.excluded,
        })),
      );
    } catch (err) {
      return {
        fallo: errorDeNovedades(err, "No se pudieron guardar los ajustes."),
      };
    }
    const porClave = new Map(respuesta.rows.map((r) => [r.client_key, r]));
    const rechazadas = respuesta.rows.filter(
      (r) => r.status !== "updated" && r.status !== "unchanged",
    ).length;
    setFilas((previas) =>
      previas.map((f) => {
        const res = porClave.get(String(f.id));
        if (!res) return f;
        const misma = (f.rev ?? 0) === revisiones.get(f.id);
        if (res.status === "updated" || res.status === "unchanged") {
          const guardada = { ...f, version: res.version ?? f.version };
          return misma ? { ...guardada, pendiente: false } : guardada;
        }
        return misma
          ? {
              ...f,
              error:
                Object.values(res.errors ?? {}).join(" · ") ||
                "No se pudo guardar.",
            }
          : f;
      }),
    );
    return rechazadas
      ? {
          rechazadas: `${rechazadas} fila(s) no se guardaron: revise las marcadas.`,
        }
      : { enviadas: respuesta.rows.length };
  });

  const cargar = useCallback(async () => {
    setError(null);
    setEstado(null);
    try {
      const datos = await novedadesService.depuracion(periodo);
      setEstado(datos);
      if (!datos.exists) {
        setFilas([]);
        return;
      }
      const lista = await novedadesService.filasDepuradas(periodo);
      // Lo que quedó sin confirmar se reaplica sobre lo que devolvió el
      // servidor y se reenvía solo.
      const pendientes = new Map((almacen.leer() ?? []).map((p) => [p.id, p]));
      setFilas(
        lista.map((f) => {
          const local = pendientes.get(f.id);
          return local
            ? {
                ...f,
                current: { ...f.current, ...local.current },
                excluded: local.excluded,
                pendiente: true,
                rev: 1,
              }
            : f;
        }),
      );
      if (pendientes.size) {
        cola.setEstado("pending");
        cola.programar(300);
      }
    } catch (err) {
      setError(
        errorDeNovedades(err, "No se pudo cargar Horas depuradas.").mensaje,
      );
    }
    // `cola` es estable en lo que se usa aquí.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo, almacen]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const pendientes = filas.filter((f) => f.pendiente).length;
  useEffect(() => {
    if (!estado?.exists) return;
    const lista = filas.filter((f) => f.pendiente);
    if (lista.length)
      almacen.guardar(
        lista.map((f) => ({
          id: f.id,
          current: f.current,
          excluded: f.excluded,
        })),
      );
    else almacen.borrar();
    marcarPendientes(lista.length);
  }, [filas, estado, almacen, marcarPendientes]);
  useEffect(() => () => marcarPendientes(0), [marcarPendientes]);

  function editar(id, cambios) {
    setFilas((previas) =>
      previas.map((f) => {
        if (f.id !== id) return f;
        const siguiente =
          "excluded" in cambios
            ? { ...f, excluded: cambios.excluded }
            : { ...f, current: { ...f.current, ...cambios } };
        return {
          ...siguiente,
          pendiente: true,
          rev: (f.rev ?? 0) + 1,
          error: undefined,
        };
      }),
    );
    cola.programar();
  }

  async function crearBase() {
    const faltan =
      estado.source.supervisors_total - estado.source.supervisors_closed;
    const si = await confirmar({
      titulo: `¿Crear la base de Horas depuradas de ${estado.label}?`,
      mensaje:
        `Se copiarán ${estado.source.records} registro(s) del consolidado.` +
        (faltan
          ? ` Atención: ${faltan} de ${estado.source.supervisors_total} supervisores todavía no cerraron el mes; lo que registren después NO entrará en esta copia.`
          : ""),
      accion: "Crear la base",
      peligro: false,
    });
    if (!si) return;
    setCreando(true);
    try {
      const r = await novedadesService.crearDepuracion(periodo);
      setAviso({
        texto: r.created
          ? "Base de depuración creada."
          : "La base ya existía: se abrió la misma.",
        tono: "ok",
      });
      cargar();
    } catch (err) {
      setAviso({
        texto: errorDeNovedades(err, "No se pudo crear la base.").mensaje,
        tono: "bad",
      });
    } finally {
      setCreando(false);
    }
  }

  async function exportar() {
    // El archivo sale de lo YA guardado.
    if (pendientes) {
      setAviso({
        texto:
          "Hay cambios guardándose: exporte cuando el indicador diga «Guardado».",
        tono: "warn",
      });
      return;
    }
    try {
      await novedadesService.exportarDepuradas(periodo);
    } catch (err) {
      setAviso({
        texto: errorDeNovedades(err, "No se pudo exportar.").mensaje,
        tono: "bad",
      });
    }
  }

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return q
      ? filas.filter(
          (f) =>
            f.full_name.toLowerCase().includes(q) ||
            String(f.cedula).toLowerCase().includes(q),
        )
      : filas;
  }, [filas, busqueda]);

  if (error) return <EstadoDeCarga error={error} onReintentar={cargar} />;
  if (!estado) return <EstadoDeCarga cargando />;
  const dep = estado.depuration;

  return (
    <>
      <section className="mz-card" aria-label="Resumen de la base">
        <div className="mz-card-body">
          {dep ? (
            <p className="mb-2">
              Creada el {fechaHora(dep.created_at)} por {dep.created_by} con{" "}
              {dep.source_count} registro(s) del consolidado (
              {dep.supervisors_closed} de {dep.supervisors_total} supervisores
              habían cerrado). Horas originales: {dep.source_overtime_hours} h
              extra y {dep.source_saturday_hours} h de sábado. Depuradas:{" "}
              <strong>{dep.overtime_hours}</strong> h extra y{" "}
              <strong>{dep.saturday_hours}</strong> h de sábado · {dep.modified}{" "}
              ajustado(s) · {dep.excluded} excluido(s)
              {dep.last_change_at
                ? ` · Último cambio: ${fechaHora(dep.last_change_at)} por ${dep.last_change_by}`
                : ""}
              .
            </p>
          ) : (
            <p className="mb-2">
              Todavía no existe la base depurable de {estado.label}. Consolidado
              disponible: {estado.source.records} registro(s) (
              {estado.source.overtime_hours} h extra y{" "}
              {estado.source.saturday_hours} h de sábado;{" "}
              {estado.source.supervisors_closed} de{" "}
              {estado.source.supervisors_total} supervisores cerraron).
              {!estado.month_ended &&
                " El mes está en curso: la base se crea cuando termina."}
            </p>
          )}
          <div className="mz-actions">
            {estado.can_create && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={creando}
                onClick={crearBase}
              >
                <Icon name="plus-lg" />{" "}
                {creando ? "Creando…" : "Crear la base de depuración"}
              </button>
            )}
            {dep && (
              <>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={exportar}
                >
                  <Icon name="file-earmark-excel" /> Exportar a Excel
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => setHistorial({ fila: null })}
                >
                  <Icon name="clock-history" /> Historial de cambios
                </button>
                {!editable && (
                  <span className="mz-pill mz-pill--info">Solo consulta</span>
                )}
              </>
            )}
          </div>
        </div>
      </section>
      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />
      {editable && (
        <IndicadorDeGuardado
          estado={cola.estado}
          pendientes={pendientes}
          mensaje={cola.mensaje}
          onReintentar={cola.ahora}
        />
      )}
      {dep && (
        <>
          <div className="mz-filter-bar">
            <div className="mz-fb-search">
              <Icon name="search" />
              <input
                type="search"
                aria-label="Buscar por cédula o nombre"
                placeholder="Buscar cédula o nombre"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>
          </div>
          {filas.length === 0 ? (
            <EstadoDeCarga
              vacio
              textoVacio="La base de este mes no tiene registros."
            />
          ) : visibles.length === 0 ? (
            <EstadoDeCarga
              vacio
              hayFiltros
              onLimpiarFiltros={() => setBusqueda("")}
            />
          ) : (
            <div
              className="gh-grilla-wrap"
              role="region"
              aria-label={`Horas depuradas de ${estado.label}`}
              // Se desplaza con el teclado aunque todas sus celdas estén bloqueadas.
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
              tabIndex={0}
            >
              <table className="gh-grilla">
                <caption className="visually-hidden">
                  Horas depuradas de {estado.label}
                </caption>
                <thead>
                  <tr>
                    {[
                      "Fecha",
                      "Cédula",
                      "Colaborador",
                      "Supervisor",
                      "# Horas extras",
                      "# Horas sábado",
                      "Sábado",
                      "Domingo",
                      "Feriado",
                      "Trabajo realizado",
                      "Observaciones",
                      "Excluir",
                      "Diferencia (h)",
                      "Origen",
                    ].map((t) => (
                      <th key={t} scope="col">
                        {t}
                      </th>
                    ))}
                    <th scope="col">
                      <span className="visually-hidden">Historial</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f) => {
                    const etiqueta = `${f.full_name}, ${fecha(f.date)}`;
                    const cambio = (campo) =>
                      f.current[campo] !== f.original[campo];
                    const horas = (campo) => (
                      <td
                        className={`gh-celda gh-celda--horas ${f.error ? "gh-celda--error" : f.pendiente ? "gh-celda--pendiente" : ""}`}
                      >
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          aria-label={
                            f.error
                              ? `${CAMPO[campo]} de ${etiqueta}. ${f.error}`
                              : `${CAMPO[campo]} de ${etiqueta}`
                          }
                          aria-invalid={f.error ? true : undefined}
                          value={f.current[campo]}
                          disabled={!editable}
                          onChange={(e) =>
                            HORAS_MIENTRAS_ESCRIBE.test(e.target.value) &&
                            editar(f.id, { [campo]: e.target.value })
                          }
                          onBlur={() => f.pendiente && cola.programar(150)}
                        />
                        {cambio(campo) && (
                          <span className="d-block mz-small mz-faint text-end px-1">
                            orig. {f.original[campo]}
                          </span>
                        )}
                      </td>
                    );
                    const marca = (campo) => (
                      <td className="gh-celda">
                        <input
                          type="checkbox"
                          aria-label={`${CAMPO[campo]} de ${etiqueta}`}
                          checked={Boolean(f.current[campo])}
                          disabled={!editable}
                          onChange={(e) =>
                            editar(f.id, { [campo]: e.target.checked })
                          }
                        />
                      </td>
                    );
                    const texto = (campo) => (
                      <td className="gh-celda gh-celda--texto">
                        <input
                          type="text"
                          autoComplete="off"
                          maxLength={campo === "work_done" ? 500 : 1000}
                          aria-label={
                            f.error
                              ? `${CAMPO[campo]} de ${etiqueta}. ${f.error}`
                              : `${CAMPO[campo]} de ${etiqueta}`
                          }
                          aria-invalid={f.error ? true : undefined}
                          value={f.current[campo] ?? ""}
                          disabled={!editable}
                          onChange={(e) =>
                            editar(f.id, { [campo]: e.target.value })
                          }
                          onBlur={() => f.pendiente && cola.programar(150)}
                        />
                      </td>
                    );
                    const diferencia =
                      Math.round(
                        (numero(f.current.overtime_hours) +
                          numero(f.current.saturday_hours) -
                          numero(f.original.overtime_hours) -
                          numero(f.original.saturday_hours)) *
                          100,
                      ) / 100;
                    return (
                      <tr key={f.id} title={f.error || undefined}>
                        <td className="gh-texto">{fecha(f.date)}</td>
                        <td className="gh-texto gh-mono">{f.cedula}</td>
                        <td className="gh-texto">{f.full_name}</td>
                        <td className="gh-texto mz-faint">
                          {f.supervisor_name}
                        </td>
                        {horas("overtime_hours")}
                        {horas("saturday_hours")}
                        {marca("is_saturday")}
                        {marca("is_sunday")}
                        {marca("is_holiday")}
                        {texto("work_done")}
                        {texto("observations")}
                        <td className="gh-celda">
                          <input
                            type="checkbox"
                            aria-label={`Excluir ${etiqueta}`}
                            checked={f.excluded}
                            disabled={!editable}
                            onChange={(e) =>
                              editar(f.id, { excluded: e.target.checked })
                            }
                          />
                        </td>
                        <td className="gh-num">
                          {diferencia > 0 ? "+" : ""}
                          {diferencia}
                        </td>
                        <td className="gh-texto">
                          {f.source_state === "changed" && (
                            <span className="mz-pill mz-pill--warn">
                              Cambió después de copiar
                            </span>
                          )}
                          {f.source_state === "deleted" && (
                            <span className="mz-pill mz-pill--neutral">
                              Eliminado en el origen
                            </span>
                          )}
                          {f.error && (
                            <span className="mz-pill mz-pill--bad">
                              {f.error}
                            </span>
                          )}
                        </td>
                        <td className="gh-texto">
                          <button
                            type="button"
                            className="gh-enlace"
                            aria-label={`Historial de ${etiqueta}`}
                            onClick={() => setHistorial({ fila: f })}
                          >
                            Historial
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {historial && (
        <HistorialDeDepuracion
          periodo={periodo}
          fila={historial.fila}
          onCerrar={() => setHistorial(null)}
        />
      )}
    </>
  );
}

function HistorialDeDepuracion({ periodo, fila, onCerrar }) {
  const [cambios, setCambios] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let vigente = true;
    novedadesService
      .historialDepuracion(periodo, fila?.id)
      .then((datos) => vigente && setCambios(datos))
      .catch((err) => vigente && setError(errorDeNovedades(err).mensaje));
    return () => {
      vigente = false;
    };
  }, [periodo, fila]);
  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo={
        fila
          ? `Historial · ${fila.full_name} · ${fecha(fila.date)}`
          : "Historial de cambios"
      }
      onCerrar={onCerrar}
      anchoMaximo="720px"
    >
      <EstadoDeCarga
        cargando={cambios === null && !error}
        error={error}
        vacio={cambios?.length === 0}
        textoVacio="Sin cambios registrados."
      />
      {cambios?.length > 0 && (
        <ul className="mz-timeline">
          {cambios.map((c) => (
            <li key={c.id} className="mz-tl-item">
              <div className="mz-tl-what">
                {!fila && <>{c.label} · </>}
                {CAMPO[c.field] ?? c.field}: {c.old_value || "—"} →{" "}
                <strong>{c.new_value || "—"}</strong>{" "}
                <span className="mz-faint">
                  (original: {c.original_value || "—"})
                </span>
              </div>
              <div className="mz-tl-when">
                {fechaHora(c.created_at)} · {c.actor}
              </div>
              {c.reason && <div className="mz-tl-why">Motivo: {c.reason}</div>}
            </li>
          ))}
        </ul>
      )}
    </ModalDialog>
  );
}
