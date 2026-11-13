import * as Notifications from "expo-notifications";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { soporteService } from "../api/servicios";
import { useSesion } from "../sesion/SesionContext";
import { esDelEquipo, pendientesParaHoy } from "./formato";

/**
 * Lo pendiente de la Mesa de ayuda para el Inicio («Para hoy», CA-2) y para
 * saber qué vistas mostrar (CA-1), en toda la parte autenticada (US-014,
 * 13/11/2026):
 *
 * - `noEsDelEquipo` (US-016, 13/11/2026): `bandeja/` respondió 403 en esta
 *   empresa. La barra de la Mesa quita «Bandeja» y «Registrar»; la Mesa lo
 *   informa con `marcarNoEsDelEquipo` y el resumen, al pedir la bandeja. Se
 *   vuelve a comprobar al cambiar de empresa (G-9).
 * - `misPendientes`: los tickets propios que piden algo de la persona, sin la
 *   encuesta de uno cerrado (G-5, `GET mis-tickets/`).
 * - `aprobaciones`: lo que espera su visto bueno (`GET aprobaciones/`).
 * - `asignados`: los que tiene a su cargo y necesitan acción (asignados o en
 *   curso: `tecnico.abiertos` de `GET tickets/bandeja/`).
 *
 * La bandeja solo se pide si los permisos de la sesión dicen que es del
 * equipo: así quien no lo es no deja un 403 en la auditoría. Un 403 (no es
 * del equipo o el módulo está apagado) no es un error visible: deja el número
 * en cero.
 *
 * Ronda 1 de QA (T1):
 * - se recarga al entrar, al cambiar de empresa, al volver la app al frente y
 *   con los push del módulo `soporte`; los que llegan seguidos y la vuelta al
 *   frente se juntan en una sola recarga (`ESPERA_AGRUPAR_MS`);
 * - si los números no cambian, el valor es el mismo objeto y nadie se vuelve
 *   a pintar;
 * - `recargar` e `informarMisTickets` van en otro contexto, estable: las
 *   fichas y las altas no se vuelven a pintar cuando cambian los números;
 * - «Mis tickets» le pasa lo que ya cargó (`informarMisTickets`) y su
 *   refresco pide el resto sin repetir `mis-tickets/`.
 */
export const ESPERA_AGRUPAR_MS = 1000;

const VACIO = { misPendientes: 0, aprobaciones: 0, asignados: 0 };

const ResumenSoporteContext = createContext({ ...VACIO, delEquipo: false, noEsDelEquipo: false });
const AccionesSoporteContext = createContext({
  recargar: async () => {},
  informarMisTickets: () => {},
  marcarNoEsDelEquipo: () => {},
});

/** Lo que deja `bandeja/` cuando responde 403: no es del equipo. */
const SIN_BANDEJA = Symbol("sin-bandeja");

function mismos(a, b) {
  return a.misPendientes === b.misPendientes && a.aprobaciones === b.aprobaciones && a.asignados === b.asignados;
}

export function ResumenSoporteProvider({ children }) {
  const { usuario, versionEmpresa } = useSesion();
  const delEquipo = esDelEquipo(usuario?.permissions ?? []);
  const [numeros, setNumeros] = useState(VACIO);
  const [noEsDelEquipo, setNoEsDelEquipo] = useState(false);
  const montado = useRef(true);
  const consulta = useRef(0);
  const delEquipoRef = useRef(delEquipo);
  delEquipoRef.current = delEquipo;
  const programada = useRef(null);

  const fijar = useCallback((cambios) => {
    setNumeros((actual) => {
      const nuevo = { ...actual, ...cambios };
      return mismos(actual, nuevo) ? actual : nuevo;
    });
  }, []);

  /** `sinMisTickets`: quien llama ya los tiene (los informa aparte). */
  const recargar = useCallback(
    async ({ sinMisTickets = false } = {}) => {
      const numero = ++consulta.current;
      const [mios, aprobaciones, bandeja] = await Promise.all([
        sinMisTickets ? Promise.resolve(undefined) : soporteService.misTickets().catch(() => null),
        soporteService.aprobaciones().catch(() => null),
        delEquipoRef.current
          ? soporteService.bandeja().catch((e) => (e?.response?.status === 403 ? SIN_BANDEJA : null))
          : Promise.resolve(null),
      ]);
      if (!montado.current || numero !== consulta.current) return;
      if (bandeja === SIN_BANDEJA) setNoEsDelEquipo(true);
      const cambios = {
        aprobaciones: Array.isArray(aprobaciones) ? aprobaciones.length : 0,
        asignados: bandeja === SIN_BANDEJA ? 0 : Math.max(0, Number(bandeja?.tecnico?.abiertos) || 0),
      };
      if (mios !== undefined) cambios.misPendientes = Array.isArray(mios) ? pendientesParaHoy(mios) : 0;
      fijar(cambios);
    },
    [fijar],
  );

  const informarMisTickets = useCallback(
    (lista) => {
      if (Array.isArray(lista)) fijar({ misPendientes: pendientesParaHoy(lista) });
    },
    [fijar],
  );

  const marcarNoEsDelEquipo = useCallback(() => setNoEsDelEquipo(true), []);

  /** Una recarga que junta lo que llega seguido. */
  const programar = useCallback(() => {
    if (programada.current) clearTimeout(programada.current);
    programada.current = setTimeout(() => {
      programada.current = null;
      recargar();
    }, ESPERA_AGRUPAR_MS);
  }, [recargar]);

  useEffect(() => {
    montado.current = true;
    setNumeros(VACIO);
    setNoEsDelEquipo(false);
    recargar();
    const suscripcionApp = AppState.addEventListener("change", (estado) => {
      if (estado === "active") programar();
    });
    // Solo los push de la Mesa de ayuda cambian estos números.
    const suscripcionPush = Notifications.addNotificationReceivedListener((aviso) => {
      if (aviso?.request?.content?.data?.modulo === "soporte") programar();
    });
    return () => {
      montado.current = false;
      if (programada.current) clearTimeout(programada.current);
      programada.current = null;
      suscripcionApp.remove();
      suscripcionPush.remove();
    };
  }, [recargar, programar, versionEmpresa, delEquipo]);

  const valor = useMemo(() => ({ ...numeros, delEquipo, noEsDelEquipo }), [numeros, delEquipo, noEsDelEquipo]);
  const acciones = useMemo(
    () => ({ recargar, informarMisTickets, marcarNoEsDelEquipo }),
    [recargar, informarMisTickets, marcarNoEsDelEquipo],
  );
  return (
    <AccionesSoporteContext.Provider value={acciones}>
      <ResumenSoporteContext.Provider value={valor}>{children}</ResumenSoporteContext.Provider>
    </AccionesSoporteContext.Provider>
  );
}

/** Los números (se vuelve a pintar cuando cambian). */
export function useResumenSoporte() {
  return useContext(ResumenSoporteContext);
}

/** `{recargar, informarMisTickets, marcarNoEsDelEquipo}`, estables: para quien solo avisa. */
export function useRecargarResumenSoporte() {
  return useContext(AccionesSoporteContext);
}
