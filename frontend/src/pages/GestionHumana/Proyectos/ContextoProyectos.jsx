/*
 * El marco de Proyectos: qué puede la persona en el módulo
 * (`GET projects/me/`: permisos efectivos, si crea, supervisa o administra) y
 * a quién puede elegir como responsable o participante
 * (`GET projects/members/`, pedido la primera vez que hace falta).
 *
 * Nada de esto es la barrera de seguridad: el servidor vuelve a autorizar
 * cada petición y, por proyecto, decide quién lo gestiona, quién participa y
 * quién lo envía a la papelera (`can_manage`, `can_participate`,
 * `can_delete` del detalle).
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

import {
  errorDeProyectos,
  proyectosGhService,
} from "../../../api/proyectosGhService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { useAuth } from "../../../hooks/useAuth";
import { Encabezado } from "../Tareas/ContextoTareas";
import "../GestionHumana.css";
import "../Tareas/Tareas.css";
import "./Proyectos.css";

const Contexto = createContext(null);

export function ProveedorProyectos({ children }) {
  const { user } = useAuth();
  const [me, setMe] = useState(null);
  const [estado, setEstado] = useState("cargando");
  const [error, setError] = useState(null);
  const [miembros, setMiembros] = useState(null);
  const [errorMiembros, setErrorMiembros] = useState(null);
  const pidiendoMiembros = useRef(false);

  const cargar = useCallback(() => {
    setEstado("cargando");
    setError(null);
    proyectosGhService
      .yo()
      .then((datos) => {
        setMe(datos);
        setEstado("listo");
      })
      .catch((err) => {
        const e = errorDeProyectos(
          err,
          "No se pudo cargar el módulo de proyectos.",
        );
        setError(e.mensaje);
        setEstado(e.estado === 403 ? "sin_acceso" : "error");
      });
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const cargarMiembros = useCallback(() => {
    if (pidiendoMiembros.current) return;
    pidiendoMiembros.current = true;
    setErrorMiembros(null);
    proyectosGhService
      .miembros()
      .then((lista) => setMiembros(Array.isArray(lista) ? lista : []))
      .catch((err) =>
        setErrorMiembros(
          errorDeProyectos(err, "No se pudo cargar a quién puede elegir.")
            .mensaje,
        ),
      )
      .finally(() => {
        pidiendoMiembros.current = false;
      });
  }, []);

  const valor = useMemo(
    () => ({
      me,
      estado,
      error,
      recargar: cargar,
      usuarioId: user?.id ?? null,
      puedeCrear: Boolean(me?.can_create),
      miembros,
      errorMiembros,
      asegurarMiembros: () => {
        if (miembros === null) cargarMiembros();
      },
      recargarMiembros: cargarMiembros,
    }),
    [
      me,
      estado,
      error,
      cargar,
      user?.id,
      miembros,
      errorMiembros,
      cargarMiembros,
    ],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** El marco de las rutas de Proyectos: el proveedor no se desmonta al pasar
 * del listado a un proyecto (no vuelve a pedir `projects/me/`). */
export function MarcoProyectos() {
  return (
    <ProveedorProyectos>
      <Suspense fallback={<EstadoDeCarga cargando />}>
        <Outlet />
      </Suspense>
    </ProveedorProyectos>
  );
}

export function useProyectos() {
  const contexto = useContext(Contexto);
  if (!contexto) {
    throw new Error("useProyectos debe usarse dentro de <ProveedorProyectos>.");
  }
  return contexto;
}

/** A quién se puede elegir, pedido al montar quien lo usa. */
export function useMiembros() {
  const { miembros, errorMiembros, asegurarMiembros, recargarMiembros } =
    useProyectos();
  useEffect(() => {
    asegurarMiembros();
    // Solo al montar: la lista se comparte entre pantallas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { miembros, errorMiembros, recargarMiembros };
}

/** Cargando, error con reintento o «sin acceso» mientras se sabe qué puede
 * la persona en el módulo; después, el contenido. */
export function ConAccesoProyectos({ titulo, children }) {
  const { me, estado, error, recargar } = useProyectos();
  if (estado === "listo" && me) return children;
  return (
    <div className="gh-page">
      <Encabezado titulo={titulo} />
      {estado === "sin_acceso" ? (
        <div className="mz-alert mz-alert--warn" role="alert">
          <Icon name="shield-lock" />
          <span>
            {error ||
              "No tiene acceso a Proyectos. Si lo necesita, solicítelo al Administrador de Gestión Humana."}
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
