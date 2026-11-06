/*
 * El marco de Reuniones (listado y detalle): qué puede la persona en el
 * módulo (`GET reuniones/me/`: crear, administrar, los estados y los límites
 * de cada campo). Se conserva al pasar del listado al detalle.
 *
 * Nada de esto es la barrera de seguridad: el servidor vuelve a autorizar
 * cada petición.
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

import {
  errorDeReuniones,
  reunionesService,
} from "../../../api/reunionesService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { Encabezado } from "../Tareas/ContextoTareas";
import { ESTADOS, LIMITES_POR_DEFECTO } from "./reunionesComunes";
import "../GestionHumana.css";
import "../Tareas/Tareas.css";
import "./Reuniones.css";

const Contexto = createContext(null);

export function ProveedorReuniones({ children }) {
  const [me, setMe] = useState(null);
  const [estado, setEstado] = useState("cargando");
  const [error, setError] = useState(null);

  const cargar = useCallback(() => {
    setEstado("cargando");
    setError(null);
    reunionesService
      .yo()
      .then((datos) => {
        setMe(datos);
        setEstado("listo");
      })
      .catch((err) => {
        const e = errorDeReuniones(err, "No se pudo cargar Reuniones.");
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
      puedeCrear: Boolean(me?.can_create),
      puedeAdministrar: Boolean(me?.can_manage),
      // Las etiquetas del servidor, con el ícono y el tono de aquí.
      estados: ESTADOS.map((e) => ({
        ...e,
        texto: me?.statuses?.find((s) => s.value === e.id)?.label ?? e.texto,
      })),
      limites: { ...LIMITES_POR_DEFECTO, ...(me?.limits ?? {}) },
    }),
    [me, estado, error, cargar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function MarcoReuniones() {
  return (
    <ProveedorReuniones>
      <Suspense fallback={<EstadoDeCarga cargando />}>
        <Outlet />
      </Suspense>
    </ProveedorReuniones>
  );
}

export function useReuniones() {
  const contexto = useContext(Contexto);
  if (!contexto)
    throw new Error("useReuniones debe usarse dentro de <ProveedorReuniones>.");
  return contexto;
}

/** Cargando, error con reintento o «sin acceso» mientras se sabe qué puede
 * la persona; después, el contenido. */
export function ConAccesoReuniones({ titulo, children }) {
  const { me, estado, error, recargar } = useReuniones();
  if (estado === "listo" && me) return children;
  return (
    <div className="gh-page">
      <Encabezado titulo={titulo} />
      {estado === "sin_acceso" ? (
        <div className="mz-alert mz-alert--warn" role="alert">
          <Icon name="shield-lock" />
          <span>
            {error ||
              "No tiene acceso a Reuniones. Si lo necesita, solicítelo al Administrador de Gestión Humana."}
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
