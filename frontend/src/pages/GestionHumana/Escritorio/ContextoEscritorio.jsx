/*
 * El marco del Escritorio: qué puede la persona (`GET escritorio/me/`:
 * convertir en tarea, los ajustes del módulo, las reglas del adjunto y las
 * opciones con su etiqueta) y cuántas notas tiene sin leer, que también
 * muestra la insignia del menú.
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
  errorDeEscritorio,
  escritorioService,
} from "../../../api/escritorioService";
import { EstadoDeCarga } from "../../../components/common/EstadoDeCarga/EstadoDeCarga";
import { Icon } from "../../../components/common/Icon/Icon";
import {
  EVENTO_INSIGNIAS,
  avisarCambioDeInsignias,
} from "../../../utils/insigniasDelMenu";
import { ADJUNTO_POR_DEFECTO } from "../MejoraContinua/mejoraComunes";
import { Encabezado } from "../Tareas/ContextoTareas";
import {
  AJUSTES_POR_DEFECTO,
  ESTADOS_RECORDATORIO,
  PRIORIDADES_NOTA,
  PRIORIDADES_RECORDATORIO,
  REPETICIONES,
  COLORES,
  conEtiquetas,
} from "./escritorioComunes";
import "../GestionHumana.css";
import "../Tareas/Tareas.css";
import "./Escritorio.css";

const Contexto = createContext(null);

/** El mismo intervalo que las insignias del menú (`AdminSidebar`). */
const REFRESCO_MS = 60_000;

export function ProveedorEscritorio({ children }) {
  const [me, setMe] = useState(null);
  const [estado, setEstado] = useState("cargando");
  const [error, setError] = useState(null);
  const [sinLeer, setSinLeer] = useState(0);

  const cargar = useCallback(() => {
    setEstado("cargando");
    setError(null);
    escritorioService
      .yo()
      .then((datos) => {
        setMe(datos);
        setSinLeer(datos?.unread_notes ?? 0);
        setEstado("listo");
      })
      .catch((err) => {
        const e = errorDeEscritorio(err, "No se pudo cargar el Escritorio.");
        setError(e.mensaje);
        setEstado(e.estado === 403 ? "sin_acceso" : "error");
      });
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /** Pide al servidor cuántas notas hay sin leer. Si falla, se queda el
   * número anterior (no es crítico). */
  const pedirSinLeer = useCallback(() => {
    escritorioService
      .sinLeer()
      .then((d) => setSinLeer(d?.unread ?? 0))
      .catch(() => {});
  }, []);

  /** Tras leer, archivar o eliminar una nota: el aviso pone al día el menú
   * y, con el oyente de abajo, la pestaña (una sola petición aquí). */
  const refrescarSinLeer = useCallback(() => avisarCambioDeInsignias(), []);

  // La pestaña «Notas» cuenta lo mismo que la insignia del menú: se pone al
  // día con su mismo sondeo (cada minuto) y cuando otra pantalla avisa.
  useEffect(() => {
    if (estado !== "listo") return undefined;
    const intervalo = setInterval(pedirSinLeer, REFRESCO_MS);
    window.addEventListener(EVENTO_INSIGNIAS, pedirSinLeer);
    return () => {
      clearInterval(intervalo);
      window.removeEventListener(EVENTO_INSIGNIAS, pedirSinLeer);
    };
  }, [estado, pedirSinLeer]);

  const valor = useMemo(() => {
    const opciones = me?.choices ?? {};
    return {
      me,
      estado,
      error,
      recargar: cargar,
      usuarioId: me?.user_id ?? null,
      puedeConvertirEnTarea: Boolean(me?.can_convert_to_task),
      ajustes: { ...AJUSTES_POR_DEFECTO, ...(me?.settings ?? {}) },
      reglasAdjunto: me?.attachment ?? ADJUNTO_POR_DEFECTO,
      prioridadesNota: conEtiquetas(PRIORIDADES_NOTA, opciones.note_priority),
      colores: conEtiquetas(COLORES, opciones.note_color),
      prioridadesRecordatorio: conEtiquetas(
        PRIORIDADES_RECORDATORIO,
        opciones.reminder_priority,
      ),
      estadosRecordatorio: conEtiquetas(
        ESTADOS_RECORDATORIO,
        opciones.reminder_status,
      ),
      repeticiones: conEtiquetas(REPETICIONES, opciones.reminder_repeat),
      sinLeer,
      refrescarSinLeer,
    };
  }, [me, estado, error, cargar, sinLeer, refrescarSinLeer]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function MarcoEscritorio() {
  return (
    <ProveedorEscritorio>
      <Suspense fallback={<EstadoDeCarga cargando />}>
        <Outlet />
      </Suspense>
    </ProveedorEscritorio>
  );
}

export function useEscritorio() {
  const contexto = useContext(Contexto);
  if (!contexto)
    throw new Error(
      "useEscritorio debe usarse dentro de <ProveedorEscritorio>.",
    );
  return contexto;
}

/** Cargando, error con reintento o «sin acceso» mientras se sabe qué puede
 * la persona; después, el contenido. */
export function ConAccesoEscritorio({ titulo, children }) {
  const { me, estado, error, recargar } = useEscritorio();
  if (estado === "listo" && me) return children;
  return (
    <div className="gh-page">
      <Encabezado titulo={titulo} />
      {estado === "sin_acceso" ? (
        <div className="mz-alert mz-alert--warn" role="alert">
          <Icon name="shield-lock" />
          <span>
            {error ||
              "No tiene acceso al Escritorio. Si lo necesita, solicítelo al Administrador de Gestión Humana."}
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
