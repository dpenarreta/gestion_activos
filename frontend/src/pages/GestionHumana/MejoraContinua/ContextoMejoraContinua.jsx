/*
 * El marco de Mejora continua (tablero y detalle): qué puede la persona en el
 * módulo (`GET mejora-continua/me/`: proponer, votar, gestionar, si ve todas,
 * su insignia «innovador» y las reglas del adjunto). Se conserva al pasar
 * del tablero al detalle.
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
  errorDeMejora,
  mejoraContinuaService,
} from "../../../api/mejoraContinuaService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import { Encabezado } from "../Tareas/ContextoTareas";
import { ADJUNTO_POR_DEFECTO } from "./mejoraComunes";
import "../GestionHumana.css";
import "../Tareas/Tareas.css";
import "./MejoraContinua.css";

const Contexto = createContext(null);

export function ProveedorMejoraContinua({ children }) {
  const [me, setMe] = useState(null);
  const [estado, setEstado] = useState("cargando");
  const [error, setError] = useState(null);

  const cargar = useCallback(() => {
    setEstado("cargando");
    setError(null);
    mejoraContinuaService
      .yo()
      .then((datos) => {
        setMe(datos);
        setEstado("listo");
      })
      .catch((err) => {
        const e = errorDeMejora(err, "No se pudo cargar Mejora continua.");
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
      puedeProponer: Boolean(me?.can_propose),
      puedeVotar: Boolean(me?.can_vote),
      puedeGestionar: Boolean(me?.can_manage),
      veTodas: Boolean(me?.sees_all),
      reglasAdjunto: me?.attachment ?? ADJUNTO_POR_DEFECTO,
    }),
    [me, estado, error, cargar],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function MarcoMejoraContinua() {
  return (
    <ProveedorMejoraContinua>
      <Suspense fallback={<EstadoDeCarga cargando />}>
        <Outlet />
      </Suspense>
    </ProveedorMejoraContinua>
  );
}

export function useMejoraContinua() {
  const contexto = useContext(Contexto);
  if (!contexto)
    throw new Error(
      "useMejoraContinua debe usarse dentro de <ProveedorMejoraContinua>.",
    );
  return contexto;
}

/** Cargando, error con reintento o «sin acceso» mientras se sabe qué puede
 * la persona; después, el contenido. */
export function ConAccesoMejora({ titulo, children }) {
  const { me, estado, error, recargar } = useMejoraContinua();
  if (estado === "listo" && me) return children;
  return (
    <div className="gh-page">
      <Encabezado titulo={titulo} />
      {estado === "sin_acceso" ? (
        <div className="mz-alert mz-alert--warn" role="alert">
          <Icon name="shield-lock" />
          <span>
            {error ||
              "No tiene acceso a Mejora continua. Si lo necesita, solicítelo al Administrador de Gestión Humana."}
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
