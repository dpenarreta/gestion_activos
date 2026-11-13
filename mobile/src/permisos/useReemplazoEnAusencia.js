import { useCallback, useEffect, useRef, useState } from "react";

import { erroresPorCampo, mensajeDeError } from "../api/errores";
import { reemplazoService } from "../api/servicios";

/**
 * El estado de «¿Quién aprueba por usted mientras no está?», con el mismo
 * comportamiento que `useReemplazoEnAusencia` de la web (US-001, 11/11/2026).
 * La app lo replica al pedir un permiso por días (decisión del Tech Lead,
 * 12/11/2026): si no, quien pide desde el celular deja sus aprobaciones sin
 * reemplazo.
 *
 * - `activo` en falso no pide nada (el bloque no se ve: tipos por horas).
 * - `validar()`: con «Otra persona», hay que elegirla.
 * - `guardar()` va ANTES de crear la solicitud y devuelve `{ok, guardado,
 *   mensaje}`. Sin datos cargados (cargando o falló la carga) no hay elección
 *   que guardar y queda la que ya tenía; si no cambió, no se pide nada.
 */
export const MENSAJE_DE_FALLO = "No se pudo guardar quién aprueba por usted.";
export const YA_QUEDO_GUARDADO = "Su elección de quién aprueba por usted sí quedó guardada.";
export const TEXTO_ELIJA_PERSONA = "Elija a la persona que aprobará por usted.";

export function useReemplazoEnAusencia({ activo = true } = {}) {
  const [datos, setDatos] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [modo, setModoElegido] = useState("jefe");
  const [persona, setPersonaElegida] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(async () => {
    setErrorCarga(null);
    try {
      const d = await reemplazoService.obtener();
      if (!montado.current) return;
      setDatos(d ?? { modo: "jefe", persona: null, jefe: null });
      setModoElegido(d?.modo === "persona" ? "persona" : "jefe");
      setPersonaElegida(d?.persona ?? null);
    } catch (e) {
      if (montado.current) setErrorCarga(mensajeDeError(e, "No se pudo cargar quién aprueba por usted."));
    }
  }, []);

  useEffect(() => {
    // Solo al mostrarse por primera vez.
    if (activo && !datos) cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activo]);

  const setModo = useCallback((nuevo) => {
    setModoElegido(nuevo);
    setError(null);
  }, []);
  const setPersona = useCallback((nueva) => {
    setPersonaElegida(nueva);
    setError(null);
  }, []);

  const cambiado =
    Boolean(datos) && (modo !== datos.modo || (modo === "persona" && persona?.id !== datos.persona?.id));

  function validar() {
    if (activo && datos && modo === "persona" && !persona) {
      setError(TEXTO_ELIJA_PERSONA);
      return TEXTO_ELIJA_PERSONA;
    }
    return null;
  }

  async function guardar() {
    const fallo = (mensaje) => ({ ok: false, guardado: false, mensaje });
    if (!activo || !datos) return { ok: true, guardado: false };
    if (validar()) return fallo(MENSAJE_DE_FALLO);
    if (!cambiado) return { ok: true, guardado: false };
    setGuardando(true);
    setError(null);
    try {
      const guardado = await reemplazoService.guardar(
        modo === "persona" ? { modo, persona_id: persona.id } : { modo },
      );
      if (montado.current) setDatos(guardado ?? { ...datos, modo, persona: modo === "persona" ? persona : null });
      return { ok: true, guardado: true };
    } catch (e) {
      const campos = erroresPorCampo(e);
      const delCampo = campos.persona_id || campos.modo;
      if (delCampo) {
        if (montado.current) setError(delCampo);
        return fallo(MENSAJE_DE_FALLO);
      }
      return fallo(mensajeDeError(e, MENSAJE_DE_FALLO));
    } finally {
      if (montado.current) setGuardando(false);
    }
  }

  return { activo, datos, errorCarga, cargar, modo, setModo, persona, setPersona, error, guardando, cambiado, validar, guardar };
}
