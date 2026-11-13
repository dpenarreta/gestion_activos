import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";

import { mensajeDeError } from "../api/errores";
import { notificacionesService } from "../api/servicios";
import { Alerta, Boton, Cargando, ErrorConReintento } from "../componentes/comunes";
import { Icono } from "../componentes/Icono";
import { anunciar } from "../accesibilidad/anunciar";
import { useSesion } from "../sesion/SesionContext";
import { estaLeida, iconoDe } from "../notificaciones/abrir";
import { useContador } from "../notificaciones/ContadorContext";
import { volverAlModulo } from "../navegacion/abrir";
import { esRutaDeModulo } from "../navegacion/modulos";
import { rutaEnApp } from "../notificaciones/modulosEnApp";
import {
  abrirEnNavegador,
  TEXTO_NAVEGADOR_FALLO,
  urlWebDeNotificacion,
} from "../navegador/enlaceWeb";
import { colores } from "../tema/colores";
import { fechaCompleta } from "../utils/fechas";
import { crearEstilos } from "../tema/tipografia";

export const TEXTO_FUERA_DE_LA_APP =
  "Este módulo aún no está en la app. Le recomendamos abrirlo y validarlo desde el navegador.";

/** Hasta cuándo se espera en silencio antes de decir «Cargando…»: si la
 * notificación es de un módulo de la app, se va a él sin pantalla intermedia
 * (auditoría UX, H-21). */
export const ESPERA_CARGANDO_MS = 600;

export function textoCambioDeEmpresa(nombre) {
  return `Esta notificación es de ${nombre}: la app pasó a esa empresa.`;
}

/** Sin enlace no hay botón, pero sí a dónde ir (revisión de QA-UX). */
export function textoSinEnlace(modulo) {
  return `Esta notificación no trae un enlace. Búsquela en el módulo «${modulo || "Sistema"}» de la web.`;
}

/**
 * El detalle de una notificación: el destino de la lista y del push. Al
 * abrirse la marca leída (CA-7). Si su módulo ya está en la app, va a esa
 * pantalla (CA-8); si no, ofrece abrirla en el navegador, con el enlace
 * validado y la empresa de la notificación.
 *
 * `empresa` llega cuando se abre desde un push (`data.empresa`): esa empresa
 * va como `X-Empresa` en el detalle y en `leer`, porque la notificación puede
 * no ser de la empresa activa y respondería 404. Si es una empresa de la
 * persona, además se pasa a ella, para que lo que vea después cuadre (B3,
 * decisión del Tech Lead, 12/11/2026).
 */
export function DetalleNotificacion({ id, mapa, empresa = null }) {
  const router = useRouter();
  const { recargar: recargarContador } = useContador();
  const { cambiarEmpresaSiEsSuya, empresas } = useSesion();
  const [estado, setEstado] = useState("cargando");
  const [notificacion, setNotificacion] = useState(null);
  const [error, setError] = useState(null);
  const [errorNavegador, setErrorNavegador] = useState(null);
  const [avisoEmpresa, setAvisoEmpresa] = useState(null);
  const [mostrarCargando, setMostrarCargando] = useState(false);
  const montado = useRef(true);
  // En un ref: la lista cambia al pasar de empresa, y como dependencia de
  // `cargar` volvería a pedir el detalle.
  const empresasRef = useRef(empresas);
  empresasRef.current = empresas;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(async () => {
    setEstado("cargando");
    if (empresa) {
      cambiarEmpresaSiEsSuya(empresa)
        .then((cambio) => {
          if (!cambio || !montado.current) return;
          const nombre =
            (empresasRef.current ?? []).find((e) => String(e.id) === String(empresa))?.nombre ??
            "otra empresa";
          const texto = textoCambioDeEmpresa(nombre);
          setAvisoEmpresa(texto);
          // Es informativa (no interrumpe como un error), pero cambia lo que
          // la persona ve en toda la app: se anuncia.
          anunciar(texto);
        })
        .catch(() => {});
    }
    try {
      let datos = await notificacionesService.detalle(id, { empresa });
      if (!estaLeida(datos)) {
        try {
          datos = (await notificacionesService.leer(id, { empresa })) ?? { ...datos, leida: true };
        } catch {
          // Se intentará de nuevo la próxima vez que se abra.
        }
        recargarContador();
      }
      if (!montado.current) return;
      const ruta = rutaEnApp(datos, mapa);
      if (ruta) {
        // Sigue en el estado neutro hasta que la otra pantalla la reemplaza.
        setEstado("redirigiendo");
        // US-016: si lleva a un módulo, se vuelve a los de debajo.
        if (esRutaDeModulo(ruta)) volverAlModulo(router, ruta);
        else router.replace(ruta);
        return;
      }
      setNotificacion(datos);
      setEstado("listo");
    } catch (e) {
      if (!montado.current) return;
      setError(
        e?.response?.status === 404
          ? "Esta notificación ya no existe o no es suya. Puede que sea de otra empresa: cámbiela en «Cuenta»."
          : mensajeDeError(e, "No se pudo cargar la notificación."),
      );
      setEstado("error");
    }
  }, [id, mapa, empresa, cambiarEmpresaSiEsSuya, recargarContador, router]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // «Cargando…» solo si tarda: una ida rápida a otra pantalla no parpadea.
  useEffect(() => {
    if (estado !== "cargando") {
      setMostrarCargando(false);
      return undefined;
    }
    const espera = setTimeout(() => setMostrarCargando(true), ESPERA_CARGANDO_MS);
    return () => clearTimeout(espera);
  }, [estado]);

  if (estado === "cargando" || estado === "redirigiendo") {
    if (estado === "cargando" && mostrarCargando) return <Cargando texto="Cargando la notificación…" />;
    // Estado neutro: el fondo y un indicador, sin texto que cambie enseguida.
    return (
      <View
        style={estilos.neutro}
        testID="abriendo-notificacion"
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Abriendo la notificación…"
      >
        <ActivityIndicator color={colores.primario} />
      </View>
    );
  }
  if (estado === "error") {
    return (
      <View style={estilos.contenido}>
        <ErrorConReintento texto={error} onReintentar={cargar} />
      </View>
    );
  }

  // La empresa de la notificación; si la API no la trae, la del push.
  const url = urlWebDeNotificacion({ ...notificacion, empresa: notificacion.empresa ?? empresa });

  async function abrir() {
    setErrorNavegador(null);
    // El fallo se muestra aquí, junto al botón, y no en un Alert.
    const abierta = await abrirEnNavegador(url, { avisarSiFalla: false });
    if (!abierta && montado.current) setErrorNavegador(TEXTO_NAVEGADOR_FALLO);
  }

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      {avisoEmpresa && <Alerta tipo="info" texto={avisoEmpresa} />}
      <View style={estilos.modulo}>
        <View style={estilos.icono}>
          <Icono bootstrap={iconoDe(notificacion)} size={24} color={colores.primario} />
        </View>
        <Text style={estilos.moduloTexto}>{notificacion.modulo_nombre}</Text>
      </View>
      <Text style={estilos.titulo} accessibilityRole="header">
        {notificacion.titulo}
      </Text>
      {notificacion.resumen ? <Text style={estilos.resumen}>{notificacion.resumen}</Text> : null}
      <Text style={estilos.fecha}>{fechaCompleta(notificacion.created_at)}</Text>

      <Alerta
        tipo="info"
        texto={url ? TEXTO_FUERA_DE_LA_APP : textoSinEnlace(notificacion.modulo_nombre)}
      />
      {url && (
        <Boton
          testID="abrir-en-navegador"
          titulo="Abrir en el navegador"
          icono="open-in-new"
          pista="Abre esta notificación en la web de la intranet"
          onPress={abrir}
        />
      )}
      {errorNavegador && <Alerta tipo="mal" texto={errorNavegador} />}
    </ScrollView>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 14 },
  neutro: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colores.fondo },
  modulo: { flexDirection: "row", alignItems: "center", gap: 10 },
  icono: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colores.acento,
    alignItems: "center",
    justifyContent: "center",
  },
  moduloTexto: { flex: 1, fontSize: 15, color: colores.tintaSuave },
  titulo: { fontSize: 22, fontWeight: "700", color: colores.tinta },
  resumen: { fontSize: 16, color: colores.tintaSuave },
  fecha: { fontSize: 14, color: colores.tintaTenue },
});
