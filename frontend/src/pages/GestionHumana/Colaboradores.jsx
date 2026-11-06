/*
 * Colaboradores: la base operativa de cada supervisor. El alta es inmediata
 * (no requiere aprobación) y queda disponible en Días laborados y Horas
 * extras; no crea contrato, nómina ni afiliación. La cédula llega del
 * servidor completa o enmascarada según los permisos: se muestra tal cual.
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
import { AnuncioDeResultados } from "../../components/common/AnuncioDeResultados/AnuncioDeResultados";
import { Icon } from "../../components/common/Icon/Icon";
import { ModalDialog } from "../../components/common/ModalDialog/ModalDialog";
import { useVistaDeTarjetas } from "../../hooks/useMediaQuery";
import { useUltimaPeticion } from "../../hooks/useUltimaPeticion";
import { PERM } from "../../modulos/permisosGestionHumana";
import {
  Aviso,
  MenuDeAcciones,
  ESTADO_COLABORADOR,
  ErrorEnLinea,
  EstadoColaborador,
  fechaHora,
} from "./comunes";
import {
  BarraDeAlcance,
  ConAcceso,
  Encabezado,
  useNovedades,
} from "./ContextoNovedades";
import { CambiarEstado, CorregirCedula, RetirarDeDias } from "./Dialogos";
import { ImportarExcel } from "./ImportarExcel";

export function Colaboradores() {
  return (
    <ConAcceso titulo="Colaboradores">
      <PantallaColaboradores />
    </ConAcceso>
  );
}

function PantallaColaboradores() {
  const { me, can, supervisorId, supervisores } = useNovedades();
  const [lista, setLista] = useState(null);
  const [error, setError] = useState(null);
  const [busqueda, setBusqueda] = useState("");
  // El buscador, para devolverle el foco al limpiar.
  const campoBusqueda = useRef(null);
  const [estado, setEstado] = useState("");
  const [dialogo, setDialogo] = useState(null);
  const [aviso, setAviso] = useState(null);
  const enTarjetas = useVistaDeTarjetas();

  // El Jefe de Operaciones no trabaja la base (en Nexo no tenía la pestaña).
  const gestiona = can(PERM.colaboradores) && !me.is_assistant;
  const administra = me.national_write;

  // Solo cuenta la respuesta de lo último escrito: con la búsqueda en vivo,
  // una consulta lenta de «ma» llegaba después de la de «maría» y la pisaba
  // (06/11/2026). Mientras tanto la lista anterior se queda, atenuada.
  const nuevaPeticion = useUltimaPeticion();
  const [cargando, setCargando] = useState(true);
  const cargar = useCallback(async () => {
    const vigente = nuevaPeticion();
    setError(null);
    setCargando(true);
    try {
      const datos = await novedadesService.colaboradores({
        q: busqueda.trim(),
        status: estado,
        supervisor: supervisorId ?? undefined,
      });
      if (!vigente()) return;
      setLista(datos);
      setCargando(false);
    } catch (err) {
      if (!vigente()) return;
      setCargando(false);
      setLista([]);
      setError(
        errorDeNovedades(err, "No se pudo cargar la base de colaboradores.")
          .mensaje,
      );
    }
  }, [busqueda, estado, supervisorId, nuevaPeticion]);

  // La búsqueda espera a que se deje de escribir; los demás filtros, al momento.
  useEffect(() => {
    const reloj = setTimeout(cargar, 300);
    return () => clearTimeout(reloj);
  }, [cargar]);

  function terminar(texto, tono = "ok") {
    setDialogo(null);
    if (texto) setAviso({ texto, tono });
    cargar();
  }

  async function verHistorial(c) {
    setDialogo({ tipo: "historial", colaborador: c, datos: null });
    try {
      const datos = await novedadesService.historialDeColaborador(c.id);
      setDialogo((d) =>
        d?.tipo === "historial" && d.colaborador.id === c.id
          ? { ...d, datos }
          : d,
      );
    } catch (err) {
      setDialogo((d) =>
        d?.tipo === "historial"
          ? { ...d, error: errorDeNovedades(err).mensaje }
          : d,
      );
    }
  }

  const supervisorDeLaImportacion =
    me.is_supervisor && !me.national_write ? me.user.id : supervisorId;
  const nombreDelSupervisor =
    me.is_supervisor && !me.national_write
      ? me.user.name
      : supervisores.find((s) => s.id === supervisorId)?.name;

  if (me.is_jefe && !administra) {
    return (
      <div className="gh-page">
        <Encabezado titulo="Colaboradores" />
        <EstadoDeCarga
          vacio
          textoVacio="La base de colaboradores la gestionan los supervisores y el Administrador del módulo. Usted consulta Días laborados, Horas extras y trabaja Horas depuradas."
        />
      </div>
    );
  }

  const hayFiltros = Boolean(busqueda.trim() || estado);
  const estadoDeCarga = {
    cargando: lista === null && !error,
    error,
    onReintentar: cargar,
    vacio: lista !== null && lista.length === 0,
    textoVacio: "Todavía no hay colaboradores registrados en esta base.",
    hayFiltros,
    termino: busqueda.trim(),
    campoBusquedaRef: campoBusqueda,
    onLimpiarFiltros: () => {
      setBusqueda("");
      setEstado("");
    },
    accionVacio: gestiona ? (
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => setDialogo({ tipo: "formulario" })}
      >
        Agregar el primero
      </button>
    ) : undefined,
  };

  /** «Editar» queda a la vista; el resto, en «Más acciones». */
  function acciones(c) {
    return (
      <div className="mz-actions justify-content-end">
        {gestiona && (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            aria-label={`Editar a ${c.full_name}`}
            onClick={() => setDialogo({ tipo: "formulario", colaborador: c })}
          >
            Editar
          </button>
        )}
        <MenuDeAcciones
          etiqueta={`Más acciones para ${c.full_name}`}
          acciones={[
            { texto: "Ver historial", onClick: () => verHistorial(c) },
            gestiona && {
              texto: "Cambiar estado",
              onClick: () => setDialogo({ tipo: "estado", colaborador: c }),
            },
            administra && {
              texto: "Reasignar",
              onClick: () => setDialogo({ tipo: "reasignar", colaborador: c }),
            },
            administra &&
              gestiona && {
                texto: "Corregir cédula",
                onClick: () => setDialogo({ tipo: "cedula", colaborador: c }),
              },
            administra &&
              gestiona && {
                texto: c.worked_days_removed_at
                  ? "Restaurar en Días laborados"
                  : "Retirar de Días laborados",
                onClick: () =>
                  setDialogo({
                    tipo: c.worked_days_removed_at ? "restaurar" : "retirar",
                    colaborador: c,
                  }),
              },
            administra &&
              gestiona && {
                texto: "Eliminar de la base",
                peligro: true,
                onClick: () => setDialogo({ tipo: "eliminar", colaborador: c }),
              },
          ]}
        />
      </div>
    );
  }

  function marcas(c) {
    return (
      <>
        <EstadoColaborador estado={c.status} />
        {c.worked_days_removed_at && (
          <span
            className="mz-pill mz-pill--neutral ms-1"
            title={`Retirado por ${c.worked_days_removed_by || "el Administrador"} el ${fechaHora(c.worked_days_removed_at)}${c.worked_days_removed_reason ? ` · ${c.worked_days_removed_reason}` : ""}`}
          >
            Retirado de Días laborados
          </span>
        )}
      </>
    );
  }

  return (
    <div className="gh-page">
      <Encabezado
        titulo="Colaboradores"
        descripcion="La base operativa de cada supervisor. El alta es inmediata y queda disponible en Días laborados y Horas extras."
      >
        {gestiona && (
          <>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() =>
                novedadesService.plantillaColaboradores().catch((err) =>
                  setAviso({
                    texto: errorDeNovedades(err).mensaje,
                    tono: "bad",
                  }),
                )
              }
            >
              <Icon name="file-earmark-excel" /> Plantilla
            </button>
            {can(PERM.importar) && (
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={!supervisorDeLaImportacion}
                aria-describedby={
                  !supervisorDeLaImportacion
                    ? "gh-colab-importar-ayuda"
                    : undefined
                }
                onClick={() => setDialogo({ tipo: "importar" })}
              >
                <Icon name="upload" /> Importar base
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setDialogo({ tipo: "formulario" })}
            >
              <Icon name="plus-lg" /> Agregar colaborador
            </button>
          </>
        )}
      </Encabezado>
      {gestiona && can(PERM.importar) && !supervisorDeLaImportacion && (
        <p id="gh-colab-importar-ayuda" className="mz-small mz-faint mb-0">
          Para importar una base, elija arriba el supervisor de destino.
        </p>
      )}
      <BarraDeAlcance tipo="ninguno" idBase="gh-colab" />
      <div className="mz-filter-bar">
        <div className="mz-fb-search">
          <Icon name="search" />
          <input
            ref={campoBusqueda}
            type="search"
            aria-label="Buscar por cédula o nombre"
            placeholder="Buscar cédula o nombre"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <div className="mz-inline-field">
          <label htmlFor="gh-colab-estado">Estado</label>
          <select
            id="gh-colab-estado"
            className="form-select form-select-sm"
            value={estado}
            onChange={(e) => setEstado(e.target.value)}
          >
            <option value="">Todos</option>
            {Object.entries(ESTADO_COLABORADOR).map(([v, e]) => (
              <option key={v} value={v}>
                {e}
              </option>
            ))}
          </select>
        </div>
      </div>
      <AnuncioDeResultados
        termino={busqueda}
        total={lista?.length ?? 0}
        cargando={cargando}
      />
      <Aviso aviso={aviso} onCerrar={() => setAviso(null)} />

      {!enTarjetas && (
        <div className="mz-table-wrap" aria-busy={cargando && lista !== null}>
          <table className="mz-table">
            <caption className="visually-hidden">Base de colaboradores</caption>
            <thead>
              <tr>
                <th scope="col">Cédula</th>
                <th scope="col">Nombres completos</th>
                <th scope="col">Regional</th>
                <th scope="col">Área</th>
                <th scope="col">Cargo</th>
                <th scope="col">Supervisor</th>
                <th scope="col">Estado</th>
                <th scope="col">
                  <span className="visually-hidden">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(lista ?? []).map((c) => (
                <tr key={c.id}>
                  <td className="gh-mono">{c.cedula}</td>
                  <td>{c.full_name}</td>
                  <td>{c.regional}</td>
                  <td>{c.area}</td>
                  <td>{c.cargo}</td>
                  <td className="mz-faint">{c.supervisor_name}</td>
                  <td>{marcas(c)}</td>
                  <td className="num">{acciones(c)}</td>
                </tr>
              ))}
              <FilaDeEstado columnas={8} {...estadoDeCarga} />
            </tbody>
          </table>
        </div>
      )}
      {enTarjetas && (
        <div className="mz-cards" aria-busy={cargando && lista !== null}>
          <EstadoDeCarga {...estadoDeCarga} />
          {lista?.length > 0 && (
            <ul className="mz-cards-lista" aria-label="Base de colaboradores">
              {lista.map((c) => (
                <li key={c.id} className="mz-card-row">
                  <div className="mz-row-between">
                    <strong>{c.full_name}</strong>
                    <span>{marcas(c)}</span>
                  </div>
                  <div className="mz-card-meta">
                    <span className="gh-mono">{c.cedula}</span>
                    <span>{c.cargo}</span>
                    <span>{c.supervisor_name}</span>
                  </div>
                  <div className="mz-card-acciones">{acciones(c)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dialogo?.tipo === "formulario" && (
        <FormularioColaborador
          colaborador={dialogo.colaborador ?? null}
          onCerrar={() => setDialogo(null)}
          onGuardado={terminar}
        />
      )}
      {dialogo?.tipo === "estado" && (
        <CambiarEstado
          colaborador={dialogo.colaborador}
          onCerrar={() => setDialogo(null)}
          onHecho={terminar}
        />
      )}
      {dialogo?.tipo === "cedula" && (
        <CorregirCedula
          colaborador={dialogo.colaborador}
          onCerrar={() => setDialogo(null)}
          onHecho={terminar}
        />
      )}
      {(dialogo?.tipo === "retirar" || dialogo?.tipo === "restaurar") && (
        <RetirarDeDias
          colaborador={dialogo.colaborador}
          restaurar={dialogo.tipo === "restaurar"}
          onCerrar={() => setDialogo(null)}
          onHecho={terminar}
        />
      )}
      {dialogo?.tipo === "reasignar" && (
        <Reasignar
          colaborador={dialogo.colaborador}
          onCerrar={() => setDialogo(null)}
          onHecho={terminar}
        />
      )}
      {dialogo?.tipo === "eliminar" && (
        <EliminarColaborador
          colaborador={dialogo.colaborador}
          onCerrar={() => setDialogo(null)}
          onHecho={terminar}
        />
      )}
      {dialogo?.tipo === "importar" && (
        <ImportarExcel
          tipo="COLLABORATORS"
          supervisorId={supervisorDeLaImportacion}
          supervisorNombre={nombreDelSupervisor}
          onCerrar={() => setDialogo(null)}
          onImportado={terminar}
        />
      )}
      {dialogo?.tipo === "historial" && (
        <ModalDialog
          etiquetaCerrar="Cerrar ventana"
          titulo={`Historial · ${dialogo.colaborador.full_name}`}
          onCerrar={() => setDialogo(null)}
        >
          <EstadoDeCarga
            cargando={!dialogo.datos && !dialogo.error}
            error={dialogo.error}
          />
          {dialogo.datos && (
            <>
              <h4 className="h6">Estados operativos</h4>
              {dialogo.datos.statuses.length === 0 ? (
                <p className="mz-faint">Sin cambios de estado.</p>
              ) : (
                <ul className="mz-timeline">
                  {dialogo.datos.statuses.map((s, i) => (
                    <li key={i} className="mz-tl-item">
                      <div className="mz-tl-what">
                        {ESTADO_COLABORADOR[s.previous_status] ??
                          s.previous_status}{" "}
                        →{" "}
                        <strong>
                          {ESTADO_COLABORADOR[s.new_status] ?? s.new_status}
                        </strong>{" "}
                        · {s.changed_by}
                      </div>
                      <div className="mz-tl-when">
                        {fechaHora(s.created_at)}
                      </div>
                      {s.reason && (
                        <div className="mz-tl-why">Motivo: {s.reason}</div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <h4 className="h6 mt-3">Asignaciones</h4>
              <ul className="mz-timeline">
                {dialogo.datos.assignments.map((a, i) => (
                  <li key={i} className="mz-tl-item">
                    <div className="mz-tl-what">
                      <strong>{a.supervisor}</strong> · desde{" "}
                      {fechaHora(a.started_at)}
                      {a.ended_at
                        ? ` hasta ${fechaHora(a.ended_at)}`
                        : " (vigente)"}
                    </div>
                    <div className="mz-tl-why">
                      Asignado por {a.assigned_by}
                      {a.reason ? ` · ${a.reason}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </ModalDialog>
      )}
    </div>
  );
}

const CAMPOS = [
  ["full_name", "Nombres completos", true],
  ["regional", "Regional", false],
  ["area", "Área", false],
  ["cargo", "Cargo", false],
  ["codigo_empleado", "Código de empleado", false],
];

/** Alta o edición. La cédula de un colaborador ya registrado se corrige con
 * su propia acción (auditada, solo el Administrador). */
function FormularioColaborador({ colaborador, onCerrar, onGuardado }) {
  const { me, supervisores, supervisorId } = useNovedades();
  const [valores, setValores] = useState({
    cedula: colaborador?.cedula ?? "",
    full_name: colaborador?.full_name ?? "",
    regional: colaborador?.regional ?? "",
    area: colaborador?.area ?? "",
    cargo: colaborador?.cargo ?? "",
    codigo_empleado: colaborador?.codigo_empleado ?? "",
  });
  const [destino, setDestino] = useState(
    supervisorId ?? supervisores[0]?.id ?? "",
  );
  const [nuevoIngreso, setNuevoIngreso] = useState(false);
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const panel = useRef(null);
  const eligeSupervisor = !colaborador && me.national_write;

  // Al editar, la cédula completa sale del detalle (en la lista va
  // enmascarada); si no se puede leer, queda la enmascarada.
  const idEnEdicion = colaborador?.id;
  useEffect(() => {
    if (!idEnEdicion) return undefined;
    let vigente = true;
    novedadesService
      .colaborador(idEnEdicion)
      .then((d) => vigente && setValores((v) => ({ ...v, cedula: d.cedula })))
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [idEnEdicion]);

  async function enviar(evento) {
    evento.preventDefault();
    const faltan = {};
    if (!colaborador && !valores.cedula.trim())
      faltan.cedula = "Escriba la cédula.";
    if (!valores.full_name.trim())
      faltan.full_name = "Escriba los nombres completos.";
    if (eligeSupervisor && !destino)
      faltan.supervisor = "Elija el supervisor responsable.";
    setErrores(faltan);
    if (Object.keys(faltan).length) {
      enfocarPrimerError(panel.current);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      if (colaborador) {
        await novedadesService.editarColaborador(colaborador.id, {
          full_name: valores.full_name,
          regional: valores.regional,
          area: valores.area,
          cargo: valores.cargo,
          codigo_empleado: valores.codigo_empleado,
        });
      } else {
        await novedadesService.crearColaborador({
          ...valores,
          supervisor_id: eligeSupervisor ? Number(destino) : null,
          is_new_hire: nuevoIngreso,
        });
      }
      onGuardado(
        colaborador
          ? "Colaborador actualizado."
          : "Colaborador registrado. Se notificó al Administrador.",
      );
    } catch (err) {
      const fallo = errorDeNovedades(err, "No se pudo guardar el colaborador.");
      const porCampo = err?.response?.data?.error?.details;
      if (
        porCampo &&
        typeof porCampo === "object" &&
        !Array.isArray(porCampo)
      ) {
        setErrores(
          Object.fromEntries(
            Object.entries(porCampo).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.join(" ") : String(v),
            ]),
          ),
        );
      }
      setError(fallo.mensaje);
      setGuardando(false);
      enfocarPrimerError(panel.current);
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo={colaborador ? "Editar colaborador" : "Agregar colaborador"}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar="Guardar"
      isSaving={guardando}
      anchoMaximo="640px"
    >
      <div ref={panel}>
        <LeyendaObligatorios />
        <div className="mz-field-grid mt-2">
          <Campo
            id="gh-colab-cedula"
            etiqueta="Cédula"
            obligatorio={!colaborador}
            error={errores.cedula}
            ayuda={
              colaborador
                ? "Se corrige con «Cédula» (solo el Administrador)."
                : undefined
            }
          >
            <input
              className="form-control"
              maxLength={20}
              disabled={Boolean(colaborador)}
              value={valores.cedula}
              onChange={(e) =>
                setValores({ ...valores, cedula: e.target.value })
              }
            />
          </Campo>
          {CAMPOS.map(([campo, etiqueta, obligatorio]) => (
            <Campo
              key={campo}
              id={`gh-colab-${campo}`}
              etiqueta={etiqueta}
              obligatorio={obligatorio}
              error={errores[campo]}
              ayuda={
                campo === "codigo_empleado"
                  ? "Opcional: enlaza la ficha de Organización."
                  : undefined
              }
            >
              <input
                className="form-control"
                maxLength={
                  campo === "full_name"
                    ? 200
                    : campo === "codigo_empleado"
                      ? 40
                      : 100
                }
                value={valores[campo]}
                onChange={(e) =>
                  setValores({ ...valores, [campo]: e.target.value })
                }
              />
            </Campo>
          ))}
          {eligeSupervisor && (
            <Campo
              id="gh-colab-supervisor"
              etiqueta="Supervisor responsable"
              obligatorio
              error={errores.supervisor}
            >
              <select
                className="form-select"
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
              >
                <option value="">Seleccione…</option>
                {supervisores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Campo>
          )}
        </div>
        {!colaborador && (
          <>
            <div className="form-check mt-3">
              <input
                id="gh-colab-nuevo"
                className="form-check-input"
                type="checkbox"
                checked={nuevoIngreso}
                aria-describedby="gh-colab-nuevo-ayuda"
                onChange={(e) => setNuevoIngreso(e.target.checked)}
              />
              <label className="form-check-label" htmlFor="gh-colab-nuevo">
                Es un nuevo ingreso
              </label>
              <div id="gh-colab-nuevo-ayuda" className="form-text">
                Márquelo solo si la persona recién ingresa a la operación (no al
                registrar a alguien que ya trabajaba). La notificación de
                ingreso se envía cuando tenga su segundo día laborado
                registrado.
              </div>
            </div>
            <p className="mz-small mz-faint mt-2 mb-0">
              El registro es inmediato y queda disponible en Días laborados y
              Horas extras. No crea contrato, nómina ni afiliación al IESS.
            </p>
          </>
        )}
        <ErrorEnLinea mensaje={error} className="mt-3" />
      </div>
    </ModalDialog>
  );
}

/** Pasar a un colaborador a otro equipo (solo el Administrador). */
function Reasignar({ colaborador, onCerrar, onHecho }) {
  const { supervisores } = useNovedades();
  const opciones = supervisores.filter(
    (s) => s.id !== colaborador.supervisor_id,
  );
  const [destino, setDestino] = useState(opciones[0]?.id ?? "");
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const panel = useRef(null);

  async function enviar(evento) {
    evento.preventDefault();
    const faltan = {};
    if (!destino) faltan.destino = "Elija el nuevo supervisor.";
    if (!motivo.trim()) faltan.motivo = "Escriba el motivo.";
    setErrores(faltan);
    if (Object.keys(faltan).length) {
      enfocarPrimerError(panel.current);
      return;
    }
    setGuardando(true);
    try {
      await novedadesService.reasignar(
        colaborador.id,
        Number(destino),
        motivo.trim(),
      );
      onHecho("Colaborador reasignado.");
    } catch (err) {
      setError(errorDeNovedades(err, "No se pudo reasignar.").mensaje);
      setGuardando(false);
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo="Reasignar colaborador"
      subtitulo={`${colaborador.full_name} · supervisor actual: ${colaborador.supervisor_name}`}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar="Reasignar"
      isSaving={guardando}
    >
      <div ref={panel}>
        <p className="mz-small">
          Los registros ya guardados conservan al supervisor que era responsable
          cuando se registraron.
        </p>
        <LeyendaObligatorios />
        <Campo
          id="gh-reasignar-destino"
          etiqueta="Nuevo supervisor"
          obligatorio
          error={errores.destino}
          className="mt-2 mb-3"
        >
          <select
            className="form-select"
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
          >
            <option value="">Seleccione…</option>
            {opciones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Campo>
        <Campo
          id="gh-reasignar-motivo"
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
        <ErrorEnLinea mensaje={error} />
      </div>
    </ModalDialog>
  );
}

/** Quitar a una persona de la base (solo el Administrador). El servidor lo
 * rechaza si ya tiene novedades: entonces corresponde pasarla a Inactivo. */
function EliminarColaborador({ colaborador, onCerrar, onHecho }) {
  const [motivo, setMotivo] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);
  const panel = useRef(null);

  async function enviar(evento) {
    evento.preventDefault();
    if (!motivo.trim()) {
      setErrores({ motivo: "Escriba el motivo." });
      enfocarPrimerError(panel.current);
      return;
    }
    if (enCurso.current) return;
    enCurso.current = true;
    setGuardando(true);
    try {
      await novedadesService.eliminarColaborador(colaborador.id, motivo.trim());
      onHecho("Colaborador eliminado de la base.");
    } catch (err) {
      const fallo = errorDeNovedades(err, "No se pudo eliminar.");
      if (fallo.estado === 404) {
        onHecho("El colaborador ya no estaba en la base.", "info");
        return;
      }
      setError(fallo.mensaje);
      setGuardando(false);
      enCurso.current = false;
    }
  }

  return (
    <ModalDialog
      etiquetaCerrar="Cerrar ventana"
      titulo="Eliminar colaborador de la base"
      subtitulo={`${colaborador.full_name} · cédula ${colaborador.cedula} · ${colaborador.supervisor_name}`}
      onCerrar={onCerrar}
      onSubmit={enviar}
      textoConfirmar="Eliminar de la base"
      variante="danger"
      isSaving={guardando}
    >
      <div ref={panel}>
        <p>
          Quita a la persona de la base (no es lo mismo que eliminar un registro
          de horas extras). Solo se permite si no tiene días laborados ni horas
          extras registrados; si los tiene, cambie su estado a Inactivo.
        </p>
        <Campo
          id="gh-eliminar-colab-motivo"
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
        <ErrorEnLinea mensaje={error} />
      </div>
    </ModalDialog>
  );
}
