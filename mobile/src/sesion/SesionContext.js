import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { almacen } from "../api/almacen";
import { escucharSesion } from "../api/api";
import { authService, empresasService } from "../api/servicios";
import { darDeBajaDispositivo, registrarDispositivo } from "../notificaciones/push";
import { borrarDocumentosDescargados } from "../permisos/documentos";
import {
  dejarDeRecibirPushLocalmente,
  guardarCierrePendiente,
  procesarCierrePendiente,
} from "./cierrePendiente";

/**
 * La sesión de la app, que se comporta igual que la de la web (US-009,
 * decisión del usuario del 12/11/2026): 4 h sin uso y refresh de 7 días, los
 * dos controlados por el backend. Sin biometría.
 *
 * `estado`: `cargando` (leyendo el almacén al abrir), `sin_conexion` (había
 * sesión pero no se pudo comprobar), `anonimo` o `autenticado`.
 */
export const AVISO_SESION_TERMINADA = "Su sesión terminó; inicie sesión de nuevo.";
export const AVISO_CIERRE_SIN_SERVIDOR =
  "No se pudo cerrar la sesión en el servidor; ciérrela desde Sesiones en la web.";

const SesionContext = createContext(null);

export function SesionProvider({ children }) {
  const [estado, setEstado] = useState("cargando");
  const [usuario, setUsuario] = useState(null);
  const [empresas, setEmpresas] = useState({ empresas: [], activa: null });
  const [aviso, setAviso] = useState(null);
  // Sube cada vez que cambia la empresa: las pantallas la usan como
  // dependencia para volver a pedir sus datos (CA-13).
  const [versionEmpresa, setVersionEmpresa] = useState(0);
  const montado = useRef(true);
  // Mientras la persona cierra la sesión a mano, un 401 al renovar no es «su
  // sesión terminó»: la está cerrando ella (revisión de QA, 12/11/2026).
  const cierreManual = useRef(false);
  const empresasRef = useRef(empresas);
  empresasRef.current = empresas;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargarEmpresas = useCallback(async () => {
    try {
      const datos = await empresasService.mias();
      // El backend manda: si la empresa guardada ya no es suya, responde con
      // otra activa y esa es la que se usa (igual que el selector web).
      if (datos?.activa && String(datos.activa.id) !== almacen.empresa()) {
        await almacen.guardarEmpresa(datos.activa.id);
      }
      if (montado.current) {
        setEmpresas({
          empresas: Array.isArray(datos?.empresas) ? datos.empresas : [],
          activa: datos?.activa ?? null,
        });
      }
    } catch {
      // Sin la lista no hay selector; el backend usa la predeterminada.
    }
  }, []);

  const recargarUsuario = useCallback(async () => {
    const me = await authService.me();
    if (montado.current) setUsuario(me);
    return me;
  }, []);

  /** Tras entrar o al abrir con sesión: usuario, empresas y push. */
  const prepararSesion = useCallback(
    async ({ pedirPermiso = false } = {}) => {
      await cargarEmpresas();
      await recargarUsuario();
      if (!montado.current) return;
      setEstado("autenticado");
      // Sin esperar: el permiso es una pregunta y no debe frenar la entrada.
      // Solo se pregunta tras iniciar sesión, no en cada arranque. Antes se
      // envía la baja pendiente de un cierre sin red: si fuera después,
      // podría apagar el token que esta sesión acaba de registrar.
      procesarCierrePendiente().finally(() => registrarDispositivo({ pedirPermiso }));
    },
    [cargarEmpresas, recargarUsuario],
  );

  const limpiarEstado = useCallback((avisoFinal) => {
    if (!montado.current) return;
    setUsuario(null);
    setEmpresas({ empresas: [], activa: null });
    setAviso(avisoFinal);
    setEstado("anonimo");
  }, []);

  /** CA-3: el servidor dio la sesión por terminada. Sin renovar. */
  const terminadaPorElServidor = useCallback(
    async ({ accessAnterior } = {}) => {
      if (cierreManual.current) return;
      // Baja del push con el token que había; si la sesión ya está revocada
      // el backend responde 401 y se ignora (CA-12 lo cubre en el servidor).
      try {
        await darDeBajaDispositivo({ sinRenovar: true, access: accessAnterior ?? null });
        await almacen.borrarSesion();
      } finally {
        // US-010: los documentos de permisos descargados no quedan en el
        // teléfono sin sesión, aunque falle lo de arriba.
        borrarDocumentosDescargados();
      }
      limpiarEstado(AVISO_SESION_TERMINADA);
    },
    [limpiarEstado],
  );

  useEffect(
    () =>
      escucharSesion({
        alTerminarSesion: terminadaPorElServidor,
        alExigirCambioDeContrasena: () => {
          recargarUsuario().catch(() => {});
        },
      }),
    [terminadaPorElServidor, recargarUsuario],
  );

  const comprobarSesionGuardada = useCallback(async () => {
    setEstado("cargando");
    try {
      await almacen.cargar();
    } catch {
      // Un almacén ilegible equivale a no tener sesión.
    }
    const { access, refresh } = almacen.tokens();
    if (!access && !refresh) {
      // Sin sesión no debe quedar ningún documento de permisos (la app pudo
      // cerrarse a la fuerza antes de borrarlos).
      borrarDocumentosDescargados();
      if (montado.current) setEstado("anonimo");
      procesarCierrePendiente();
      return;
    }
    try {
      await prepararSesion();
    } catch {
      if (!montado.current) return;
      // Si la sesión terminó, el cliente ya llamó a `terminadaPorElServidor`
      // y no quedan tokens; si no, fue un fallo temporal.
      const { refresh: queda } = almacen.tokens();
      setEstado(queda ? "sin_conexion" : "anonimo");
    }
  }, [prepararSesion]);

  useEffect(() => {
    comprobarSesionGuardada();
  }, [comprobarSesionGuardada]);

  // Al volver la app al frente, si quedó un cierre sin enviar, se reintenta.
  useEffect(() => {
    const suscripcion = AppState.addEventListener("change", (estadoApp) => {
      if (estadoApp === "active" && almacen.cierrePendiente()) procesarCierrePendiente();
    });
    return () => suscripcion.remove();
  }, []);

  const iniciarSesion = useCallback(
    async (identificador, contrasena) => {
      const tokens = await authService.login(identificador.trim(), contrasena);
      await almacen.guardarTokens(tokens.access, tokens.refresh);
      setAviso(null);
      try {
        await prepararSesion({ pedirPermiso: true });
      } catch (error) {
        // Sin el usuario no se puede entrar: se deshace el login local.
        await almacen.borrarSesion();
        if (montado.current) setEstado("anonimo");
        throw error;
      }
    },
    [prepararSesion],
  );

  /**
   * CA-4: baja del push, logout y borrar los datos locales (revisión de QA,
   * 12/11/2026).
   *
   * - La baja puede renovar el access una vez: con el access vencido, sin
   *   renovar, la Session quedaba abierta y el push seguía llegando.
   * - El logout que sigue a una baja va sin renovar: la baja ya dejó un access
   *   vigente si hacía falta, y no se vuelve a renovar. Sin token push no hubo
   *   baja, y entonces es el logout el que puede renovar.
   * - El refresh se lee justo antes del logout: pudo rotar en la baja.
   * - Pase lo que pase, el teléfono queda sin sesión. Si el servidor no se
   *   enteró, se avisa, se deja de recibir push localmente y queda una baja
   *   pendiente (`cierrePendiente.js`).
   */
  const cerrarSesion = useCallback(async () => {
    cierreManual.current = true;
    let avisoFinal = null;
    try {
      const tokenPush = almacen.pushToken();
      const baja = await darDeBajaDispositivo();
      const { access, refresh } = almacen.tokens();
      if (access || refresh) {
        try {
          await authService.logout(refresh, baja === "sin_token" ? undefined : { sinRenovar: true });
        } catch (error) {
          // Un 401 es que la sesión ya estaba cerrada: lo que se buscaba.
          if (error?.response?.status !== 401) {
            avisoFinal = AVISO_CIERRE_SIN_SERVIDOR;
            await guardarCierrePendiente({
              refresh: almacen.tokens().refresh,
              token: baja === "ok" ? null : tokenPush,
            });
            await dejarDeRecibirPushLocalmente();
          }
        }
      }
    } finally {
      try {
        await almacen.borrarSesion();
      } finally {
        borrarDocumentosDescargados();
        cierreManual.current = false;
        limpiarEstado(avisoFinal);
      }
    }
  }, [limpiarEstado]);

  const cambiarEmpresa = useCallback(
    async (id) => {
      if (!id || String(id) === almacen.empresa()) return false;
      await almacen.guardarEmpresa(id);
      await cargarEmpresas();
      // El consentimiento de privacidad es por empresa: se vuelve a leer.
      await recargarUsuario().catch(() => {});
      if (montado.current) setVersionEmpresa((v) => v + 1);
      return true;
    },
    [cargarEmpresas, recargarUsuario],
  );

  /** Si `id` es una empresa de la persona y no la activa, pasa a ella (al
   * abrir un push de otra empresa, decisión B3 del Tech Lead, 12/11/2026). */
  const cambiarEmpresaSiEsSuya = useCallback(
    async (id) => {
      const lista = empresasRef.current.empresas;
      if (!id || !lista.some((e) => String(e.id) === String(id))) return false;
      return cambiarEmpresa(id);
    },
    [cambiarEmpresa],
  );

  const valor = useMemo(
    () => ({
      estado,
      usuario,
      empresas: empresas.empresas,
      empresaActiva: empresas.activa,
      versionEmpresa,
      aviso,
      iniciarSesion,
      cerrarSesion,
      cambiarEmpresa,
      cambiarEmpresaSiEsSuya,
      recargarUsuario,
      reintentar: comprobarSesionGuardada,
    }),
    [
      estado,
      usuario,
      empresas,
      versionEmpresa,
      aviso,
      iniciarSesion,
      cerrarSesion,
      cambiarEmpresa,
      cambiarEmpresaSiEsSuya,
      recargarUsuario,
      comprobarSesionGuardada,
    ],
  );

  return <SesionContext.Provider value={valor}>{children}</SesionContext.Provider>;
}

export function useSesion() {
  const contexto = useContext(SesionContext);
  if (!contexto) throw new Error("useSesion fuera de SesionProvider");
  return contexto;
}
