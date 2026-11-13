import { useFocusEffect } from "expo-router";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { soporteService } from "../../api/servicios";
import { Alerta, BotonIcono, Cargando, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { useSesion } from "../../sesion/SesionContext";
import {
  mensajeDeSoporte,
  ordenarMisTickets,
  pendientesDeMisTickets,
  queSigue,
} from "../../soporte/formato";
import { SONDEO_LISTAS_MS, useSondeo } from "../../soporte/useSondeo";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { fechaYHora } from "../../utils/fechas";
import { EstadoTicket, PrioridadTicket, Separador } from "./piezas";

/**
 * «Mis tickets» (US-014, CA-6): lo que pidió la persona (`GET mis-tickets/`),
 * con el estado en su vocabulario, la prioridad en lenguaje llano y «qué
 * sigue». Primero lo que pide algo de ella, después lo abierto y al final lo
 * cerrado. Se refresca al volver a la pantalla, al tirar hacia abajo y cada
 * 30 s mientras se ve. Un refresco fallido no borra la lista.
 */
export function textoPendientes(n) {
  return n === 1
    ? "Un ticket necesita algo de usted: está primero en la lista."
    : `${n} tickets necesitan algo de usted: están primero en la lista.`;
}

export const TarjetaMiTicket = memo(function TarjetaMiTicket({ ticket: t, onAbrir }) {
  const sigue = queSigue(t);
  const nombre = [
    `${t.numero}. ${t.caso}, ${t.categoria}`,
    `Prioridad: ${t.prioridad_display}`,
    `Estado: ${t.estado_display}`,
    `${sigue.accion ? "Le toca a usted: " : ""}${sigue.texto}`,
    `Creado el ${fechaYHora(t.creado)}`,
  ].join(". ");
  return (
    <Pressable
      testID={`mi-ticket-${t.id}`}
      onPress={() => onAbrir(t)}
      accessibilityRole="button"
      accessibilityLabel={nombre}
      accessibilityHint="Abre el ticket"
      style={({ pressed }) => [estilos.tarjeta, sigue.accion && estilos.tarjetaAccion, pressed && estilos.presionada]}
    >
      <View style={estilos.fila}>
        <Text style={estilos.numero}>{t.numero}</Text>
        <EstadoTicket ticket={t} />
      </View>
      <Text style={estilos.caso}>{t.caso}</Text>
      <Text style={estilos.tenue}>{t.categoria}</Text>
      <PrioridadTicket ticket={t} />
      <View style={estilos.sigue}>
        <Icono
          nombre={sigue.accion ? "arrow-right-circle-outline" : sigue.atrasado ? "clock-alert-outline" : "information-outline"}
          size={20}
          color={sigue.accion ? colores.avisoTexto : sigue.atrasado ? colores.malTexto : colores.tintaSuave}
        />
        <Text style={[estilos.sigueTexto, sigue.accion && estilos.sigueAccion]}>{sigue.texto}</Text>
      </View>
      <Text style={estilos.tenue}>Creado el {fechaYHora(t.creado)}</Text>
    </Pressable>
  );
});

export function MisTickets({ onAbrir, cabecera = null, pie = null, alActualizar, alCargar }) {
  const { versionEmpresa } = useSesion();
  const [estado, setEstado] = useState("cargando");
  const [lista, setLista] = useState([]);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  const montado = useRef(true);
  const consulta = useRef(0);
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  // T1: lo cargado alimenta «Para hoy» sin pedir `mis-tickets/` otra vez.
  const alCargarRef = useRef(alCargar);
  alCargarRef.current = alCargar;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(async ({ silenciosa = false } = {}) => {
    const numero = ++consulta.current;
    if (!silenciosa) setEstado("cargando");
    try {
      const datos = await soporteService.misTickets();
      if (!montado.current || numero !== consulta.current) return;
      setLista(ordenarMisTickets(Array.isArray(datos) ? datos : []));
      alCargarRef.current?.(Array.isArray(datos) ? datos : []);
      setEstado("listo");
      setError(null);
      setAviso(null);
    } catch (e) {
      if (!montado.current || numero !== consulta.current) return;
      if (silenciosa && estadoRef.current === "listo") {
        setAviso(`${mensajeDeSoporte(e, "No se pudieron actualizar sus tickets.")} Se muestran los anteriores.`);
      } else {
        setError(mensajeDeSoporte(e, "No se pudieron cargar sus tickets."));
        setEstado("error");
      }
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar, versionEmpresa]);

  // Al volver a la pantalla (no la primera vez: ya cargó).
  const primeraVez = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeraVez.current) {
        primeraVez.current = false;
        return;
      }
      cargar({ silenciosa: true });
    }, [cargar]),
  );

  useSondeo(() => cargar({ silenciosa: true }), SONDEO_LISTAS_MS, estado === "listo");

  async function refrescar() {
    setRefrescando(true);
    await Promise.all([cargar({ silenciosa: true }), alActualizar?.()]);
    if (montado.current) setRefrescando(false);
  }

  const renderItem = useCallback(({ item }) => <TarjetaMiTicket ticket={item} onAbrir={onAbrir} />, [onAbrir]);
  const pendientes = pendientesDeMisTickets(lista);

  let vacio;
  if (estado === "cargando") vacio = <Cargando texto="Cargando sus tickets…" />;
  else if (estado === "error") vacio = <ErrorConReintento texto={error} onReintentar={() => cargar()} />;
  else vacio = <Vacio icono="ticket-outline" texto="Todavía no ha pedido ayuda." />;

  return (
    <FlatList
      testID="lista-mis-tickets"
      style={estilos.lista}
      contentContainerStyle={estilos.contenido}
      data={estado === "listo" ? lista : []}
      keyExtractor={(t) => String(t.id)}
      ListHeaderComponent={
        <View style={estilos.cabecera}>
          <View style={estilos.filaCabecera}>
            <View style={estilos.cabeceraPropia}>{cabecera}</View>
            <BotonIcono
              testID="actualizar-mis-tickets"
              icono="refresh"
              variante="contorno"
              etiqueta={refrescando ? "Actualizando…" : "Actualizar mis tickets"}
              cargando={refrescando}
              onPress={refrescar}
            />
          </View>
          {aviso ? <Alerta tipo="mal" texto={aviso} /> : null}
          {estado === "listo" && pendientes > 0 ? (
            <Alerta tipo="aviso" texto={textoPendientes(pendientes)} testID="pendientes-mios" />
          ) : null}
        </View>
      }
      ListEmptyComponent={vacio}
      ListFooterComponent={pie ? <View style={estilos.pie}>{pie}</View> : null}
      renderItem={renderItem}
      ItemSeparatorComponent={Separador}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
    />
  );
}

const estilos = crearEstilos({
  lista: { flex: 1 },
  contenido: { padding: 16, paddingTop: 8, paddingBottom: 32 },
  cabecera: { gap: 10, marginBottom: 10 },
  filaCabecera: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cabeceraPropia: { flex: 1, gap: 10 },
  pie: { marginTop: 20 },
  tarjeta: {
    minHeight: AREA_TACTIL,
    padding: 14,
    gap: 6,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  // Lo que pide algo de la persona: borde izquierdo de marca y el texto en
  // naranja con su flecha (no solo el color).
  tarjetaAccion: { borderLeftWidth: 5, borderLeftColor: colores.acento },
  presionada: { backgroundColor: colores.realce },
  fila: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  numero: { flexGrow: 1, fontSize: 16, fontWeight: "700", color: colores.titulo },
  caso: { fontSize: 16, fontWeight: "600", color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  sigue: { flexDirection: "row", alignItems: "center", gap: 6 },
  sigueTexto: { flex: 1, fontSize: 15, color: colores.tinta },
  sigueAccion: { fontWeight: "700", color: colores.avisoTexto },
});
