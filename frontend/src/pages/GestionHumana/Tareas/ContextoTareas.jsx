/*
 * El marco de Tareas y Equipo: quién es la persona en el módulo
 * (`GET tasks/me/`: permisos efectivos, roles de Gestión Humana, si tiene
 * cargo y equipo en el organigrama) y el catálogo de motivos de registro de
 * horas, que comparten el panel de actividades, el registro retroactivo y
 * los ajustes.
 *
 * Nada de esto es la barrera de seguridad: el servidor vuelve a autorizar
 * cada petición (permisos del catálogo y ámbito por el organigrama).
 */
import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Outlet } from "react-router-dom";

import { errorDeTareas, tareasService } from "../../../api/tareasService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { useAuth } from "../../../hooks/useAuth";
import "../GestionHumana.css";
import "./Tareas.css";

const Contexto = createContext(null);

export function ProveedorTareas({ children }) {
  const { user } = useAuth();
  const [me, setMe] = useState(null);
  const [estado, setEstado] = useState("cargando");
  const [error, setError] = useState(null);
  const [motivos, setMotivos] = useState(null);
  const [errorMotivos, setErrorMotivos] = useState(null);
  const pidiendoMotivos = useRef(false);

  const cargar = useCallback(() => {
    setEstado("cargando");
    setError(null);
    tareasService
      .yo()
      .then((datos) => {
        setMe(datos);
        setEstado("listo");
      })
      .catch((err) => {
        const e = errorDeTareas(err, "No se pudo cargar el módulo de tareas.");
        setError(e.mensaje);
        setEstado(e.estado === 403 ? "sin_acceso" : "error");
      });
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const cargarMotivos = useCallback(() => {
    if (pidiendoMotivos.current) return;
    pidiendoMotivos.current = true;
    setErrorMotivos(null);
    tareasService
      .motivos()
      .then((lista) => setMotivos(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setErrorMotivos(
          errorDeTareas(err, "No se pudieron cargar los motivos.").mensaje,
        ),
      )
      .finally(() => {
        pidiendoMotivos.current = false;
      });
  }, []);

  const valor = useMemo(
    () => ({
      me,
      estado,
      error,
      recargar: cargar,
      usuarioId: user?.id ?? null,
      can: (codigo) => Boolean(me?.permissions?.includes(codigo)),
      roles: me?.roles ?? [],
      motivos,
      errorMotivos,
      /** Pide el catálogo la primera vez que una pantalla lo necesita. */
      asegurarMotivos: () => {
        if (motivos === null) cargarMotivos();
      },
      recargarMotivos: cargarMotivos,
      fijarMotivos: setMotivos,
    }),
    [me, estado, error, cargar, user?.id, motivos, errorMotivos, cargarMotivos],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** El marco de las rutas de Tareas y Equipo. Las pantallas se cargan bajo
 * demanda: mientras llega una, «Cargando…» dentro del marco (el proveedor no
 * se desmonta y no vuelve a pedir `tasks/me/`). */
export function MarcoTareas() {
  return (
    <ProveedorTareas>
      <Suspense fallback={<EstadoDeCarga cargando />}>
        <Outlet />
      </Suspense>
    </ProveedorTareas>
  );
}

export function useTareas() {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error("useTareas debe usarse dentro de <ProveedorTareas>.");
  }
  return contexto;
}

/** El catálogo de motivos, pedido al montar quien lo usa. */
export function useMotivos() {
  const { motivos, errorMotivos, asegurarMotivos, recargarMotivos } =
    useTareas();
  useEffect(() => {
    asegurarMotivos();
    // Solo al montar: el catálogo se comparte entre pantallas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { motivos, errorMotivos, recargarMotivos };
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
 * Lo que cada pantalla muestra mientras se sabe quién es la persona en el
 * módulo: cargando, error con reintento, «sin acceso» (403) o falta de un
 * permiso propio de la pantalla; después, el contenido.
 */
export function ConAccesoTareas({ titulo, permiso, children }) {
  const { me, estado, error, recargar, can } = useTareas();
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
              : "No tiene acceso a esta pantalla de Tareas. Si lo necesita, solicítelo al Administrador de Gestión Humana."}
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
