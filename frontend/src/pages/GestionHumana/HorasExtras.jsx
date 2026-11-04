/*
 * Horas extras, por mes calendario (independiente del corte 23 → 22 de Días
 * laborados). Arriba, el estado del mes que calcula el servidor (en curso, en
 * plazo, vencido, cerrado) y el botón «Cerrar mes»; debajo, la captura masiva
 * (vía principal de registro) y la consulta de registros con sus
 * indicadores y la exportación a Excel.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { errorDeNovedades, novedadesService } from "../../api/novedadesService";
import {
  Campo,
  LeyendaObligatorios,
  enfocarPrimerError,
} from "../../components/common/Campo/Campo";
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
import { useVistaDeTarjetas } from "../../hooks/useMediaQuery";
import { PERM } from "../../modulos/permisosGestionHumana";
import { CapturaHorasExtras } from "./CapturaHorasExtras";
import {
  Aviso,
  ESTADO_MES,
  ErrorEnLinea,
  TONO_MES,
  diaDeSemana,
  fecha,
  fechaHora,
  tiempoRestante,
} from "./comunes";
import {
  BarraDeAlcance,
  ConAcceso,
  Encabezado,
  useNovedades,
} from "./ContextoNovedades";
import { Correccion, EliminarHorasExtras } from "./Dialogos";

export function HorasExtras() {
  return (
    <ConAcceso titulo="Horas extras">
      <PantallaHoras />
    </ConAcceso>
  );
}

function PantallaHoras() {
  const { can, meses, mes, supervisorId, errorMeses, mesesCargados } =
    useNovedades();
  // El Asistente también captura y corrige fechas pasadas; el servidor
  // revalida el plazo, el equipo y el cierre.
  const captura = can(PERM.registrar);
  const [vista, setVista] = useState(captura ? "captura" : "consulta");
  const elegido = meses.find((m) => m.code === mes);

  return (
    <div className="gh-page">
      <Encabezado
        titulo="Horas extras"
        descripcion="Horas extras y de sábado por mes calendario. Registrar una novedad no implica su aprobación para pago."
      />
      <BarraDeAlcance tipo="mes" idBase="gh-horas" />
      {!elegido ? (
        // El error (con «Reintentar») lo muestra la barra de arriba.
        errorMeses ? null : mesesCargados ? (
          <EstadoDeCarga
            vacio
            textoVacio="No hay meses de horas extras disponibles para este equipo."
          />
        ) : (
          <EstadoDeCarga cargando />
        )
      ) : (
        <>
          <EstadoDelMes
            key={`${elegido.code}-${elegido.status}`}
            mesInfo={elegido}
            supervisorId={supervisorId}
          />
          {captura && (
            <Pestanas
              etiqueta="Horas extras"
              idBase="gh-horas-vista"
              valor={vista}
              onCambio={setVista}
              opciones={[
                { id: "captura", etiqueta: "Captura masiva", icono: "table" },
                {
                  id: "consulta",
                  etiqueta: "Consulta de registros",
                  icono: "search",
                },
              ]}
            />
          )}
          <PanelDePestana
            idBase="gh-horas-vista"
            valor={vista}
            sinPestanas={!captura}
          >
            {vista === "captura" && captura ? (
              <CapturaHorasExtras
                key={`${elegido.code}|${supervisorId ?? "todos"}`}
                mes={elegido}
                supervisorId={supervisorId}
              />
            ) : (
              <Consulta
                key={`${elegido.code}|${supervisorId ?? "todos"}`}
                mesInfo={elegido}
              />
            )}
          </PanelDePestana>
        </>
      )}
    </div>
  );
}

/**
 * El estado del mes. Todo lo que muestra (estado, fecha límite, tiempo
 * restante) lo calcula el servidor; la pantalla no recalcula el plazo ni
 * pregunta sola: el estado se renueva al cambiar de filtro o al cerrar.
 * «Vencido» no bloquea; solo «Cerrado» deja el mes en solo lectura.
 */
function EstadoDelMes({ mesInfo, supervisorId }) {
  const { me, can, recargarMeses } = useNovedades();
  const [cerrando, setCerrando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const puedeCerrar =
    can(PERM.cerrar) &&
    !me.is_assistant &&
    supervisorId !== null &&
    (mesInfo.status === "GRACE" || mesInfo.status === "OVERDUE");
  const nacional =
    supervisorId === null && mesInfo.supervisors_total !== undefined;
  const tono =
    mesInfo.status === "OVERDUE"
      ? "bad"
      : mesInfo.status === "GRACE"
        ? "warn"
        : "info";

  return (
    <>
      <section
        className={`mz-alert mz-alert--${tono}`}
        aria-label="Estado del mes de horas extras"
      >
        <Icon name={mesInfo.status === "CLOSED" ? "lock" : "calendar-event"} />
        <div className="flex-grow-1">
          <p className="mb-1">
            <strong>
              Horas extras de {mesInfo.label}:{" "}
              <span className={`mz-pill ${TONO_MES[mesInfo.status]}`}>
                {ESTADO_MES[mesInfo.status]}
              </span>
            </strong>
            {nacional &&
              ` · ${mesInfo.supervisors_closed} de ${mesInfo.supervisors_total} supervisores cerraron`}
          </p>
          {mesInfo.status === "OPEN" && (
            <p className="mb-0">
              Mes en curso. Al terminar, queda un plazo de {mesInfo.grace_hours}{" "}
              horas laborables para completar y corregir: hasta el{" "}
              <strong>{mesInfo.deadline_label}</strong>.
            </p>
          )}
          {mesInfo.status === "GRACE" && (
            <p className="mb-0">
              {mesInfo.closing_soon ? "Plazo próximo a vencer. " : ""}
              Se puede completar y corregir hasta el{" "}
              <strong>{mesInfo.deadline_label}</strong> (quedaban{" "}
              {tiempoRestante(mesInfo.remaining_seconds)} al abrir esta
              pantalla). El mes actual se registra aparte, al mismo tiempo.
            </p>
          )}
          {mesInfo.status === "OVERDUE" && (
            <p className="mb-0">
              El plazo venció el <strong>{mesInfo.deadline_label}</strong> y el
              mes sigue sin cerrar. Todavía se puede editar hasta que el
              supervisor o el Administrador pulse «Cerrar mes».
            </p>
          )}
          {mesInfo.status === "CLOSED" && (
            <p className="mb-0">
              Solo lectura
              {mesInfo.closed_by ? `: cerrado por ${mesInfo.closed_by}` : ""}
              {mesInfo.closed_at ? ` el ${fechaHora(mesInfo.closed_at)}` : ""}.
              Los cambios requieren una corrección autorizada del Administrador.
              La consulta y la exportación siguen disponibles.
            </p>
          )}
        </div>
        {puedeCerrar && (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => setCerrando(true)}
          >
            <Icon name="lock" /> Cerrar mes
          </button>
        )}
      </section>
      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />
      {cerrando && (
        <CerrarMes
          mesInfo={mesInfo}
          supervisorId={supervisorId}
          onCerrar={() => setCerrando(false)}
          onHecho={(texto) => {
            setCerrando(false);
            setAviso({ texto, tono: "ok" });
            recargarMeses();
          }}
        />
      )}
    </>
  );
}

/** Cerrar el mes de Horas extras de un equipo, con la revisión previa (que
 * solo informa: no bloquea, no corrige ni elimina nada). */
function CerrarMes({ mesInfo, supervisorId, onCerrar, onHecho }) {
  const [revision, setRevision] = useState(null);
  const [errorRevision, setErrorRevision] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);

  useEffect(() => {
    let vigente = true;
    novedadesService
      .revisionAntesDeCerrarMes(mesInfo.code, supervisorId)
      .then((datos) => vigente && setRevision(datos))
      .catch(
        (err) => vigente && setErrorRevision(errorDeNovedades(err).mensaje),
      );
    return () => {
      vigente = false;
    };
  }, [mesInfo.code, supervisorId]);

  async function cerrar(evento) {
    evento.preventDefault();
    if (enCurso.current) return;
    enCurso.current = true;
    setGuardando(true);
    setError(null);
    try {
      const r = await novedadesService.cerrarMes(mesInfo.code, supervisorId);
      onHecho(
        r.already_closed
          ? `${mesInfo.label} ya estaba cerrado.`
          : `Horas extras de ${mesInfo.label} cerrado.`,
      );
    } catch (err) {
      setError(errorDeNovedades(err, "No se pudo cerrar el mes.").mensaje);
      setGuardando(false);
      enCurso.current = false;
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo={`Cerrar Horas extras de ${mesInfo.label}`}
      onCerrar={onCerrar}
      onSubmit={cerrar}
      textoConfirmar="Cerrar mes"
      variante="danger"
      isSaving={guardando}
      // Se cierra después de ver la revisión previa, no antes.
      puedeConfirmar={revision !== null}
    >
      <p>
        Al cerrar, el mes queda en <strong>solo lectura</strong> para este
        equipo: no se podrán crear, editar, eliminar ni importar registros de{" "}
        {mesInfo.label}. Después, solo el Administrador puede corregir con
        motivo.
      </p>
      <p className="mz-small mz-faint">
        Días laborados (corte del 23 al 22) se cierra aparte y no cambia.
      </p>
      <div className="gh-recuadro" aria-live="polite">
        <p className="mb-1">
          <strong>Revisión previa al cierre</strong>
        </p>
        {errorRevision ? (
          <p className="mz-small mb-0">
            {errorRevision} Sin la revisión previa no se puede cerrar: cierre
            esta ventana e intente de nuevo.
          </p>
        ) : revision === null ? (
          <p className="mz-small mz-faint mb-0">Revisando los registros…</p>
        ) : revision.issues.length === 0 ? (
          <p className="mz-small mb-0">
            {revision.records} registro(s) revisados: sin problemas detectados.
          </p>
        ) : (
          <>
            <p className="mz-small">
              {revision.records} registro(s) revisados · {revision.errors} con
              error · {revision.warnings} aviso(s). Revíselos antes de cerrar.
            </p>
            <ul className="gh-lista-errores">
              {revision.issues.map((i, n) => (
                <li key={n}>
                  <strong>{i.severity === "error" ? "Error" : "Aviso"}:</strong>{" "}
                  {i.label} — {i.message}{" "}
                  <span className="mz-faint">{i.fix}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <ErrorEnLinea mensaje={error} className="mt-3" />
    </ModalDialog>
  );
}

const FILTROS_VACIOS = {
  date_from: "",
  date_to: "",
  jornada: "",
  cedula: "",
  name: "",
  regional: "",
  area: "",
  cargo: "",
};
const PAGINA = 200;
const si = (v) => (v ? "Sí" : "No");

/** Consulta de registros del mes con indicadores, filtros y exportación. */
function Consulta({ mesInfo }) {
  const { me, can, supervisorId } = useNovedades();
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [aplicados, setAplicados] = useState(FILTROS_VACIOS);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [desde, setDesde] = useState(0);
  const [detalle, setDetalle] = useState(null);
  const [dialogo, setDialogo] = useState(null);
  const [aviso, setAviso] = useState(null);
  const enTarjetas = useVistaDeTarjetas();

  const consulta = {
    period: mesInfo.code,
    supervisor: supervisorId ?? undefined,
    ...aplicados,
  };

  const cargar = useCallback(async () => {
    setError(null);
    setDatos(null);
    try {
      setDatos(
        await novedadesService.horasExtras({
          period: mesInfo.code,
          supervisor: supervisorId ?? undefined,
          ...aplicados,
          offset: desde,
          limit: PAGINA,
        }),
      );
    } catch (err) {
      setError(
        errorDeNovedades(err, "No se pudieron cargar las horas extras.")
          .mensaje,
      );
    }
  }, [mesInfo.code, supervisorId, aplicados, desde]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const hayFiltros = Object.values(aplicados).some(Boolean);
  const limpiar = () => {
    setFiltros(FILTROS_VACIOS);
    setAplicados(FILTROS_VACIOS);
    setDesde(0);
  };
  const registros = datos?.records ?? [];
  const ind = datos?.indicators;
  const puedeEscribir = can(PERM.registrar);
  const abierto = mesInfo.status !== "CLOSED" && mesInfo.status !== "FUTURE";
  const estadoDeCarga = {
    cargando: datos === null && !error,
    error,
    onReintentar: cargar,
    vacio: datos !== null && registros.length === 0,
    textoVacio: "No hay horas extras registradas en este mes.",
    hayFiltros,
    onLimpiarFiltros: limpiar,
  };

  async function exportar() {
    try {
      await novedadesService.exportarHorasExtras(consulta);
    } catch (err) {
      setAviso({
        texto: errorDeNovedades(err, "No se pudo exportar.").mensaje,
        tono: "bad",
      });
    }
  }

  function terminar(texto, tono = "ok") {
    setDialogo(null);
    if (texto) setAviso({ texto, tono });
    cargar();
  }

  return (
    <div className="gh-page">
      <div className="mz-kpi-grid" aria-label="Indicadores del mes">
        {[
          ["Registros", ind?.records],
          ["Total de horas extras", ind?.overtime_hours],
          ["Total de horas de sábado", ind?.saturday_hours],
          ["Colaboradores con novedades", ind?.collaborators_with_records],
          ["Supervisores que reportaron", ind?.supervisors_reporting],
          ...(ind?.supervisors_closed !== undefined
            ? [
                ["Supervisores con el mes cerrado", ind.supervisors_closed],
                ["Supervisores sin cerrar el mes", ind.supervisors_pending],
              ]
            : []),
        ].map(([etiqueta, valor]) => (
          <div key={etiqueta} className="mz-kpi">
            <div className="mz-kpi-value">{valor ?? "—"}</div>
            <div className="mz-kpi-label">{etiqueta}</div>
          </div>
        ))}
      </div>

      <form
        className="mz-filter-bar"
        aria-label="Filtros de horas extras"
        onSubmit={(e) => {
          e.preventDefault();
          setDesde(0);
          setAplicados(filtros);
        }}
      >
        <div className="mz-inline-field">
          <label htmlFor="gh-he-desde">Desde</label>
          <input
            id="gh-he-desde"
            type="date"
            className="form-control form-control-sm"
            value={filtros.date_from}
            onChange={(e) =>
              setFiltros({ ...filtros, date_from: e.target.value })
            }
          />
        </div>
        <div className="mz-inline-field">
          <label htmlFor="gh-he-hasta">Hasta</label>
          <input
            id="gh-he-hasta"
            type="date"
            className="form-control form-control-sm"
            value={filtros.date_to}
            onChange={(e) =>
              setFiltros({ ...filtros, date_to: e.target.value })
            }
          />
        </div>
        <div className="mz-inline-field">
          <label htmlFor="gh-he-jornada">Jornada</label>
          <select
            id="gh-he-jornada"
            className="form-select form-select-sm"
            value={filtros.jornada}
            onChange={(e) =>
              setFiltros({ ...filtros, jornada: e.target.value })
            }
          >
            <option value="">Todas</option>
            <option value="sabado">Sábado</option>
            <option value="domingo">Domingo</option>
            <option value="feriado">Feriado</option>
          </select>
        </div>
        {[
          ["cedula", "Cédula"],
          ["name", "Nombre"],
          ["regional", "Regional"],
          ["area", "Área"],
          ["cargo", "Cargo"],
        ].map(([clave, etiqueta]) => (
          <div key={clave} className="mz-inline-field">
            <label htmlFor={`gh-he-${clave}`}>{etiqueta}</label>
            <input
              id={`gh-he-${clave}`}
              className="form-control form-control-sm"
              value={filtros[clave]}
              onChange={(e) =>
                setFiltros({ ...filtros, [clave]: e.target.value })
              }
            />
          </div>
        ))}
        <button type="submit" className="btn btn-primary btn-sm">
          Filtrar
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={limpiar}
        >
          Limpiar
        </button>
      </form>

      <div className="gh-barra">
        <span className="mz-small mz-faint">
          {datos ? `${datos.count} registro(s)` : ""}
        </span>
        <div className="gh-barra__grupo">
          {puedeEscribir && abierto && (
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={() => setDialogo({ tipo: "nuevo" })}
            >
              <Icon name="plus-lg" /> Registrar una novedad
            </button>
          )}
          {can(PERM.exportar) && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={exportar}
            >
              <Icon name="file-earmark-excel" /> Exportar a Excel
            </button>
          )}
        </div>
      </div>
      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />

      {!enTarjetas && (
        <div className="mz-table-wrap">
          <table className="mz-table mz-table--ancha">
            <caption className="visually-hidden">
              Registros de horas extras de {mesInfo.label}
            </caption>
            <thead>
              <tr>
                <th scope="col">Fecha</th>
                <th scope="col">Cédula</th>
                <th scope="col">Colaborador</th>
                <th scope="col">Regional</th>
                <th scope="col">Área</th>
                <th scope="col">Cargo</th>
                <th scope="col" className="num">
                  # Horas extras
                </th>
                <th scope="col" className="num">
                  # Horas sábado
                </th>
                <th scope="col">Sábado</th>
                <th scope="col">Domingo</th>
                <th scope="col">Feriado</th>
                <th scope="col">Trabajo realizado</th>
                <th scope="col">Observaciones</th>
                <th scope="col">
                  <span className="visually-hidden">Detalle</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {registros.map((r) => (
                <tr key={r.id}>
                  <td>{fecha(r.date)}</td>
                  <td className="gh-mono">{r.cedula}</td>
                  <td>{r.full_name}</td>
                  <td>{r.regional}</td>
                  <td>{r.area}</td>
                  <td>{r.cargo}</td>
                  <td className="num">{r.overtime_hours}</td>
                  <td className="num">{r.saturday_hours}</td>
                  <td>{si(r.is_saturday)}</td>
                  <td>{si(r.is_sunday)}</td>
                  <td>{si(r.is_holiday)}</td>
                  <td className="mz-ellipsis" title={r.work_done}>
                    {r.work_done}
                  </td>
                  <td className="mz-ellipsis" title={r.observations}>
                    {r.observations}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      aria-label={`Ver el detalle de ${r.full_name} del ${fecha(r.date)}`}
                      onClick={() => setDetalle(r)}
                    >
                      Detalle
                    </button>
                  </td>
                </tr>
              ))}
              <FilaDeEstado columnas={14} {...estadoDeCarga} />
            </tbody>
          </table>
        </div>
      )}
      {enTarjetas && (
        <div className="mz-cards">
          <EstadoDeCarga {...estadoDeCarga} />
          {registros.length > 0 && (
            <ul
              className="mz-cards-lista"
              aria-label="Registros de horas extras"
            >
              {registros.map((r) => (
                <li key={r.id} className="mz-card-row">
                  <div className="mz-row-between">
                    <strong>{r.full_name}</strong>
                    <span>{fecha(r.date)}</span>
                  </div>
                  <div className="mz-card-meta">
                    <span className="gh-mono">{r.cedula}</span>
                    <span>{r.overtime_hours} h extra</span>
                    <span>{r.saturday_hours} h sábado</span>
                  </div>
                  <div className="mz-card-acciones">
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => setDetalle(r)}
                    >
                      Ver detalle
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {datos && datos.count > PAGINA && (
        <div className="mz-pager">
          <span className="mz-small mz-faint me-auto">
            {desde + 1}–{Math.min(desde + PAGINA, datos.count)} de {datos.count}{" "}
            (los totales y la exportación incluyen todo)
          </span>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={desde === 0}
            onClick={() => setDesde(Math.max(desde - PAGINA, 0))}
          >
            Anterior
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            disabled={desde + PAGINA >= datos.count}
            onClick={() => setDesde(desde + PAGINA)}
          >
            Siguiente
          </button>
        </div>
      )}

      {detalle && (
        <ModalDialog
          etiquetaCerrar="Cerrar ventana"
          titulo="Detalle del registro"
          onCerrar={() => setDetalle(null)}
        >
          <dl className="gh-tarjeta-kv mb-3">
            <dt>Colaborador</dt>
            <dd>
              {detalle.full_name} (
              <span className="gh-mono">{detalle.cedula}</span>)
            </dd>
            <dt>Fecha</dt>
            <dd>{fecha(detalle.date)}</dd>
            <dt>Supervisor</dt>
            <dd>{detalle.supervisor_name}</dd>
            <dt>Horas extras / de sábado</dt>
            <dd>
              {detalle.overtime_hours} / {detalle.saturday_hours}
            </dd>
            <dt>Sábado · Domingo · Feriado</dt>
            <dd>
              {si(detalle.is_saturday)} · {si(detalle.is_sunday)} ·{" "}
              {si(detalle.is_holiday)}
            </dd>
            <dt>Trabajo realizado</dt>
            <dd className="gh-pre">{detalle.work_done || "—"}</dd>
            <dt>Observaciones</dt>
            <dd className="gh-pre">{detalle.observations || "—"}</dd>
            <dt>Registrado por</dt>
            <dd>
              {detalle.created_by_name} · {fechaHora(detalle.created_at)}
            </dd>
            <dt>Última modificación</dt>
            <dd>
              {detalle.updated_by_name} · {fechaHora(detalle.updated_at)}
            </dd>
          </dl>
          <div className="mz-actions">
            {puedeEscribir && abierto && (
              <>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setDialogo({ tipo: "editar", registro: detalle });
                    setDetalle(null);
                  }}
                >
                  Editar
                </button>
                <button
                  type="button"
                  className="btn btn-outline-danger btn-sm"
                  onClick={() => {
                    setDialogo({ tipo: "eliminar", registro: detalle });
                    setDetalle(null);
                  }}
                >
                  Eliminar
                </button>
              </>
            )}
            {can(PERM.corregir) &&
              me.national_write &&
              mesInfo.status === "CLOSED" && (
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => {
                    setDialogo({ tipo: "corregir", registro: detalle });
                    setDetalle(null);
                  }}
                >
                  Corrección (mes cerrado)
                </button>
              )}
          </div>
        </ModalDialog>
      )}
      {(dialogo?.tipo === "nuevo" || dialogo?.tipo === "editar") && (
        <FormularioHorasExtras
          registro={dialogo.registro ?? null}
          mesInfo={mesInfo}
          supervisorId={supervisorId}
          onCerrar={() => setDialogo(null)}
          onGuardado={terminar}
        />
      )}
      {dialogo?.tipo === "eliminar" && (
        <EliminarHorasExtras
          registro={dialogo.registro}
          onCerrar={() => setDialogo(null)}
          onHecho={(yaNoExistia) =>
            terminar(
              yaNoExistia
                ? "El registro ya no existía (otra persona lo eliminó)."
                : "Registro eliminado. El colaborador sigue en la base.",
              yaNoExistia ? "info" : "ok",
            )
          }
        />
      )}
      {dialogo?.tipo === "corregir" && (
        <Correccion
          tipo="horas"
          titulo={`${dialogo.registro.full_name} · ${fecha(dialogo.registro.date)}`}
          valorActual={dialogo.registro.overtime_hours}
          cuerpo={{ record_id: dialogo.registro.id }}
          permitirAnular
          onCerrar={() => setDialogo(null)}
          onHecho={terminar}
        />
      )}
    </div>
  );
}

const CAMPO_DEL_SERVIDOR = {
  overtime_hours: "horasExtra",
  saturday_hours: "horasSabado",
  work_done: "trabajo",
  observations: "observaciones",
};

/** Registrar (alta) o editar UN registro de horas extras. */
export function FormularioHorasExtras({
  registro,
  mesInfo,
  supervisorId,
  onCerrar,
  onGuardado,
}) {
  const [equipo, setEquipo] = useState([]);
  const [errorEquipo, setErrorEquipo] = useState(null);
  const [versionEquipo, setVersionEquipo] = useState(0);
  const [valores, setValores] = useState({
    collaborator_id: registro?.collaborator_id ?? "",
    date: registro?.date ?? "",
    overtime_hours: registro?.overtime_hours ?? "",
    saturday_hours: registro?.saturday_hours ?? "",
    is_saturday: registro?.is_saturday ?? false,
    is_sunday: registro?.is_sunday ?? false,
    is_holiday: registro?.is_holiday ?? false,
    work_done: registro?.work_done ?? "",
    observations: registro?.observations ?? "",
  });
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const panel = useRef(null);

  useEffect(() => {
    if (registro) return undefined;
    let vigente = true;
    setErrorEquipo(null);
    novedadesService
      .colaboradores({
        status: "ACTIVE",
        supervisor: supervisorId ?? undefined,
      })
      .then((lista) => vigente && setEquipo(lista))
      .catch(
        (err) =>
          vigente &&
          setErrorEquipo(
            errorDeNovedades(
              err,
              "No se pudo cargar la lista de colaboradores.",
            ).mensaje,
          ),
      );
    return () => {
      vigente = false;
    };
  }, [registro, supervisorId, versionEquipo]);

  const poner = (cambios) => setValores((v) => ({ ...v, ...cambios }));

  async function enviar(evento) {
    evento.preventDefault();
    const faltan = {};
    if (!registro && !valores.collaborator_id)
      faltan.colaborador = "Elija al colaborador.";
    if (!registro && !valores.date)
      faltan.fecha = "Indique la fecha de trabajo.";
    if (
      !String(valores.overtime_hours).trim() &&
      !String(valores.saturday_hours).trim()
    )
      faltan.horasExtra = "Registre horas extras o de sábado.";
    setErrores(faltan);
    if (Object.keys(faltan).length) {
      enfocarPrimerError(panel.current);
      return;
    }
    setGuardando(true);
    setError(null);
    const cuerpo = {
      overtime_hours: String(valores.overtime_hours).replace(",", "."),
      saturday_hours: String(valores.saturday_hours).replace(",", "."),
      is_saturday: valores.is_saturday,
      is_sunday: valores.is_sunday,
      is_holiday: valores.is_holiday,
      work_done: valores.work_done,
      observations: valores.observations,
    };
    try {
      if (registro) {
        await novedadesService.editarHorasExtras(registro.id, {
          ...cuerpo,
          version: registro.version,
        });
      } else {
        await novedadesService.crearHorasExtras({
          ...cuerpo,
          collaborator_id: Number(valores.collaborator_id),
          date: valores.date,
        });
      }
      onGuardado(registro ? "Registro actualizado." : "Novedad registrada.");
    } catch (err) {
      const fallo = errorDeNovedades(err, "No se pudo guardar el registro.");
      const porCampo = fallo.detalle?.fields ?? {};
      const propios = Object.fromEntries(
        Object.entries(porCampo)
          .filter(([campo]) => CAMPO_DEL_SERVIDOR[campo])
          .map(([campo, mensaje]) => [CAMPO_DEL_SERVIDOR[campo], mensaje]),
      );
      setErrores(propios);
      setError(fallo.mensaje);
      setGuardando(false);
      enfocarPrimerError(panel.current);
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo={registro ? "Editar horas extras" : "Registrar horas extras"}
      subtitulo={
        registro
          ? `${registro.full_name} · ${fecha(registro.date)}`
          : `Mes de ${mesInfo.label}: fechas del ${fecha(mesInfo.start_date)} al ${fecha(mesInfo.end_date)}.`
      }
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar={registro ? "Guardar cambios" : "Registrar"}
      isSaving={guardando}
      anchoMaximo="640px"
    >
      <div ref={panel}>
        <LeyendaObligatorios />
        {!registro && errorEquipo && (
          <EstadoDeCarga
            error={errorEquipo}
            onReintentar={() => setVersionEquipo((v) => v + 1)}
          />
        )}
        {!registro && (
          <div className="mz-field-grid mt-2">
            <Campo
              id="gh-he-colaborador"
              etiqueta="Colaborador"
              obligatorio
              error={errores.colaborador}
            >
              <select
                className="form-select"
                value={valores.collaborator_id}
                onChange={(e) => poner({ collaborator_id: e.target.value })}
              >
                <option value="">Seleccione…</option>
                {equipo.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name} — {c.cedula}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo
              id="gh-he-fecha"
              etiqueta="Fecha de trabajo"
              obligatorio
              error={errores.fecha}
            >
              <input
                type="date"
                className="form-control"
                min={mesInfo.start_date}
                max={mesInfo.end_date}
                value={valores.date}
                onChange={(e) => {
                  const semana = e.target.value
                    ? diaDeSemana(e.target.value)
                    : -1;
                  // Sugerencia según el día; se puede ajustar.
                  poner({
                    date: e.target.value,
                    is_saturday: semana === 6,
                    is_sunday: semana === 0,
                  });
                }}
              />
            </Campo>
          </div>
        )}
        <div className="mz-field-grid mt-2">
          <Campo
            id="gh-he-extra"
            etiqueta="Horas extras"
            error={errores.horasExtra}
            ayuda="Hasta 24, con 2 decimales como máximo."
          >
            <input
              className="form-control"
              inputMode="decimal"
              value={valores.overtime_hours}
              onChange={(e) => poner({ overtime_hours: e.target.value })}
            />
          </Campo>
          <Campo
            id="gh-he-sabado"
            etiqueta="Horas de sábado"
            error={errores.horasSabado}
          >
            <input
              className="form-control"
              inputMode="decimal"
              value={valores.saturday_hours}
              onChange={(e) => poner({ saturday_hours: e.target.value })}
            />
          </Campo>
        </div>
        <fieldset className="mt-3">
          <legend className="form-label">Jornada</legend>
          {[
            ["is_saturday", "Sábado"],
            ["is_sunday", "Domingo"],
            ["is_holiday", "Feriado"],
          ].map(([campo, etiqueta]) => (
            <div key={campo} className="form-check form-check-inline">
              <input
                id={`gh-he-${campo}`}
                className="form-check-input"
                type="checkbox"
                checked={Boolean(valores[campo])}
                onChange={(e) => poner({ [campo]: e.target.checked })}
              />
              <label className="form-check-label" htmlFor={`gh-he-${campo}`}>
                {etiqueta}
              </label>
            </div>
          ))}
        </fieldset>
        <Campo
          id="gh-he-trabajo"
          etiqueta="Trabajo realizado"
          error={errores.trabajo}
          className="mt-3"
        >
          <textarea
            className="form-control"
            rows={2}
            maxLength={500}
            value={valores.work_done}
            onChange={(e) => poner({ work_done: e.target.value })}
          />
        </Campo>
        <Campo
          id="gh-he-observaciones"
          etiqueta="Observaciones"
          error={errores.observaciones}
          className="mt-3"
        >
          <textarea
            className="form-control"
            rows={2}
            maxLength={1000}
            value={valores.observations}
            onChange={(e) => poner({ observations: e.target.value })}
          />
        </Campo>
        <ErrorEnLinea mensaje={error} className="mt-3" />
      </div>
    </ModalDialog>
  );
}
