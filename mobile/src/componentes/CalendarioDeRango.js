import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";

import { anunciar } from "../accesibilidad/anunciar";
import { AREA_TACTIL } from "../tema/colores";
import { useEstilos } from "../tema/apariencia";
import { crearEstilos } from "../tema/tipografia";
import {
  claveDelMes,
  DIAS_DE_LA_SEMANA,
  diaCompleto,
  diasDeCalendario,
  esIsoValido,
  mesDe,
  moverMes,
  semanasDeLaCuadricula,
  sumarDias,
  tituloDelMes,
} from "../utils/calendario";
import { aIso, fechaCorta } from "../utils/fechas";
import { BotonIcono } from "./comunes";

/**
 * Un calendario mensual para elegir un período (US-030, 17/11/2026, pedido
 * del usuario: «adicional al desplegable debe haber un calendario para
 * seleccionar fechas y estas cuenten y se actualicen en el desplegable»).
 * Va debajo de los campos «Desde» y «Hasta», que siguen siendo la fuente:
 * el calendario recibe `desde` y `hasta` y avisa los cambios con
 * `onCambio({ desde, hasta })`.
 *
 * Cómo se elige (CA-2):
 * - el primer toque fija «Desde» y «Hasta» el mismo día;
 * - el segundo, si es ese día o uno posterior, fija «Hasta»;
 * - si el segundo es anterior, ese día pasa a ser el nuevo «Desde» (y
 *   «Hasta» el mismo día): se sigue esperando el último día;
 * - con el período completo, un toque empieza otro.
 * Lo que la persona cambie en los campos reinicia la elección y lleva el
 * calendario al mes de la fecha cambiada (CA-3).
 *
 * - `unDia`: un permiso por horas (CA-5); cada toque elige el único día.
 * - `minimo` y `maximo` («AAAA-MM-DD»): los días fuera se ven tachados, se
 *   dicen «no disponible» y no se pueden tocar (CA-6).
 * - Sábados y domingos van con un fondo suave y se pueden elegir; los
 *   feriados no se marcan: los cuenta el servidor (§4 de la historia).
 * - La cuadrícula va de lunes a domingo y solo con los días del mes: los de
 *   los meses vecinos quedan en blanco para que un toque no salte de mes.
 */

/** «Del 18/11/2026 al 20/11/2026: 3 días». */
function textoDelRango(desde, hasta, n) {
  const dias = n === 1 ? "1 día" : `${n} días`;
  if (desde === hasta) return `${fechaCorta(desde)}: ${dias}`;
  return `Del ${fechaCorta(desde)} al ${fechaCorta(hasta)}: ${dias}`;
}

/** Lo mismo para el lector, con los nombres de los días. */
function anuncioDelRango(desde, hasta, n) {
  const dias = n === 1 ? "1 día" : `${n} días`;
  if (desde === hasta) return `Período elegido: ${diaCompleto(desde)}, ${dias}.`;
  return `Período elegido: del ${diaCompleto(desde)} al ${diaCompleto(hasta)}, ${dias}.`;
}

/** El papel de un día en el período, para el estilo y para el lector. */
function papelDe(iso, desde, hasta, conRango) {
  if (!conRango) return iso === desde ? "unico" : null;
  if (iso === desde && iso === hasta) return "unico";
  if (iso === desde) return "inicio";
  if (iso === hasta) return "fin";
  if (iso > desde && iso < hasta) return "dentro";
  return null;
}

const DICHO_DEL_PAPEL = {
  inicio: "inicio del período",
  fin: "fin del período",
  dentro: "dentro del período",
};

/** «Martes 18 de noviembre de 2026, inicio del período, hoy». */
export function nombreDelDiaEnRango(iso, { papel, unDia = false, esHoy = false, fuera = false } = {}) {
  const partes = [diaCompleto(iso)];
  if (papel === "unico") partes.push(unDia ? "día elegido" : "inicio y fin del período");
  else if (papel) partes.push(DICHO_DEL_PAPEL[papel]);
  if (esHoy) partes.push("hoy");
  if (fuera) partes.push("no disponible");
  return partes.join(", ");
}

/** La pista de cada día: fija por modo, para que `memo(Dia)` no vuelva a
 * dibujar el mes entero en cada toque (QA-TECH, 17/11/2026). Qué fija el
 * próximo toque lo dicen la instrucción a la vista y el anuncio. */
const PISTA_UN_DIA = "Elegir este día";
const PISTA_RANGO = "Elegir este día para «Desde» o «Hasta»";

/** El diámetro del círculo del número: crece con la letra del sistema y se
 * queda dentro de la celda (con la letra al 200 % el número se ajusta). */
export function diametroDelNumero(escalaDeLetra = 1) {
  return Math.min(AREA_TACTIL - 4, Math.max(36, Math.round(15 * escalaDeLetra * 1.5 + 8)));
}

const Dia = memo(function Dia({ dia, papel, esHoy, fuera, unDia, diametro, onTocar, prefijo }) {
  const estilos = useEstilos(fabricaDeEstilos);
  if (!dia.delMes) {
    // En blanco: los días de los meses vecinos no se dibujan ni se leen.
    return <View style={estilos.dia} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden />;
  }
  const extremo = papel === "inicio" || papel === "fin" || papel === "unico";
  const enPeriodo = Boolean(papel);
  return (
    <Pressable
      testID={`${prefijo}-dia-${dia.iso}`}
      onPress={() => onTocar(dia.iso)}
      disabled={fuera}
      accessibilityRole="button"
      accessibilityLabel={nombreDelDiaEnRango(dia.iso, { papel, unDia, esHoy, fuera })}
      accessibilityHint={fuera ? undefined : unDia ? PISTA_UN_DIA : PISTA_RANGO}
      accessibilityState={{ selected: enPeriodo, disabled: fuera }}
      style={({ pressed }) => [
        estilos.dia,
        dia.finDeSemana && estilos.diaFinDeSemana,
        // La franja del período: fondo suave y una línea arriba y abajo (no
        // solo el color). Los extremos la llevan hacia el lado de dentro.
        papel === "dentro" && estilos.franja,
        papel === "inicio" && [estilos.franja, estilos.franjaInicio],
        papel === "fin" && [estilos.franja, estilos.franjaFin],
        pressed && !fuera && estilos.presionado,
      ]}
    >
      <View
        style={[
          estilos.numeroCaja,
          // Redondo con cualquier tamaño de letra: ancho, alto y radio juntos.
          { width: diametro, height: diametro, borderRadius: diametro / 2 },
          esHoy && !extremo && estilos.numeroCajaHoy,
          // Los extremos, un círculo lleno con borde: la forma los distingue.
          extremo && estilos.numeroCajaExtremo,
        ]}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          style={[
            estilos.numero,
            dia.finDeSemana && estilos.numeroFinDeSemana,
            enPeriodo && estilos.numeroEnPeriodo,
            esHoy && estilos.numeroHoy,
            extremo && estilos.numeroExtremo,
            fuera && estilos.numeroFuera,
          ]}
        >
          {dia.numero}
        </Text>
      </View>
    </Pressable>
  );
});

export function CalendarioDeRango({
  style,
  desde,
  hasta,
  onCambio,
  unDia = false,
  minimo,
  maximo,
  hoy: hoyDado,
  testID = "calendario-rango",
}) {
  const estilos = useEstilos(fabricaDeEstilos);
  const { fontScale } = useWindowDimensions();
  const diametro = diametroDelNumero(fontScale);
  const hoy = hoyDado ?? aIso(new Date());
  // Abre en el mes de «Desde» o, sin fecha, en el de hoy (CA-1).
  const [mes, setMes] = useState(() => mesDe(desde) ?? mesDe(hoy));
  // Si el próximo toque fija «Hasta» (tras el primer toque).
  const [esperandoFin, setEsperandoFin] = useState(false);
  // Lo último que eligió el calendario: al volver por las props no es un
  // cambio de los campos.
  const propio = useRef(null);
  const previo = useRef({ desde, hasta });

  // CA-3: un cambio en los campos reinicia la elección y salta al mes de la
  // fecha que cambió.
  useEffect(() => {
    const antes = previo.current;
    previo.current = { desde, hasta };
    if (antes.desde === desde && antes.hasta === hasta) return;
    const elegido = propio.current;
    propio.current = null;
    if (elegido && elegido.desde === desde && elegido.hasta === hasta) return;
    setEsperandoFin(false);
    const cambiada = antes.desde === desde ? hasta : desde;
    const suyo = mesDe(cambiada);
    if (suyo) setMes((m) => (claveDelMes(m) === claveDelMes(suyo) ? m : suyo));
  }, [desde, hasta]);

  const fueraDeRango = useCallback(
    (iso) => Boolean((minimo && iso < minimo) || (maximo && iso > maximo)),
    [minimo, maximo],
  );

  const emitir = (nuevoDesde, nuevoHasta) => {
    if (nuevoDesde === desde && nuevoHasta === hasta) return;
    propio.current = { desde: nuevoDesde, hasta: nuevoHasta };
    onCambio({ desde: nuevoDesde, hasta: nuevoHasta });
  };

  const tocar = (iso) => {
    if (fueraDeRango(iso)) return;
    if (unDia) {
      emitir(iso, iso);
      anunciar(`Día elegido: ${diaCompleto(iso)}.`);
      return;
    }
    if (esperandoFin && esIsoValido(desde) && iso >= desde) {
      emitir(desde, iso);
      setEsperandoFin(false);
      // En Android el período lo lee la región viva del resumen de la
      // pantalla; anunciarlo además lo decía dos veces (QA, 17/11/2026).
      if (Platform.OS === "ios") anunciar(anuncioDelRango(desde, iso, diasDeCalendario(desde, iso)));
      return;
    }
    // Primer toque, uno anterior a «Desde» o uno con el período completo.
    emitir(iso, iso);
    setEsperandoFin(true);
    anunciar(`Desde: ${diaCompleto(iso)}. Ahora toque el último día del período.`);
  };
  // `memo(Dia)` solo sirve con la misma función entre renders.
  const tocarRef = useRef(tocar);
  useLayoutEffect(() => {
    tocarRef.current = tocar;
  });
  const alTocar = useCallback((iso) => tocarRef.current(iso), []);

  const semanas = useMemo(() => semanasDeLaCuadricula(mes.anio, mes.mes), [mes]);
  const titulo = tituloDelMes(mes.anio, mes.mes);
  const anterior = moverMes(mes, -1);
  const siguiente = moverMes(mes, 1);
  // Sin días elegibles en el mes de al lado, la flecha no lleva a ningún lado.
  const sinAnterior = Boolean(minimo && sumarDias(`${claveDelMes(mes)}-01`, -1) < minimo);
  const sinSiguiente = Boolean(maximo && `${claveDelMes(siguiente)}-01` > maximo);

  function cambiarMes(delta) {
    const nuevo = delta < 0 ? anterior : siguiente;
    setMes(nuevo);
    // En Android el título es una región viva y ya se lee solo.
    if (Platform.OS === "ios") anunciar(tituloDelMes(nuevo.anio, nuevo.mes));
  }

  const conRango = !unDia && esIsoValido(desde) && esIsoValido(hasta) && hasta >= desde;
  const total = conRango ? diasDeCalendario(desde, hasta) : null;
  const instruccion = unDia
    ? "Toque el día del permiso."
    : esperandoFin
      ? "Ahora toque el último día del período («Hasta»)."
      : "Toque el primer día del período («Desde») y luego el último («Hasta»).";
  const resumen = unDia
    ? esIsoValido(desde)
      ? `Día elegido: ${fechaCorta(desde)}`
      : null
    : total
      ? textoDelRango(desde, hasta, total)
      : null;

  return (
    <View style={[estilos.tarjeta, style]} testID={testID}>
      <View style={estilos.cabecera}>
        <BotonIcono
          testID={`${testID}-mes-anterior`}
          icono="chevron-left"
          etiqueta={`Mes anterior, ${tituloDelMes(anterior.anio, anterior.mes)}`}
          deshabilitado={sinAnterior}
          onPress={() => cambiarMes(-1)}
        />
        <Text
          testID={`${testID}-mes`}
          style={estilos.mes}
          accessibilityRole="header"
          accessibilityLiveRegion="polite"
        >
          {titulo}
        </Text>
        <BotonIcono
          testID={`${testID}-mes-siguiente`}
          icono="chevron-right"
          etiqueta={`Mes siguiente, ${tituloDelMes(siguiente.anio, siguiente.mes)}`}
          deshabilitado={sinSiguiente}
          onPress={() => cambiarMes(1)}
        />
      </View>
      <Text style={estilos.instruccion} testID={`${testID}-instruccion`}>
        {instruccion}
      </Text>

      <View style={estilos.semana} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {DIAS_DE_LA_SEMANA.map((d, i) => (
          <Text
            key={d.corto}
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[estilos.diaSemana, i >= 5 && estilos.diaSemanaFinde]}
          >
            {d.corto}
          </Text>
        ))}
      </View>
      <View testID={`${testID}-cuadricula`}>
        {semanas.map((semana) => (
          <View key={semana[0].iso} style={estilos.semana}>
            {semana.map((dia) => (
              <Dia
                key={dia.iso}
                dia={dia}
                papel={papelDe(dia.iso, desde, hasta, conRango || unDia)}
                esHoy={dia.iso === hoy}
                fuera={fueraDeRango(dia.iso)}
                unDia={unDia}
                diametro={diametro}
                onTocar={alTocar}
                prefijo={testID}
              />
            ))}
          </View>
        ))}
      </View>

      {/* CA-4: el mismo número que el resumen de la pantalla, a la vista. */}
      {resumen ? (
        <Text style={estilos.resumen} testID={`${testID}-resumen`}>
          {resumen}
        </Text>
      ) : null}
    </View>
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
  tarjeta: {
    gap: 6,
    // Sin relleno a los lados: todo el ancho es para las 7 columnas.
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.superficie,
  },
  cabecera: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 4 },
  mes: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: colores.tinta },
  instruccion: { fontSize: 14, color: colores.tintaSuave, textAlign: "center", paddingHorizontal: 8 },
  semana: { flexDirection: "row" },
  diaSemana: {
    width: "14.2857%",
    textAlign: "center",
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: "600",
    color: colores.tintaTenue,
  },
  diaSemanaFinde: { color: colores.tintaSuave },
  // Las celdas crecen en alto con la letra grande (CA-7): solo `minHeight`.
  dia: {
    width: "14.2857%",
    minHeight: AREA_TACTIL,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 2,
  },
  diaFinDeSemana: { backgroundColor: colores.hundido },
  franja: {
    backgroundColor: colores.realce,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colores.bordeControl,
  },
  franjaInicio: { borderTopLeftRadius: AREA_TACTIL / 2, borderBottomLeftRadius: AREA_TACTIL / 2, borderLeftWidth: 1 },
  franjaFin: { borderTopRightRadius: AREA_TACTIL / 2, borderBottomRightRadius: AREA_TACTIL / 2, borderRightWidth: 1 },
  presionado: { opacity: 0.7 },
  numeroCaja: {
    maxWidth: "100%",
    paddingHorizontal: 2,
    borderWidth: 2,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  // Hoy: un anillo y el número subrayado (no solo el color).
  numeroCajaHoy: { borderColor: colores.primario },
  numeroCajaExtremo: { backgroundColor: colores.primario, borderColor: colores.acento },
  numero: { fontSize: 15, color: colores.tinta },
  numeroFinDeSemana: { color: colores.tintaSuave },
  numeroEnPeriodo: { fontWeight: "700", color: colores.tinta },
  numeroHoy: { fontWeight: "700", textDecorationLine: "underline" },
  numeroExtremo: { fontWeight: "700", color: colores.sobrePrimario },
  numeroFuera: { color: colores.tintaTenue, textDecorationLine: "line-through" },
  resumen: { fontSize: 15, fontWeight: "700", color: colores.tinta, textAlign: "center", paddingHorizontal: 8 },
});
