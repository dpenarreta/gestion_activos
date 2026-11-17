import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { anunciar } from "../accesibilidad/anunciar";
import { inicioService } from "../api/servicios";
import { BotonIcono, ErrorConReintento } from "../componentes/comunes";
import { Icono } from "../componentes/Icono";
import {
  DIAS_DE_LA_SEMANA,
  GRUPOS_DE_EVENTO,
  datosDelEvento,
  diaConNombre,
  diasDeLaCuadricula,
  enGrupo,
  nombreDelDia,
  porDia,
  TIPOS_EN_CALENDARIO,
  tipoDe,
  tituloDelMes,
  unicas,
} from "../inicio/calendario";
import { diaEnZona } from "../matriz/formato";
import { AREA_TACTIL } from "../tema/colores";
import { useColores, useEstilos } from "../tema/apariencia";
import { crearEstilos } from "../tema/tipografia";

/** La empresa trabaja en hora de Ecuador: «hoy» es el de allá, no el del
 * teléfono (igual que la Matriz). */
const ZONA = "America/Guayaquil";

const SIN_EVENTOS = [];

function moverMes({ anio, mes }, delta) {
  const total = anio * 12 + (mes - 1) + delta;
  return { anio: Math.floor(total / 12), mes: (total % 12) + 1 };
}

/** El mes en la pantalla se anuncia en iOS; en Android el título es una
 * región viva y ya se lee solo. */
function anunciarMes(texto) {
  if (Platform.OS === "ios") anunciar(texto);
}

/** Un día de la cuadrícula: su número y el ícono de cada tipo de fecha que
 * tiene (sin depender del color). Hoy, con el número sobre el amarillo de la
 * marca; el elegido, con borde negro; un feriado, con fondo rojo claro. */
const Dia = memo(function Dia({
  dia,
  eventos,
  esHoy,
  esElegido,
  hoy,
  onElegir,
}) {
  const estilos = useEstilos(fabricaDeEstilos);
  const tipos = [...new Set(eventos.map((e) => e.tipo))];
  const feriado = tipos.includes("feriado");
  return (
    <Pressable
      testID={`calendario-dia-${dia.iso}`}
      onPress={() => onElegir(dia.iso)}
      accessibilityRole="button"
      accessibilityLabel={nombreDelDia(dia, eventos, {
        hoy,
        elegido: esElegido ? dia.iso : null,
      })}
      accessibilityState={{ selected: esElegido }}
      style={({ pressed }) => [
        estilos.dia,
        feriado && estilos.diaFeriado,
        esElegido && estilos.diaElegido,
        pressed && estilos.presionado,
      ]}
    >
      <View style={[estilos.numeroCaja, esHoy && estilos.numeroHoy]}>
        <Text
          style={[
            estilos.numero,
            !dia.delMes && estilos.numeroDeOtroMes,
            esHoy && estilos.numeroTextoHoy,
          ]}
        >
          {dia.numero}
        </Text>
      </View>
      <View style={estilos.marcas}>
        {tipos.slice(0, 2).map((t) => (
          <Icono
            key={t}
            nombre={tipoDe({ tipo: t }).icono}
            size={12}
            color={tipoDe({ tipo: t }).color}
          />
        ))}
        {tipos.length > 2 ? <Text style={estilos.mas}>+</Text> : null}
      </View>
    </Pressable>
  );
});

/** Una fecha en la lista: ícono del tipo, título y, en texto, el tipo y la
 * duración (o el día, en «Próximas fechas»). */
function Fecha({ evento, conDia }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const tipo = tipoDe(evento);
  return (
    <View
      style={estilos.fecha}
      accessible
      testID={`calendario-fecha-${evento.id}-${evento.fecha}`}
    >
      <View style={[estilos.fechaIcono, { borderColor: tipo.color }]}>
        <Icono nombre={tipo.icono} size={18} color={tipo.color} />
      </View>
      <View style={estilos.fechaTexto}>
        <Text style={estilos.fechaTitulo}>{evento.titulo}</Text>
        <Text style={estilos.fechaDatos}>
          {datosDelEvento(evento, { conDia })}
        </Text>
        {evento.descripcion ? (
          <Text style={estilos.fechaDatos}>{evento.descripcion}</Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * El calendario de eventos de Inicio (16/11/2026): el mes con sus feriados,
 * eventos importantes y celebraciones; al tocar un día se listan sus fechas
 * y, debajo, las próximas del mes. `recarga` cambia con el pull-to-refresh
 * de Inicio y `version` con la empresa activa.
 */
export function CalendarioInicio({ recarga = 0, version = 0, ahora }) {
  const colores = useColores();
  const estilos = useEstilos(fabricaDeEstilos);
  const hoy = useMemo(
    () => diaEnZona(ahora ?? new Date(), ZONA),
    [ahora, recarga],
  ); // eslint-disable-line react-hooks/exhaustive-deps
  const [mes, setMes] = useState(() => ({
    anio: Number(hoy.slice(0, 4)),
    mes: Number(hoy.slice(5, 7)),
  }));
  const [elegido, setElegido] = useState(hoy);
  const [grupo, setGrupo] = useState("importantes");
  const [carga, setCarga] = useState({ estado: "cargando", lista: [] });
  const consulta = useRef(0);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const dias = useMemo(() => diasDeLaCuadricula(mes.anio, mes.mes), [mes]);
  const desde = dias[0].iso;
  const hasta = dias[dias.length - 1].iso;

  const cargar = useCallback(
    async ({ silenciosa = false } = {}) => {
      const numero = ++consulta.current;
      if (!silenciosa) setCarga((c) => ({ ...c, estado: "cargando" }));
      try {
        const lista = await inicioService.calendario(desde, hasta);
        if (montado.current && numero === consulta.current)
          setCarga({ estado: "listo", lista });
      } catch {
        if (!montado.current || numero !== consulta.current) return;
        // Al refrescar, si falla, se conserva lo que había.
        setCarga((c) =>
          silenciosa && c.estado === "listo"
            ? c
            : { estado: "error", lista: [] },
        );
      }
    },
    [desde, hasta],
  );

  useEffect(() => {
    cargar();
  }, [cargar, version]);

  const primeraRecarga = useRef(true);
  useEffect(() => {
    if (primeraRecarga.current) {
      primeraRecarga.current = false;
      return;
    }
    cargar({ silenciosa: true });
  }, [recarga]); // eslint-disable-line react-hooks/exhaustive-deps

  const delGrupo = useMemo(
    () => carga.lista.filter((e) => enGrupo(e, grupo)),
    [carga.lista, grupo],
  );
  const mapa = useMemo(() => porDia(delGrupo), [delGrupo]);

  /** Cuántas fechas de cada pestaña caen en el mes que se ve. */
  const cuentas = useMemo(() => {
    const prefijo = `${mes.anio}-${String(mes.mes).padStart(2, "0")}`;
    const delMes = carga.lista.filter(
      (e) =>
        e.fecha.slice(0, 7) <= prefijo &&
        (e.fecha_fin || e.fecha).slice(0, 7) >= prefijo,
    );
    return Object.fromEntries(
      GRUPOS_DE_EVENTO.map((g) => [
        g.id,
        delMes.filter((e) => enGrupo(e, g.id)).length,
      ]),
    );
  }, [carga.lista, mes]);

  const delDia = mapa[elegido] ?? SIN_EVENTOS;
  const proximas = useMemo(
    () =>
      unicas(delGrupo)
        .filter((e) => e.fecha > elegido)
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
        .slice(0, 3),
    [delGrupo, elegido],
  );

  function cambiarMes(delta) {
    const nuevo = moverMes(mes, delta);
    setMes(nuevo);
    // Se elige hoy si cae en ese mes; si no, el 1.
    const prefijo = `${nuevo.anio}-${String(nuevo.mes).padStart(2, "0")}`;
    setElegido(hoy.startsWith(prefijo) ? hoy : `${prefijo}-01`);
    anunciarMes(tituloDelMes(nuevo.anio, nuevo.mes));
  }

  function volverAHoy() {
    setMes({ anio: Number(hoy.slice(0, 4)), mes: Number(hoy.slice(5, 7)) });
    setElegido(hoy);
    anunciarMes(`Hoy, ${diaConNombre(hoy)}`);
  }

  const elegir = useCallback((iso) => setElegido(iso), []);
  const enEsteMes = hoy.startsWith(
    `${mes.anio}-${String(mes.mes).padStart(2, "0")}`,
  );
  const vacio =
    grupo === "celebraciones"
      ? "Sin celebraciones ese día."
      : "Sin eventos ni feriados ese día.";

  return (
    <View style={estilos.contenedor} testID="calendario-inicio">
      <View style={estilos.pestanas} accessibilityRole="tablist">
        {GRUPOS_DE_EVENTO.map((g) => {
          const activa = grupo === g.id;
          const n = carga.estado === "listo" ? cuentas[g.id] : 0;
          return (
            <Pressable
              key={g.id}
              testID={`calendario-grupo-${g.id}`}
              onPress={() => setGrupo(g.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: activa }}
              accessibilityLabel={
                n
                  ? `${g.nombre}, ${n} ${n === 1 ? "fecha" : "fechas"} este mes`
                  : g.nombre
              }
              style={({ pressed }) => [
                estilos.pestana,
                activa && estilos.pestanaActiva,
                pressed && estilos.presionado,
              ]}
            >
              <Text
                style={[
                  estilos.pestanaTexto,
                  activa && estilos.pestanaTextoActiva,
                ]}
              >
                {g.nombre}
              </Text>
              {n > 0 ? (
                <View style={[estilos.cuenta, activa && estilos.cuentaActiva]}>
                  <Text
                    style={[
                      estilos.cuentaTexto,
                      activa && estilos.cuentaTextoActiva,
                    ]}
                  >
                    {n}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={estilos.tarjeta}>
        <View style={estilos.cabeceraMes}>
          <BotonIcono
            icono="chevron-left"
            etiqueta="Mes anterior"
            onPress={() => cambiarMes(-1)}
            testID="calendario-mes-anterior"
          />
          <Text
            style={estilos.mes}
            accessibilityRole="header"
            accessibilityLiveRegion="polite"
          >
            {tituloDelMes(mes.anio, mes.mes)}
          </Text>
          <BotonIcono
            icono="chevron-right"
            etiqueta="Mes siguiente"
            onPress={() => cambiarMes(1)}
            testID="calendario-mes-siguiente"
          />
        </View>
        {!enEsteMes || elegido !== hoy ? (
          <Pressable
            testID="calendario-hoy"
            onPress={volverAHoy}
            accessibilityRole="button"
            accessibilityLabel="Volver a hoy"
            style={({ pressed }) => [
              estilos.botonHoy,
              pressed && estilos.presionado,
            ]}
          >
            <Icono nombre="calendar-today" size={18} color={colores.primario} />
            <Text style={estilos.botonHoyTexto}>Hoy</Text>
          </Pressable>
        ) : null}

        <View
          style={estilos.semana}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {DIAS_DE_LA_SEMANA.map((d) => (
            <Text key={d.corto} style={estilos.diaSemana}>
              {d.corto}
            </Text>
          ))}
        </View>

        {carga.estado === "error" ? (
          <ErrorConReintento
            texto="No se pudo cargar el calendario."
            onReintentar={() => cargar()}
          />
        ) : (
          <View
            style={[
              estilos.cuadricula,
              carga.estado === "cargando" && estilos.cargando,
            ]}
          >
            {dias.map((dia) => (
              <Dia
                key={dia.iso}
                dia={dia}
                eventos={mapa[dia.iso] ?? SIN_EVENTOS}
                esHoy={dia.iso === hoy}
                esElegido={dia.iso === elegido}
                hoy={hoy}
                onElegir={elegir}
              />
            ))}
          </View>
        )}
        {carga.estado === "cargando" ? (
          <Text style={estilos.tenue} accessibilityRole="progressbar">
            Cargando el calendario…
          </Text>
        ) : null}
      </View>

      {carga.estado === "listo" ? (
        <View style={estilos.lista} testID="calendario-lista">
          <Text style={estilos.listaTitulo} accessibilityRole="header">
            {elegido === hoy
              ? `Hoy · ${diaConNombre(elegido)}`
              : diaConNombre(elegido).replace(/^./, (c) => c.toUpperCase())}
          </Text>
          {delDia.length === 0 ? (
            <Text style={estilos.tenue}>{vacio}</Text>
          ) : (
            delDia.map((e) => <Fecha key={`${e.id}-${e.fecha}`} evento={e} />)
          )}
          {proximas.length > 0 ? (
            <>
              <Text
                style={[estilos.listaTitulo, estilos.proximasTitulo]}
                accessibilityRole="header"
              >
                Próximas fechas
              </Text>
              {proximas.map((e) => (
                <Fecha key={`p-${e.id}-${e.fecha}`} evento={e} conDia />
              ))}
            </>
          ) : null}
        </View>
      ) : null}

      <View
        style={estilos.leyenda}
        accessible
        accessibilityLabel="Leyenda: bandera, feriado; estrella, evento; regalo, cumpleaños; medalla, aniversario."
      >
        {Object.entries(TIPOS_EN_CALENDARIO).map(([t, tipo]) => (
          <View key={t} style={estilos.leyendaItem}>
            <Icono nombre={tipo.icono} size={14} color={tipo.color} />
            <Text style={estilos.leyendaTexto}>{tipo.nombre}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
  contenedor: { gap: 10 },
  pestanas: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pestana: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colores.bordeControl,
    backgroundColor: colores.superficie,
  },
  pestanaActiva: {
    backgroundColor: colores.primario,
    borderColor: colores.primario,
  },
  pestanaTexto: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  pestanaTextoActiva: { color: colores.sobrePrimario },
  cuenta: {
    minWidth: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: "center",
    backgroundColor: colores.hundido,
  },
  cuentaActiva: { backgroundColor: colores.acento },
  cuentaTexto: { fontSize: 13, fontWeight: "700", color: colores.tinta },
  cuentaTextoActiva: { color: colores.marcaNegro },
  tarjeta: {
    padding: 8,
    gap: 6,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  cabeceraMes: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  mes: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "700",
    color: colores.tinta,
  },
  botonHoy: {
    alignSelf: "center",
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
  },
  botonHoyTexto: {
    fontSize: 15,
    fontWeight: "600",
    color: colores.enlace,
    textDecorationLine: "underline",
  },
  semana: { flexDirection: "row" },
  diaSemana: {
    width: "14.2857%",
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: colores.tintaTenue,
  },
  cuadricula: { flexDirection: "row", flexWrap: "wrap" },
  cargando: { opacity: 0.5 },
  dia: {
    width: "14.2857%",
    minHeight: AREA_TACTIL,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "transparent",
  },
  diaFeriado: { backgroundColor: colores.malFondo },
  diaElegido: { borderColor: colores.primario },
  presionado: { opacity: 0.7 },
  numeroCaja: {
    minWidth: 28,
    minHeight: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  numeroHoy: { backgroundColor: colores.acento },
  numero: { fontSize: 14, color: colores.tinta },
  numeroDeOtroMes: { color: colores.tintaTenue },
  numeroTextoHoy: { fontWeight: "700", color: colores.marcaNegro },
  marcas: { flexDirection: "row", alignItems: "center", minHeight: 12, gap: 1 },
  mas: { fontSize: 11, fontWeight: "700", color: colores.tintaSuave },
  tenue: { fontSize: 14, color: colores.tintaTenue, textAlign: "center" },
  lista: {
    gap: 8,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  listaTitulo: { fontSize: 16, fontWeight: "700", color: colores.tinta },
  proximasTitulo: { marginTop: 6 },
  fecha: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  fechaIcono: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  fechaTexto: { flex: 1, gap: 1 },
  fechaTitulo: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  fechaDatos: { fontSize: 13, color: colores.tintaSuave },
  leyenda: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center",
  },
  leyendaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  leyendaTexto: { fontSize: 12, color: colores.tintaSuave },
});
