import * as Linking from "expo-linking";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { mensajeDeError } from "../../api/errores";
import { chatService } from "../../api/servicios";
import {
  datosDeContacto,
  extrasDePresencia,
  iniciales,
  textoPresencia,
} from "../../chat/formato";
import { usePresencia } from "../../chat/usePresencia";
import {
  Alerta,
  BotonIcono,
  Cargando,
  ErrorConReintento,
} from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { AREA_TACTIL } from "../../tema/colores";
import { useColores, useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { Presencia } from "./piezas";

export const TEXTO_SIN_APP = {
  telefono: "No se pudo abrir la app de llamadas. Marque el número a mano:",
  correo: "No se pudo abrir la app de correo. Escriba a:",
};

/**
 * La ficha de contacto de una persona, desde el chat (16/11/2026, a pedido
 * del usuario): lo mismo que la tarjeta de contacto de la web
 * (`Chat/Contacto.jsx`). Correo corporativo, el teléfono corporativo o, si no
 * tiene, el personal (solo si autorizó compartirlo, LOPDP), la extensión de
 * su línea fija, su área y su cargo. Es de solo lectura; el valor se puede
 * seleccionar para copiarlo, y el teléfono y el correo abren su app.
 */
export function Contacto({ id, empresa = null }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const [estado, setEstado] = useState("cargando");
  const [contacto, setContacto] = useState(null);
  const [error, setError] = useState(null);
  const [errorApp, setErrorApp] = useState(null);
  const montado = useRef(true);
  const presencia = usePresencia([id]);
  const suya = presencia[String(id)];

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(async () => {
    setEstado("cargando");
    setError(null);
    try {
      const datos = await chatService.contacto(id, empresa ? { empresa } : {});
      if (!montado.current) return;
      setContacto(datos);
      setEstado("listo");
    } catch (e) {
      if (!montado.current) return;
      setError(mensajeDeError(e, "No se pudo cargar el contacto."));
      setEstado("error");
    }
  }, [id, empresa]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function abrir(fila) {
    setErrorApp(null);
    try {
      await Linking.openURL(fila.accion);
    } catch {
      if (montado.current) {
        setErrorApp({
          texto: `${TEXTO_SIN_APP[fila.clave]} ${fila.valor}`,
          clave: Date.now(),
        });
      }
    }
  }

  if (estado === "cargando") return <Cargando texto="Cargando el contacto…" />;
  if (estado === "error") {
    return (
      <View style={estilos.contenido}>
        <ErrorConReintento texto={error} onReintentar={cargar} />
      </View>
    );
  }

  const nombre = contacto?.nombre ?? "";
  const filas = datosDeContacto(contacto);
  return (
    <ScrollView
      testID="contacto"
      style={estilos.pantalla}
      contentContainerStyle={estilos.contenido}
    >
      <View style={estilos.encabezado}>
        <View
          style={estilos.avatar}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={estilos.avatarTexto} maxFontSizeMultiplier={1.3}>
            {iniciales(nombre)}
          </Text>
        </View>
        <View
          style={estilos.encabezadoTexto}
          accessible
          accessibilityLabel={[
            nombre,
            suya
              ? [textoPresencia(suya), ...extrasDePresencia(suya)].join(" · ")
              : null,
          ]
            .filter(Boolean)
            .join(". ")}
        >
          <Text style={estilos.nombre} accessibilityRole="header">
            {nombre}
          </Text>
          {suya ? <Presencia presencia={suya} /> : null}
        </View>
      </View>

      {filas.length === 0 ? (
        <Text style={estilos.tenue} testID="sin-datos">
          No tiene datos de contacto para mostrar.
        </Text>
      ) : (
        <View style={estilos.tarjeta}>
          {filas.map((fila, i) => (
            <View
              key={fila.clave}
              testID={`contacto-${fila.clave}`}
              style={[estilos.fila, i > 0 && estilos.filaConBorde]}
            >
              <Icono nombre={fila.icono} size={22} color={colores.tintaSuave} />
              <View
                style={estilos.filaTexto}
                accessible
                accessibilityLabel={`${fila.etiqueta}: ${fila.valor}`}
              >
                <Text style={estilos.etiqueta}>{fila.etiqueta}</Text>
                {/* Seleccionable: se mantiene presionado para copiarlo. */}
                <Text style={estilos.valor} selectable>
                  {fila.valor}
                </Text>
              </View>
              {fila.accion ? (
                <BotonIcono
                  testID={`abrir-${fila.clave}`}
                  icono={
                    fila.clave === "telefono"
                      ? "phone-outline"
                      : "email-outline"
                  }
                  variante="contorno"
                  etiqueta={`${fila.verbo} ${nombre}: ${fila.valor}`}
                  onPress={() => abrir(fila)}
                />
              ) : null}
            </View>
          ))}
        </View>
      )}
      {errorApp ? (
        <Alerta
          tipo="mal"
          texto={errorApp.texto}
          clave={errorApp.clave}
          testID="error-app"
        />
      ) : null}
      {filas.length > 0 ? (
        <Text style={estilos.ayuda}>
          Mantenga presionado un dato para copiarlo.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 16 },
  encabezado: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colores.avatar,
    alignItems: "center",
    justifyContent: "center",
  },
  // Amarillo sobre negro, como el avatar de la lista de chats (12,7:1).
  avatarTexto: { color: colores.acento, fontSize: 20, fontWeight: "700" },
  encabezadoTexto: { flex: 1, gap: 4 },
  nombre: { fontSize: 20, fontWeight: "700", color: colores.tinta },
  tarjeta: {
    backgroundColor: colores.superficie,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colores.borde,
    paddingHorizontal: 12,
  },
  fila: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: AREA_TACTIL + 16,
    paddingVertical: 10,
  },
  filaConBorde: { borderTopWidth: 1, borderTopColor: colores.borde },
  filaTexto: { flex: 1, gap: 2 },
  etiqueta: { fontSize: 14, color: colores.tintaSuave },
  valor: { fontSize: 16, fontWeight: "600", color: colores.tinta },
  tenue: { fontSize: 16, color: colores.tintaSuave },
  ayuda: { fontSize: 14, color: colores.tintaTenue },
});
