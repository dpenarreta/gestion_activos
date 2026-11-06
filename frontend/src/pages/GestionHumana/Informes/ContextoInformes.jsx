/*
 * El marco de Informes ejecutivos (listado y visor): qué puede la persona en
 * Informes (`GET informes/me/`: permisos efectivos, si tiene alcance
 * completo y su `scope`). Se conserva al pasar del listado al visor.
 *
 * Nada de esto es la barrera de seguridad: el servidor vuelve a autorizar
 * cada petición (`informes_gh.*` y el ámbito por el organigrama).
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

import { errorDeInformes, informesService } from "../../../api/informesService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  INFORMES_ADMINISTRAR,
  INFORMES_GENERAR,
  PERMISOS_INFORMES,
} from "../../../modulos/permisosGestionHumana";
import { Encabezado } from "../Tareas/ContextoTareas";
import "../GestionHumana.css";
import "../Tareas/Tareas.css";
import "../Desempeno/Desempeno.css";
import "./Informes.css";

const Contexto = createContext(null);

export function ProveedorInformes({ children }) {
  const [me, setMe] = useState(null);
  const [estado, setEstado] = useState("cargando");
  const [error, setError] = useState(null);

  const cargar = useCallback(() => {
    setEstado("cargando");
    setError(null);
    informesService
      .yo()
      .then((datos) => {
        setMe(datos);
        setEstado("listo");
      })
      .catch((err) => {
        const e = errorDeInformes(
          err,
          "No se pudo cargar el módulo de informes.",
        );
        setError(e.mensaje);
        setEstado(e.estado === 403 ? "sin_acceso" : "error");
      });
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const valor = useMemo(() => {
    const can = (codigo) => Boolean(me?.permissions?.includes(codigo));
    return {
      me,
      estado,
      error,
      recargar: cargar,
      can,
      puedeGenerar: can(INFORMES_GENERAR) || can(INFORMES_ADMINISTRAR),
      puedeAdministrar: can(INFORMES_ADMINISTRAR),
      alcanceCompleto: Boolean(me?.alcance_completo),
    };
  }, [me, estado, error, cargar]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function MarcoInformes() {
  return (
    <ProveedorInformes>
      <Suspense fallback={<EstadoDeCarga cargando />}>
        <Outlet />
      </Suspense>
    </ProveedorInformes>
  );
}

export function useInformes() {
  const contexto = useContext(Contexto);
  if (!contexto)
    throw new Error("useInformes debe usarse dentro de <ProveedorInformes>.");
  return contexto;
}

/**
 * Cargando, error con reintento o «sin acceso» mientras se sabe qué puede la
 * persona en Informes; después, el contenido. Basta uno de los tres permisos.
 */
export function ConAccesoInformes({ titulo, children }) {
  const { me, estado, error, recargar, can } = useInformes();
  if (estado === "listo" && me && PERMISOS_INFORMES.some((p) => can(p)))
    return children;
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
              : "No tiene acceso a los informes ejecutivos. Si lo necesita, solicítelo al Administrador de Gestión Humana."}
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
