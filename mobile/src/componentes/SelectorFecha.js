import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { aHora, aIso, deHora, deIso, fechaCorta, fechaLarga } from "../utils/fechas";
import { AREA_TACTIL, colores } from "../tema/colores";
import { estilos as comunes } from "./comunes";
import { Icono } from "./Icono";
import { crearEstilos } from "../tema/tipografia";

/**
 * Un campo de fecha («AAAA-MM-DD») o de hora («HH:MM») con el selector nativo
 * del teléfono (US-010, CA-14): en Android, el diálogo del sistema; en iOS,
 * el calendario o la rueda debajo del campo, con «Listo».
 *
 * El campo es un botón con su etiqueta, el valor dicho entero («12 de
 * noviembre de 2026») y, si lo hay, el error; los selectores del sistema ya
 * son accesibles con TalkBack y VoiceOver. Sin valor dice «Sin elegir».
 *
 * - `porDefecto`: lo que muestra el selector al abrirse sin valor (por
 *   ejemplo, «Hasta las» una hora después de «Desde las»).
 * - En iOS, «Listo» confirma lo que se ve en la rueda, aunque no se haya
 *   movido (revisión de QA-UX, 12/11/2026).
 * - Las horas van de 5 en 5 minutos en las dos plataformas.
 * - Al desmontar, el diálogo de Android abierto se cierra.
 */
const INTERVALO_MINUTOS = 5;

function redondear(fecha) {
  const copia = new Date(fecha);
  copia.setSeconds(0, 0);
  copia.setMinutes(Math.round(copia.getMinutes() / INTERVALO_MINUTOS) * INTERVALO_MINUTOS);
  return copia;
}
export function SelectorFecha({
  etiqueta,
  valor,
  onCambio,
  modo = "date",
  minimo,
  obligatorio = false,
  error,
  ayuda,
  deshabilitado = false,
  porDefecto,
  testID,
  // El botón del selector, para llevarle el foco con un error (R-03).
  refFoco,
}) {
  const [abiertoEnIos, setAbiertoEnIos] = useState(false);
  const esFecha = modo === "date";
  const inicial = valor || porDefecto;
  const actual = esFecha ? deIso(inicial) || new Date() : redondear(deHora(inicial || "08:00"));
  // Lo que se ve en la rueda de iOS, para confirmarlo con «Listo».
  const enRueda = useRef(actual);
  const abiertoEnAndroid = useRef(false);

  useEffect(
    () => () => {
      if (Platform.OS === "android" && abiertoEnAndroid.current) {
        try {
          DateTimePickerAndroid.dismiss(modo);
        } catch {
          // Ya estaba cerrado.
        }
      }
    },
    [modo],
  );
  const minimoFecha = esFecha && minimo ? deIso(minimo) : undefined;
  const visible = valor ? (esFecha ? fechaCorta(valor) : valor) : "Sin elegir";
  const dicho = valor ? (esFecha ? fechaLarga(valor) : `las ${valor}`) : "sin elegir";

  function elegido(fecha) {
    if (!fecha) return;
    onCambio(esFecha ? aIso(fecha) : aHora(fecha));
  }

  function abrir() {
    if (deshabilitado) return;
    if (Platform.OS === "android") {
      abiertoEnAndroid.current = true;
      DateTimePickerAndroid.open({
        value: actual,
        mode: modo,
        is24Hour: true,
        minimumDate: minimoFecha,
        minuteInterval: esFecha ? undefined : INTERVALO_MINUTOS,
        title: etiqueta,
        onValueChange: (_evento, fecha) => {
          abiertoEnAndroid.current = false;
          elegido(fecha);
        },
        onDismiss: () => {
          abiertoEnAndroid.current = false;
        },
      });
      return;
    }
    enRueda.current = actual;
    setAbiertoEnIos((abierto) => !abierto);
  }

  function listoEnIos() {
    elegido(enRueda.current);
    setAbiertoEnIos(false);
  }

  const etiquetaAccesible = [
    `${etiqueta}${obligatorio ? " (obligatorio)" : ""}: ${dicho}`,
    error ? `Error: ${error}` : null,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <View style={[estilos.campo, abiertoEnIos && estilos.campoAbierto]}>
      <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
        {etiqueta}
        {obligatorio ? <Text style={estilos.obligatorio}> *</Text> : null}
      </Text>
      <Pressable
        ref={refFoco}
        testID={testID}
        onPress={abrir}
        disabled={deshabilitado}
        accessibilityRole="button"
        accessibilityLabel={etiquetaAccesible}
        accessibilityHint={esFecha ? "Abre el calendario para elegir la fecha" : "Abre el selector de hora"}
        accessibilityState={{ disabled: deshabilitado, expanded: Platform.OS === "ios" ? abiertoEnIos : undefined }}
        style={({ pressed }) => [
          estilos.boton,
          error && estilos.botonConError,
          deshabilitado && comunes.botonInactivo,
          pressed && estilos.presionado,
        ]}
      >
        <Icono nombre={esFecha ? "calendar" : "clock-outline"} size={20} color={colores.primario} />
        <Text style={[estilos.valor, !valor && estilos.sinValor]}>{visible}</Text>
      </Pressable>
      {ayuda ? <Text style={estilos.ayuda}>{ayuda}</Text> : null}
      {error ? (
        <View style={comunes.fila} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Icono nombre="alert-circle-outline" size={16} color={colores.malTexto} />
          <Text style={estilos.error}>{error}</Text>
        </View>
      ) : null}
      {Platform.OS === "ios" && abiertoEnIos && (
        <View style={estilos.panelIos}>
          <DateTimePicker
            value={actual}
            mode={modo}
            display={esFecha ? "inline" : "spinner"}
            locale="es-EC"
            minimumDate={minimoFecha}
            minuteInterval={esFecha ? undefined : INTERVALO_MINUTOS}
            onValueChange={(_evento, fecha) => {
              enRueda.current = fecha;
              // La fecha del calendario se toma al tocarla; la hora, con «Listo».
              if (esFecha) elegido(fecha);
            }}
            accentColor={colores.primario}
            themeVariant="light"
          />
          <View style={estilos.accionesIos}>
          <Pressable
            testID={testID ? `${testID}-cancelar` : undefined}
            onPress={() => setAbiertoEnIos(false)}
            accessibilityRole="button"
            accessibilityLabel={`Cancelar: dejar ${etiqueta.toLowerCase()} como estaba`}
            style={estilos.listo}
          >
            <Text style={estilos.cancelarTexto}>Cancelar</Text>
          </Pressable>
          <Pressable
            testID={testID ? `${testID}-listo` : undefined}
            onPress={listoEnIos}
            accessibilityRole="button"
            accessibilityLabel={`Listo: confirmar ${etiqueta.toLowerCase()}`}
            style={estilos.listo}
          >
            <Text style={estilos.listoTexto}>Listo</Text>
          </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const estilos = crearEstilos({
  campo: { gap: 4, flexGrow: 1, flexBasis: 140 },
  // Con el calendario o la rueda de iOS abiertos, el campo ocupa toda la
  // fila (revisión UX, A-1): la fila que lo contiene lleva `flexWrap`.
  campoAbierto: { flexBasis: "100%" },
  accionesIos: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 },
  cancelarTexto: { fontSize: 16, color: colores.tintaSuave },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  obligatorio: { color: colores.malTexto },
  boton: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colores.bordeControl,
    borderRadius: 8,
    backgroundColor: colores.superficie,
  },
  botonConError: { borderColor: colores.malTexto, borderWidth: 2 },
  presionado: { backgroundColor: colores.realce },
  valor: { flex: 1, fontSize: 16, color: colores.tinta },
  sinValor: { color: colores.tintaTenue },
  ayuda: { fontSize: 13, color: colores.tintaTenue },
  error: { flex: 1, fontSize: 14, color: colores.malTexto },
  panelIos: {
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: 8,
    backgroundColor: colores.superficie,
    padding: 8,
  },
  listo: {
    minHeight: AREA_TACTIL,
    alignSelf: "flex-end",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  listoTexto: { fontSize: 16, fontWeight: "600", color: colores.primario },
});
