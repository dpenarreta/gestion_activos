/*
 * El marco de Desempeño (Mis KPI, KPI del equipo, Resumen ejecutivo,
 * Inteligencia preventiva y Ajustes de KPI): quién es la persona en el motor
 * (`GET analytics/me/`: permisos efectivos, rol de Gestión Humana, tamaño de
 * su equipo según el organigrama).
 *
 * Nada de esto es la barrera de seguridad: el servidor vuelve a autorizar
 * cada petición (permisos `kpi.*` e `inteligencia_preventiva.ver`, y el
 * ámbito por el organigrama).
 */
import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Outlet } from "react-router-dom";

import { errorDeKpi, kpiService } from "../../../api/kpiService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { Encabezado } from "../Tareas/ContextoTareas";
import { esDeDireccion } from "./kpiComunes";
import "../GestionHumana.css";
import "../Tareas/Tareas.css";
import "./Desempeno.css";

const Contexto = createContext(null);

export function ProveedorKpi({ children }) {
  const [me, setMe] = useState(null);
  const [estado, setEstado] = useState("cargando");
  const [error, setError] = useState(null);

  const cargar = useCallback(() => {
    setEstado("cargando");
    setError(null);
    kpiService
      .yo()
      .then((datos) => {
        setMe(datos);
        setEstado("listo");
      })
      .catch((err) => {
        const e = errorDeKpi(err, "No se pudo cargar el módulo de KPI.");
        setError(e.mensaje);
        setEstado(e.estado === 403 ? "sin_acceso" : "error");
      });
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const valor = useMemo(
    () => ({
      me,
      estado,
      error,
      recargar: cargar,
      usuarioId: me?.user_id ?? null,
      can: (codigo) => Boolean(me?.permissions?.includes(codigo)),
      /** Dirección: sus indicadores individuales no son representativos. */
      esDireccion: esDeDireccion(me?.role),
    }),
    [me, estado, error, cargar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function MarcoKpi() {
  return (
    <ProveedorKpi>
      <Suspense fallback={<EstadoDeCarga cargando />}>
        <Outlet />
      </Suspense>
    </ProveedorKpi>
  );
}

export function useKpi() {
  const contexto = useContext(Contexto);
  if (!contexto)
    throw new Error("useKpi debe usarse dentro de <ProveedorKpi>.");
  return contexto;
}

/**
 * Cargando, error con reintento, «sin acceso» (403) o falta del permiso de
 * la pantalla mientras se sabe quién es la persona; después, el contenido.
 * `permiso`: un código o una lista (basta uno).
 */
export function ConAccesoKpi({ titulo, permiso, children }) {
  const { me, estado, error, recargar, can } = useKpi();
  if (estado === "listo" && me) {
    const pedidos = permiso ? [].concat(permiso) : [];
    if (!pedidos.length || pedidos.some((p) => can(p))) return children;
  }
  const sinAcceso = estado === "sin_acceso" || estado === "listo";
  return (
    <div className="gh-page">
      <Encabezado titulo={titulo} />
      {sinAcceso ? (
        <div className="mz-alert mz-alert--warn" role="alert">
          <Icon name="shield-lock" />
          <span>
            {estado === "sin_acceso" && error
              ? error
              : "No tiene acceso a esta pantalla de Desempeño. Si lo necesita, solicítelo al Administrador de Gestión Humana."}
          </span>
        </div>
      ) : (
        <EstadoDeCarga
          cargando={estado === "cargando"}
          error={estado === "error" ? error : null}
          onReintentar={recargar}
        />
      )}
    </div>
  );
}

/** Carga de una sección: llama a `pedir` al montar y cuando cambian sus
 * dependencias, sin sondeo. Devuelve `{ datos, error, cargando, recargar }`. */
export function useCarga(
  pedir,
  dependencias,
  porDefecto = "No se pudo cargar.",
) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [vez, setVez] = useState(0);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    setError(null);
    Promise.resolve()
      .then(pedir)
      .then((d) => {
        if (vigente) setDatos(d);
      })
      .catch((err) => {
        if (vigente) {
          setDatos(null);
          setError(errorDeKpi(err, porDefecto).mensaje);
        }
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
    // `pedir` cambia en cada render: lo que manda son las dependencias.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencias, vez]);

  return {
    datos,
    error,
    cargando,
    recargar: () => setVez((v) => v + 1),
  };
}
