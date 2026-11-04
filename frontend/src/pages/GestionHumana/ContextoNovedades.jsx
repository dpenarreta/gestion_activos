/*
 * El marco de Gestión Humana: quién es la persona en el módulo
 * (`GET novedades/me/`), y el supervisor, el período (23 → 22) y el mes de
 * Horas extras elegidos arriba. Se comparten entre las pantallas del módulo:
 * al pasar de Días laborados a Horas extras se conserva el equipo elegido,
 * como en las pestañas de Nexo.
 *
 * Nada de esto es la barrera de seguridad: el servidor vuelve a autorizar
 * cada petición (ámbito por supervisor, permisos efectivos, plazos y cierres).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Outlet } from "react-router-dom";

import { errorDeNovedades, novedadesService } from "../../api/novedadesService";
import { confirmar } from "../../components/common/Confirmar/confirmar";
import { EstadoDeCarga } from "../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../components/common/Icon/Icon";
import { useUnsavedChangesOpcional } from "../../context/UnsavedChangesContext";
import { ESTADO_MES, fecha } from "./comunes";
import "./GestionHumana.css";

const Contexto = createContext(null);

export function ProveedorNovedades({ children }) {
  const [me, setMe] = useState(null);
  const [estadoMe, setEstadoMe] = useState("inactivo");
  const [errorMe, setErrorMe] = useState(null);
  const [supervisores, setSupervisores] = useState([]);
  const [supervisorId, setSupervisorId] = useState(null);
  const [periodos, setPeriodos] = useState([]);
  const [periodo, setPeriodo] = useState(null);
  const [versionPeriodos, setVersionPeriodos] = useState(0);
  const [meses, setMeses] = useState([]);
  const [mes, setMes] = useState(null);
  const [versionMeses, setVersionMeses] = useState(0);
  // Un error por pedido: un fallo no se muestra como lista vacía.
  const [errorSupervisores, setErrorSupervisores] = useState(null);
  const [versionSupervisores, setVersionSupervisores] = useState(0);
  const [errorPeriodos, setErrorPeriodos] = useState(null);
  const [errorMeses, setErrorMeses] = useState(null);
  const [mesesCargados, setMesesCargados] = useState(false);
  const pidiendo = useRef(false);

  // Cambios que el servidor todavía no confirmó en la pantalla abierta: al
  // cambiar de filtro o de pantalla se pregunta antes (el guardado
  // automático los conserva y los envía al volver).
  const pendientes = useRef(0);
  const sinGuardar = useUnsavedChangesOpcional();
  const registrar = sinGuardar?.registrarVerificador;
  useEffect(() => {
    if (!registrar) return undefined;
    return registrar(() => pendientes.current > 0);
  }, [registrar]);

  const cargarMe = useCallback(() => {
    pidiendo.current = true;
    setEstadoMe("cargando");
    setErrorMe(null);
    novedadesService
      .yo()
      .then((datos) => {
        setMe(datos);
        setPeriodo((actual) => actual ?? datos.current_period?.code ?? null);
        setMes((actual) => actual ?? datos.current_month?.code ?? null);
        setSupervisorId(
          (actual) =>
            actual ?? (datos.is_supervisor ? (datos.user?.id ?? null) : null),
        );
        setEstadoMe("listo");
      })
      .catch((err) => {
        const error = errorDeNovedades(
          err,
          "No se pudo cargar el módulo en este momento.",
        );
        setErrorMe(error.mensaje);
        setEstadoMe(error.estado === 403 ? "sin_acceso" : "error");
      })
      .finally(() => {
        pidiendo.current = false;
      });
  }, []);

  const asegurar = useCallback(() => {
    if (!pidiendo.current && estadoMe === "inactivo") cargarMe();
  }, [cargarMe, estadoMe]);

  const eligeSupervisor = Boolean(
    me && (!me.is_supervisor || me.national_write),
  );

  // Supervisores para el selector (el Supervisor solo trabaja su equipo).
  useEffect(() => {
    if (!eligeSupervisor) return;
    let vigente = true;
    setErrorSupervisores(null);
    novedadesService
      .supervisores()
      .then((lista) => {
        if (!vigente) return;
        setSupervisores(lista);
        // El Asistente y el Jefe arrancan en el consolidado nacional; el
        // Administrador, en el primer equipo (como en Nexo).
        setSupervisorId(
          (actual) =>
            actual ??
            (me.is_assistant || me.is_jefe ? null : (lista[0]?.id ?? null)),
        );
      })
      .catch(
        (err) =>
          vigente &&
          setErrorSupervisores(
            errorDeNovedades(err, "No se pudo cargar la lista de supervisores.")
              .mensaje,
          ),
      );
    return () => {
      vigente = false;
    };
  }, [eligeSupervisor, me, versionSupervisores]);

  useEffect(() => {
    if (!me) return;
    let vigente = true;
    setErrorPeriodos(null);
    novedadesService
      .periodos(supervisorId ?? undefined)
      .then((lista) => vigente && setPeriodos(lista))
      .catch(
        (err) =>
          vigente &&
          setErrorPeriodos(
            errorDeNovedades(err, "No se pudo cargar la lista de períodos.")
              .mensaje,
          ),
      );
    return () => {
      vigente = false;
    };
  }, [me, supervisorId, versionPeriodos]);

  useEffect(() => {
    if (!me) return;
    let vigente = true;
    setErrorMeses(null);
    novedadesService
      .mesesDeHorasExtras(supervisorId ?? undefined)
      .then((lista) => {
        if (!vigente) return;
        setMeses(lista);
        setMesesCargados(true);
      })
      .catch(
        (err) =>
          vigente &&
          setErrorMeses(
            errorDeNovedades(err, "No se pudo cargar el estado de los meses.")
              .mensaje,
          ),
      );
    return () => {
      vigente = false;
    };
  }, [me, supervisorId, versionMeses]);

  const cambiar = useCallback(async (accion) => {
    if (pendientes.current > 0) {
      const seguir = await confirmar({
        titulo: "Hay cambios que el servidor todavía no confirmó",
        mensaje:
          "Se conservan en esta pestaña y se enviarán solos al volver a esta pantalla. ¿Desea continuar?",
        accion: "Continuar",
        cancelar: "Quedarme aquí",
        peligro: false,
      });
      if (!seguir) return false;
      pendientes.current = 0;
    }
    accion();
    return true;
  }, []);

  const valor = useMemo(
    () => ({
      me,
      estadoMe,
      errorMe,
      asegurar,
      recargarMe: cargarMe,
      can: (codigo) => Boolean(me?.permissions?.includes(codigo)),
      eligeSupervisor,
      supervisores,
      errorSupervisores,
      recargarSupervisores: () => setVersionSupervisores((v) => v + 1),
      supervisorId,
      elegirSupervisor: (id) => cambiar(() => setSupervisorId(id)),
      periodos,
      errorPeriodos,
      periodo,
      elegirPeriodo: (codigo) => cambiar(() => setPeriodo(codigo)),
      recargarPeriodos: () => setVersionPeriodos((v) => v + 1),
      meses,
      errorMeses,
      mesesCargados,
      mes,
      elegirMes: (codigo) => cambiar(() => setMes(codigo)),
      recargarMeses: () => setVersionMeses((v) => v + 1),
      /** Abre un período de un equipo (desde el repositorio). */
      abrirPeriodo: (codigo, id) =>
        cambiar(() => {
          setPeriodo(codigo);
          if (id !== undefined) setSupervisorId(id);
        }),
      marcarPendientes: (cantidad) => {
        pendientes.current = cantidad;
      },
    }),
    [
      me,
      estadoMe,
      errorMe,
      asegurar,
      cargarMe,
      eligeSupervisor,
      supervisores,
      errorSupervisores,
      supervisorId,
      periodos,
      errorPeriodos,
      periodo,
      meses,
      errorMeses,
      mesesCargados,
      mes,
      cambiar,
    ],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** El marco de las rutas del módulo que necesitan `me`. */
export function MarcoGestionHumana() {
  return (
    <ProveedorNovedades>
      <Outlet />
    </ProveedorNovedades>
  );
}

export function useNovedades() {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error("useNovedades debe usarse dentro de <ProveedorNovedades>.");
  }
  const { asegurar } = contexto;
  useEffect(() => {
    asegurar();
  }, [asegurar]);
  return contexto;
}

/**
 * Lo que cada pantalla muestra mientras se sabe quién es la persona en el
 * módulo: cargando, error con reintento o «sin acceso» (403), y después el
 * contenido.
 */
export function ConAcceso({ titulo, children }) {
  const { me, estadoMe, errorMe, recargarMe } = useNovedades();
  if (estadoMe === "listo" && me) return children;
  return (
    <div className="gh-page">
      <div className="mz-view-head">
        <div>
          <h2>{titulo}</h2>
        </div>
      </div>
      {estadoMe === "sin_acceso" ? (
        <div className="mz-alert mz-alert--warn" role="alert">
          <Icon name="shield-lock" />
          <span>
            {errorMe ||
              "No tiene acceso a Control Operativo de Novedades. Si lo necesita, solicítelo al Administrador del módulo."}
          </span>
        </div>
      ) : (
        <EstadoDeCarga
          cargando={estadoMe !== "error"}
          error={estadoMe === "error" ? errorMe : null}
          onReintentar={recargarMe}
        />
      )}
    </div>
  );
}

/** Encabezado de una pantalla del módulo. */
export function Encabezado({ titulo, descripcion, children }) {
  return (
    <div className="mz-view-head">
      <div>
        <h2>{titulo}</h2>
        {descripcion && <p className="mz-desc">{descripcion}</p>}
      </div>
      {children && <div className="mz-view-actions">{children}</div>}
    </div>
  );
}

/**
 * Los selectores de arriba: el supervisor (a quien puede elegirlo) y el
 * período 23 → 22 o el mes de Horas extras, según la pantalla. `todos`
 * ofrece «Todos los supervisores» a quien tiene alcance nacional.
 */
export function BarraDeAlcance({
  tipo = "periodo",
  todos = true,
  idBase = "gh",
}) {
  const {
    me,
    eligeSupervisor,
    supervisores,
    supervisorId,
    elegirSupervisor,
    periodos,
    periodo,
    elegirPeriodo,
    meses,
    mes,
    elegirMes,
    errorSupervisores,
    recargarSupervisores,
    errorPeriodos,
    recargarPeriodos,
    errorMeses,
    recargarMeses,
  } = useNovedades();
  const elegido = periodos.find((p) => p.code === periodo);
  const mesElegido = meses.find((m) => m.code === mes);

  return (
    <>
      <div className="gh-alcance" role="group" aria-label="Qué se está viendo">
        {eligeSupervisor && (
          <div className="mz-campo">
            <label className="form-label" htmlFor={`${idBase}-supervisor`}>
              Supervisor
            </label>
            <select
              id={`${idBase}-supervisor`}
              className="form-select form-select-sm"
              value={supervisorId ?? ""}
              onChange={(e) =>
                elegirSupervisor(e.target.value ? Number(e.target.value) : null)
              }
            >
              {me.national_read && todos && (
                <option value="">Todos los supervisores</option>
              )}
              {!me.national_read && supervisorId === null && (
                <option value="">Seleccione un supervisor</option>
              )}
              {supervisores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {tipo === "periodo" && (
          <div className="mz-campo">
            <label className="form-label" htmlFor={`${idBase}-periodo`}>
              Período (del 23 al 22)
            </label>
            <select
              id={`${idBase}-periodo`}
              className="form-select form-select-sm"
              value={periodo ?? ""}
              onChange={(e) => elegirPeriodo(e.target.value)}
            >
              {!periodos.some((p) => p.code === periodo) && periodo && (
                <option value={periodo}>{periodo}</option>
              )}
              {periodos.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                  {p.status === "CLOSED"
                    ? " · cerrado"
                    : p.status === "OPEN"
                      ? " · abierto"
                      : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        {tipo === "mes" && (
          <div className="mz-campo">
            <label className="form-label" htmlFor={`${idBase}-mes`}>
              Mes de horas extras
            </label>
            <select
              id={`${idBase}-mes`}
              className="form-select form-select-sm"
              value={mes ?? ""}
              onChange={(e) => elegirMes(e.target.value)}
            >
              {!meses.some((m) => m.code === mes) && mes && (
                <option value={mes}>{mes}</option>
              )}
              {meses.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label} · {ESTADO_MES[m.status] ?? m.status}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      {eligeSupervisor && errorSupervisores && (
        <EstadoDeCarga
          error={errorSupervisores}
          onReintentar={recargarSupervisores}
        />
      )}
      {tipo === "periodo" && errorPeriodos && (
        <EstadoDeCarga error={errorPeriodos} onReintentar={recargarPeriodos} />
      )}
      {tipo === "mes" && errorMeses && (
        <EstadoDeCarga error={errorMeses} onReintentar={recargarMeses} />
      )}
      {tipo === "periodo" && elegido && (
        <p className="gh-corte mz-small mz-faint">
          Corte: del {fecha(elegido.start_date)} al {fecha(elegido.end_date)}.
        </p>
      )}
      {tipo === "mes" && mesElegido && (
        <p className="gh-corte mz-small mz-faint">
          Mes calendario: del {fecha(mesElegido.start_date)} al{" "}
          {fecha(mesElegido.end_date)}.
        </p>
      )}
    </>
  );
}
