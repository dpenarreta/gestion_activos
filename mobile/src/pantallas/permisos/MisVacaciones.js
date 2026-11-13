import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { mensajeDeError } from "../../api/errores";
import { vacacionesService } from "../../api/servicios";
import { Alerta, Boton, BotonIcono, Cargando, Desplegable, ErrorConReintento } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { dias, fechaCorta, fechaLarga, palabraDias, rangoDeFechas } from "../../permisos/formato";
import { TEXTO_SIN_ROL, useResumenPermisos } from "../../permisos/ResumenPermisosContext";
import { useSesion } from "../../sesion/SesionContext";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";

/**
 * Mis vacaciones (US-010, CA-2), con los mismos datos y textos que la web
 * (`MisVacacionesPage.jsx`): lo disponible para pedir, lo gozado y lo
 * pendiente, y por cada período con días lo que corresponde, lo gozado (con
 * su detalle), lo que está en aprobación y lo disponible. Todo viene de
 * `/organizacion/vacaciones/mias/`: la app no recalcula nada.
 */
export const TEXTO_SIN_PERIODOS =
  "Aún no tiene períodos de vacaciones registrados. Los carga Talento Humano al cumplir cada año de servicio; si cree que falta alguno, escríbales.";

function diasCon(n, singular, plural) {
  return `${dias(n)} ${n === 1 ? singular : plural}`;
}

export function MisVacaciones({ foco = 0 }) {
  const router = useRouter();
  const { versionEmpresa } = useSesion();
  const { puedeSolicitar, cargado } = useResumenPermisos();
  const [estado, setEstado] = useState("cargando");
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [refrescando, setRefrescando] = useState(false);
  const montado = useRef(true);
  const consulta = useRef(0);
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(async ({ silenciosa = false } = {}) => {
    const numero = ++consulta.current;
    setAviso(null);
    if (!silenciosa) setEstado("cargando");
    try {
      const respuesta = await vacacionesService.mias();
      if (!montado.current || numero !== consulta.current) return;
      setDatos(respuesta ?? null);
      setEstado("listo");
    } catch (e) {
      if (!montado.current || numero !== consulta.current) return;
      if (silenciosa && estadoRef.current === "listo") {
        setAviso(`${mensajeDeError(e, "No se pudieron actualizar sus vacaciones.")} Se muestran las anteriores.`);
      } else {
        setError(mensajeDeError(e, "No se pudieron cargar sus vacaciones."));
        setEstado("error");
      }
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar, versionEmpresa]);

  const focoInicial = useRef(foco);
  useEffect(() => {
    if (foco !== focoInicial.current) cargar({ silenciosa: true });
  }, [foco, cargar]);

  async function refrescar() {
    setRefrescando(true);
    await cargar({ silenciosa: true });
    if (montado.current) setRefrescando(false);
  }

  let contenido;
  if (estado === "cargando") contenido = <Cargando texto="Cargando sus vacaciones…" />;
  else if (estado === "error") contenido = <ErrorConReintento texto={error} onReintentar={() => cargar()} />;
  else contenido = <Resumen datos={datos} puedeSolicitar={puedeSolicitar} sinRol={cargado && !puedeSolicitar} router={router} />;

  return (
    <ScrollView
      testID="mis-vacaciones"
      style={estilos.pantalla}
      contentContainerStyle={estilos.contenido}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
    >
      {/* Alternativa a deslizar hacia abajo (revisión de QA-UX), como ícono
          en una fila con el título para dejar más a la vista (auditoría UX,
          H-02). */}
      <View style={estilos.filaCabecera}>
        <Text style={estilos.titulo} accessibilityRole="header">
          Mis vacaciones
        </Text>
        <BotonIcono
          testID="actualizar-vacaciones"
          icono="refresh"
          variante="contorno"
          etiqueta={refrescando ? "Actualizando…" : "Actualizar la lista"}
          cargando={refrescando}
          onPress={refrescar}
        />
      </View>
      {aviso ? <Alerta tipo="mal" texto={aviso} /> : null}
      {contenido}
    </ScrollView>
  );
}

function Resumen({ datos, puedeSolicitar, sinRol, router }) {
  const todos = Array.isArray(datos?.periodos) ? datos.periodos : [];
  if (todos.length === 0) {
    return (
      <View style={estilos.vacio} accessible accessibilityLabel={TEXTO_SIN_PERIODOS}>
        <Icono nombre="white-balance-sunny" size={32} color={colores.tintaTenue} />
        <Text style={estilos.vacioTexto}>{TEXTO_SIN_PERIODOS}</Text>
      </View>
    );
  }
  // Del más antiguo al más nuevo: en ese orden se descuentan al pedir.
  const conDias = todos.filter((p) => p.pendientes > 0);
  const gozados = todos.filter((p) => !(p.pendientes > 0));
  const primeroConSaldo = conDias.find((p) => p.disponibles > 0);
  const regla = datos.regla;
  const disponibles = Number(datos.disponibles) || 0;

  return (
    <View style={estilos.bloques}>
      <View style={estilos.resumen}>
        <View style={estilos.cifraPrincipal} accessible accessibilityLabel={`Disponibles para pedir: ${dias(disponibles)}`}>
          <Text style={estilos.cifraEtiqueta}>Disponibles para pedir</Text>
          {/* La cifra con su unidad (auditoría UX, H-18). */}
          <Text style={estilos.cifraGrande}>
            {disponibles}
            <Text style={estilos.cifraUnidad}> {palabraDias(disponibles)}</Text>
          </Text>
        </View>
        <Text style={estilos.resumenTexto}>
          {datos.reservados > 0 ? `${diasCon(datos.reservados, "en aprobación", "en aprobación")} · ` : ""}
          {datos.periodos_con_pendientes === 0
            ? "No tiene días pendientes."
            : `Pendientes de gozar: ${dias(Number(datos.pendientes) || 0)}, en ${datos.periodos_con_pendientes} ${
                datos.periodos_con_pendientes === 1 ? "período" : "períodos"
              }.`}
        </Text>
        <Text style={estilos.resumenTexto}>
          Gozados: {datos.gozados} de {datos.correspondientes} que corresponden en {todos.length}{" "}
          {todos.length === 1 ? "período" : "períodos"}.
        </Text>
        {puedeSolicitar &&
          (disponibles > 0 ? (
            <Boton
              testID="solicitar-vacaciones"
              titulo="Solicitar vacaciones"
              icono="plus"
              onPress={() => router.push({ pathname: "/permisos/nueva", params: { tipo: "vacaciones" } })}
            />
          ) : (
            <Text style={estilos.tenue}>Sin días disponibles para pedir.</Text>
          ))}
        {sinRol ? <Alerta tipo="aviso" texto={TEXTO_SIN_ROL} /> : null}
      </View>

      {datos.en_curso?.length > 0 && (
        <View style={estilos.tarjeta}>
          <Text style={estilos.subtitulo} accessibilityRole="header">
            Solicitudes de vacaciones en aprobación
          </Text>
          {datos.en_curso.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => router.push(`/permisos/solicitud/${s.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Del ${fechaLarga(s.desde)} al ${fechaLarga(s.hasta)}, ${dias(s.dias)}${
                s.paso ? `, en «${s.paso}»` : ""
              }`}
              accessibilityHint="Abre el detalle de la solicitud"
              style={({ pressed }) => [estilos.enCurso, pressed && estilos.presionada]}
            >
              <Text style={estilos.enlace}>{rangoDeFechas(s.desde, s.hasta)}</Text>
              <Text style={estilos.tenue}>
                {dias(s.dias)}
                {s.paso ? ` · en «${s.paso}»` : ""}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {(regla?.sabados > 0 || regla?.domingos > 0) && <ReglaDeFines regla={regla} />}

      {conDias.length === 0 ? (
        <View style={estilos.vacio} accessible>
          <Icono nombre="check-circle-outline" size={32} color={colores.bienTexto} />
          <Text style={estilos.vacioTexto}>No tiene días pendientes: todos sus períodos están gozados.</Text>
        </View>
      ) : (
        conDias.map((p) => (
          <Periodo key={p.id} periodo={p} regla={regla} primero={conDias.length > 1 && p === primeroConSaldo} />
        ))
      )}

      {gozados.length > 0 && conDias.length > 0 && (
        <View style={estilos.tarjeta}>
          <Text style={estilos.subtitulo} accessibilityRole="header">
            {gozados.length === 1 ? "Período ya gozado por completo" : "Períodos ya gozados por completo"}
          </Text>
          {gozados.map((p) => (
            <Text key={p.id} style={estilos.texto}>
              Período {p.nombre} ({fechaCorta(p.desde)} al {fechaCorta(p.hasta)}) ·{" "}
              {diasCon(p.gozados, "gozado", "gozados")} de {p.correspondientes}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

export const TEXTO_FINES_DETALLE =
  "Si al completarse el período faltan, se marcan por defecto los siguientes a la solicitud (aparecen como «Por defecto» en lo gozado). Para elegirlos usted, inclúyalos al pedir sus vacaciones.";

/** La regla de los fines de semana: una línea y, si se pide, el detalle
 * (auditoría UX, H-24: eran unas 60 palabras de entrada). */
function ReglaDeFines({ regla }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <View style={estilos.regla} testID="regla-fines">
      <Text style={estilos.reglaTexto}>
        De cada período deben salir al menos {regla.sabados} {regla.sabados === 1 ? "sábado" : "sábados"} y{" "}
        {regla.domingos} {regla.domingos === 1 ? "domingo" : "domingos"}.
      </Text>
      <Desplegable titulo="Más información" abierto={abierto} onCambiar={setAbierto} testID="regla-fines-mas">
        <Text style={estilos.reglaTexto}>{TEXTO_FINES_DETALLE}</Text>
      </Desplegable>
    </View>
  );
}

function Periodo({ periodo: p, regla, primero }) {
  const finesCompletos = regla && p.sabados >= regla.sabados && p.domingos >= regla.domingos;
  return (
    <View style={estilos.tarjeta} testID={`periodo-${p.id}`}>
      <Text style={estilos.subtitulo} accessibilityRole="header">
        Período {p.nombre}
      </Text>
      <Text style={estilos.tenue}>
        Del {fechaCorta(p.desde)} al {fechaCorta(p.hasta)}
      </Text>
      <View style={estilos.marcas}>
        {/* El fondo redondeado va en un View: en un Text, iOS no recorta
            el `borderRadius`. */}
        <View style={[estilos.marca, estilos.marcaBien]}>
          <Text style={estilos.marcaTextoBien}>{diasCon(p.disponibles, "disponible", "disponibles")}</Text>
        </View>
        {primero ? (
          <View style={[estilos.marca, estilos.marcaNeutra]}>
            <Text style={estilos.marcaTextoNeutro}>Se descuenta primero</Text>
          </View>
        ) : null}
      </View>
      <View style={estilos.cifras}>
        {[
          ["Corresponden", p.correspondientes],
          ["Gozados", p.gozados],
          ["En aprobación", p.reservados],
          ["Disponibles", p.disponibles],
        ].map(([nombre, valor]) => (
          <View key={nombre} style={estilos.cifra} accessible accessibilityLabel={`${nombre}: ${valor}`}>
            <Text style={estilos.cifraEtiqueta}>{nombre}</Text>
            <Text style={estilos.cifraValor}>{valor}</Text>
          </View>
        ))}
      </View>
      {(regla?.sabados > 0 || regla?.domingos > 0) && (
        <Text style={estilos.texto}>
          Fines de semana: {Math.min(p.sabados, regla.sabados)} de {regla.sabados}{" "}
          {regla.sabados === 1 ? "sábado" : "sábados"} · {Math.min(p.domingos, regla.domingos)} de{" "}
          {regla.domingos} {regla.domingos === 1 ? "domingo" : "domingos"} ·{" "}
          {finesCompletos ? "Completos" : "Faltan"}
        </Text>
      )}
      {p.goces?.length > 0 ? (
        <View style={estilos.goces}>
          <Text style={estilos.etiquetaGoces}>Días gozados</Text>
          {p.goces.map((g) => (
            <View
              key={g.id}
              style={estilos.goce}
              accessible
              accessibilityLabel={`Gozadas del ${fechaLarga(g.desde)} al ${fechaLarga(g.hasta)}: ${dias(g.dias)}. ${
                g.por_defecto ? "Por defecto. " : ""
              }${g.descripcion || ""}`}
            >
              <Text style={estilos.texto}>
                {rangoDeFechas(g.desde, g.hasta)} · {dias(g.dias)}
              </Text>
              <Text style={estilos.tenue}>
                {g.por_defecto ? "Por defecto · " : ""}
                {g.descripcion || "—"}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={estilos.tenue}>Todavía no ha gozado días de este período.</Text>
      )}
      {p.nota ? <Text style={estilos.tenue}>{p.nota}</Text> : null}
    </View>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1 },
  contenido: { padding: 16, paddingTop: 8, gap: 12, paddingBottom: 32 },
  bloques: { gap: 12 },
  resumen: {
    gap: 8,
    padding: 16,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  cifraPrincipal: { gap: 2 },
  cifraGrande: { fontSize: 36, fontWeight: "700", color: colores.bienTexto },
  cifraUnidad: { fontSize: 18, fontWeight: "600", color: colores.bienTexto },
  filaCabecera: { flexDirection: "row", alignItems: "center", gap: 10 },
  titulo: { flex: 1, fontSize: 18, fontWeight: "700", color: colores.tinta },
  regla: { gap: 4, padding: 12, borderRadius: 8, backgroundColor: colores.infoFondo },
  reglaTexto: { fontSize: 15, color: colores.infoTexto },
  resumenTexto: { fontSize: 15, color: colores.tintaSuave },
  tarjeta: {
    gap: 6,
    padding: 14,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  subtitulo: { fontSize: 17, fontWeight: "700", color: colores.tinta },
  texto: { fontSize: 15, color: colores.tinta },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  enlace: { fontSize: 15, color: colores.enlace, textDecorationLine: "underline" },
  enCurso: { minHeight: AREA_TACTIL, justifyContent: "center", paddingVertical: 4 },
  presionada: { backgroundColor: colores.realce },
  marcas: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  // «Disponibles» en verde (5,7:1 sobre su fondo). El redondeo va en el View.
  marca: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, overflow: "hidden" },
  marcaBien: { backgroundColor: colores.bienFondo },
  marcaNeutra: { backgroundColor: colores.hundido },
  marcaTextoBien: { fontSize: 13, fontWeight: "700", color: colores.bienTexto },
  marcaTextoNeutro: { fontSize: 13, fontWeight: "700", color: colores.tintaSuave },
  cifras: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cifra: {
    flexGrow: 1,
    flexBasis: 120,
    padding: 8,
    borderRadius: 8,
    backgroundColor: colores.realce,
  },
  cifraEtiqueta: { fontSize: 13, color: colores.tintaSuave },
  cifraValor: { fontSize: 20, fontWeight: "700", color: colores.tinta },
  goces: { gap: 6, marginTop: 4 },
  etiquetaGoces: { fontSize: 14, fontWeight: "700", color: colores.tinta },
  goce: { paddingVertical: 4, borderTopWidth: 1, borderTopColor: colores.borde },
  vacio: { padding: 24, alignItems: "center", gap: 12 },
  vacioTexto: { fontSize: 15, color: colores.tintaTenue, textAlign: "center" },
});
