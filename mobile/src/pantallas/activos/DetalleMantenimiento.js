import { useNavigation, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { tamanoLegible } from "../../adjuntos/seleccion";
import { adjuntosService, mantenimientosService } from "../../api/servicios";
import { useVisorDeAdjuntosDeActivo } from "../../activos/adjuntos";
import { tomarResultado } from "../../activos/avisoPendiente";
import { dinero, mensajeDeActivos } from "../../activos/formato";
import { diasFuera, estadoDelMantenimiento, fechasDelMantenimiento } from "../../activos/mantenimientos";
import { Alerta, Boton, Cargando, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { VisorDeImagen } from "../../componentes/VisorDeImagen";
import { useSesion } from "../../sesion/SesionContext";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { fechaCorta, fechaYHora } from "../../utils/fechas";
import { Dato, Pildora, Seccion } from "../soporte/piezas";
import { FormularioAdjuntar, FormularioCerrarMantenimiento } from "./AccionesDelMantenimiento";
import { useMontado } from "./piezas";

export const TEXTO_MANTENIMIENTO_NO_DISPONIBLE = "Este mantenimiento no existe o ya no tiene acceso a él.";

function resultados(datos) {
  if (Array.isArray(datos)) return datos;
  return Array.isArray(datos?.results) ? datos.results : [];
}

/** Un repuesto del desglose: nombre, cantidad, costo, serie y si es pieza
 * crítica (con texto, no solo color). */
function Repuesto({ c }) {
  const partes = [
    `Cantidad: ${c.cantidad}`,
    c.costo_unitario ? `Costo unitario: ${dinero(c.costo_unitario)}` : null,
    `Total: ${dinero(c.costo_total)}`,
  ].filter(Boolean);
  return (
    <View
      style={estilos.fila}
      testID={`repuesto-${c.id}`}
      accessible
      accessibilityLabel={[
        c.componente_nombre,
        c.era_critico ? "Pieza crítica" : null,
        ...partes,
        c.numero_serie_nuevo ? `Serie nueva: ${c.numero_serie_nuevo}` : null,
        c.observaciones || null,
      ]
        .filter(Boolean)
        .join(". ")}
    >
      <View style={estilos.filaCabecera}>
        <Text style={estilos.filaTitulo}>{c.componente_nombre}</Text>
        {c.era_critico ? <Pildora texto="Pieza crítica" tono={{ fondo: colores.avisoFondo, color: colores.avisoTexto, icono: "alert-decagram-outline" }} /> : null}
      </View>
      <Text style={estilos.dato}>{partes.join(" · ")}</Text>
      {c.numero_serie_nuevo ? <Text style={estilos.tenue}>{`Serie nueva: ${c.numero_serie_nuevo}`}</Text> : null}
      {c.observaciones ? <Text style={estilos.tenue}>{c.observaciones}</Text> : null}
    </View>
  );
}

/** Un adjunto: un botón que lo abre (imagen en el visor de la app; lo demás
 * con el sistema). */
function FilaAdjunto({ a, abriendo, onAbrir }) {
  const cargando = abriendo === a.id;
  const tamano = tamanoLegible(a.tamano_bytes);
  const detalle = [a.tipo_display, tamano, a.subido_por_nombre ? `subió ${a.subido_por_nombre}` : null, fechaYHora(a.created_at)]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      testID={`adjunto-${a.id}`}
      onPress={() => onAbrir(a)}
      disabled={Boolean(abriendo)}
      accessibilityRole="button"
      accessibilityLabel={cargando ? `Abriendo ${a.nombre_original}…` : `${a.nombre_original}. ${detalle}. Abrir el adjunto`}
      accessibilityState={{ busy: cargando, disabled: Boolean(abriendo) }}
      style={({ pressed }) => [estilos.adjunto, pressed && estilos.presionada]}
    >
      {cargando ? <ActivityIndicator color={colores.primario} /> : <Icono nombre="paperclip" size={20} color={colores.primario} />}
      <View style={estilos.adjuntoTextos}>
        <Text style={estilos.adjuntoNombre}>{cargando ? `Abriendo ${a.nombre_original}…` : a.nombre_original}</Text>
        <Text style={estilos.tenue}>{detalle}</Text>
        {a.descripcion ? <Text style={estilos.tenue}>{a.descripcion}</Text> : null}
      </View>
    </Pressable>
  );
}

/**
 * El detalle de un mantenimiento (US-022, CA-13), con `GET
 * mantenimientos/{id}/`: el activo (que abre su ficha), el tipo, abierto o
 * cerrado, las fechas, quién lo hizo, causa, diagnóstico y solución, los
 * repuestos y los costos. Desde él:
 *
 * - «Registrar salida» (CA-16), si sigue abierto y con `mantenimientos.editar`;
 * - los adjuntos (CA-17): se listan con `adjuntos.ver` (`GET
 *   adjuntos/?mantenimiento=ID`) y se suben con `adjuntos.subir`. Lo
 *   descargado se borra al salir.
 *
 * `empresa`: la de un aviso. Las acciones solo se ofrecen en la empresa
 * activa, como en la ficha del activo.
 */
export function DetalleMantenimiento({ id, empresa = null }) {
  const router = useRouter();
  const navegacion = useNavigation();
  const { usuario, empresaActiva, versionEmpresa } = useSesion();
  const permisos = usuario?.permissions ?? [];
  const [carga, setCarga] = useState({ estado: "cargando", datos: null, error: null, aviso: null });
  const [adjuntos, setAdjuntos] = useState({ estado: "cargando", lista: [], error: null });
  const [refrescando, setRefrescando] = useState(false);
  const [ventana, setVentana] = useState(null);
  const [resultado, setResultado] = useState(null);
  const montado = useMontado();
  const consulta = useRef(0);
  const consultaAdjuntos = useRef(0);
  const cargaRef = useRef(carga);
  cargaRef.current = carga;
  const veAdjuntos = permisos.includes("adjuntos.ver");
  const visor = useVisorDeAdjuntosDeActivo({ empresa: empresa ?? undefined });

  const cargar = useCallback(
    async ({ silenciosa = false } = {}) => {
      const numero = ++consulta.current;
      if (!silenciosa) setCarga({ estado: "cargando", datos: null, error: null, aviso: null });
      try {
        const datos = await mantenimientosService.detalle(id, { empresa: empresa ?? undefined });
        if (!montado.current || numero !== consulta.current) return;
        setCarga({ estado: "listo", datos, error: null, aviso: null });
      } catch (e) {
        if (!montado.current || numero !== consulta.current) return;
        const noEsta = e?.response?.status === 404;
        if (silenciosa && cargaRef.current.estado === "listo" && !noEsta) {
          const aviso = `${mensajeDeActivos(e, "No se pudo actualizar el mantenimiento.")} Se muestra la última información.`;
          setCarga((c) => ({ ...c, aviso }));
        } else {
          setCarga({
            estado: "error",
            datos: null,
            error: noEsta ? TEXTO_MANTENIMIENTO_NO_DISPONIBLE : mensajeDeActivos(e, "No se pudo abrir el mantenimiento."),
            aviso: null,
          });
        }
      }
    },
    [id, empresa, montado],
  );

  const cargarAdjuntos = useCallback(async () => {
    if (!veAdjuntos) return;
    const numero = ++consultaAdjuntos.current;
    setAdjuntos((a) => ({ ...a, estado: a.estado === "listo" ? "listo" : "cargando", error: null }));
    try {
      const datos = await adjuntosService.listar({ mantenimiento: id }, { empresa: empresa ?? undefined });
      if (!montado.current || numero !== consultaAdjuntos.current) return;
      setAdjuntos({ estado: "listo", lista: resultados(datos), error: null });
    } catch (e) {
      if (!montado.current || numero !== consultaAdjuntos.current) return;
      setAdjuntos((a) => ({ ...a, estado: a.estado === "listo" ? "listo" : "error", error: mensajeDeActivos(e, "No se pudieron cargar los adjuntos.") }));
    }
  }, [veAdjuntos, id, empresa, montado]);

  // Lo que dejó el alta («registrado», a quién no le llegó el correo). En un
  // efecto y no al crear el estado: se toma una sola vez, y en modo estricto
  // el inicializador corre dos veces.
  useEffect(() => {
    const previo = tomarResultado(`mantenimiento-${id}`);
    if (previo) setResultado({ ...previo, clave: Date.now() });
  }, [id]);

  useEffect(() => {
    cargar();
  }, [cargar, versionEmpresa]);

  useEffect(() => {
    cargarAdjuntos();
  }, [cargarAdjuntos, versionEmpresa]);

  async function refrescar() {
    setRefrescando(true);
    await Promise.all([cargar({ silenciosa: cargaRef.current.estado === "listo" }), cargarAdjuntos()]);
    if (montado.current) setRefrescando(false);
  }

  function alCerrar(_actualizado, mensaje) {
    setVentana(null);
    setResultado({ texto: mensaje, clave: Date.now() });
    cargar({ silenciosa: true });
  }

  function alAdjuntar(_adjunto, mensaje) {
    setVentana(null);
    setResultado({ texto: mensaje, clave: Date.now() });
    cargarAdjuntos();
  }

  if (carga.estado === "cargando") return <Cargando texto="Cargando el mantenimiento…" />;
  if (carga.estado === "error") {
    return (
      <View style={estilos.centro}>
        <ErrorConReintento texto={carga.error} onReintentar={() => cargar()} />
      </View>
    );
  }

  const m = carga.datos ?? {};
  const estado = estadoDelMantenimiento(m);
  const dias = diasFuera(m);
  const enLaActiva = !empresa || String(empresa) === String(empresaActiva?.id ?? "");
  const puedeCerrar = enLaActiva && estado.abierto && permisos.includes("mantenimientos.editar");
  const puedeAdjuntar = enLaActiva && permisos.includes("adjuntos.subir");
  const componentes = Array.isArray(m.componentes) ? m.componentes : [];
  const repuestos = componentes.reduce((suma, c) => suma + (Number(c.costo_total) || 0), 0);

  return (
    <ScrollView
      testID="detalle-mantenimiento"
      style={estilos.pantalla}
      contentContainerStyle={estilos.contenido}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
    >
      {carga.aviso ? <Alerta tipo="aviso" texto={carga.aviso} /> : null}
      {resultado?.texto ? <Alerta tipo="bien" texto={resultado.texto} clave={resultado.clave} testID="resultado-mantenimiento" /> : null}
      {resultado?.aviso ? <Alerta tipo="aviso" texto={resultado.aviso} testID="aviso-sin-correo" /> : null}

      <View style={estilos.cabecera}>
        <Text style={estilos.codigo}>{m.activo_codigo}</Text>
        <Text style={estilos.titulo} accessibilityRole="header">
          {`${m.tipo_display || m.tipo} · ${m.activo_nombre || "Activo"}`}
        </Text>
        <Pildora texto={estado.texto} tono={estado} testID="estado-del-mantenimiento" />
        <Text style={estilos.dato}>{fechasDelMantenimiento(m)}</Text>
        {dias ? <Text style={estilos.tenue}>{dias}</Text> : null}
      </View>

      <View style={estilos.acciones}>
        {puedeCerrar ? (
          <Boton testID="registrar-salida" titulo="Registrar salida" icono="exit-to-app" onPress={() => setVentana("salida")} />
        ) : null}
        <Boton
          testID="ver-ficha-del-activo"
          titulo="Ver la ficha del activo"
          icono="monitor"
          variante="secundario"
          onPress={() => {
            // UX H-23: si se llegó desde la ficha de este mismo activo, se
            // vuelve a ella en vez de apilar otra igual.
            const estado = navegacion?.getState?.();
            const anterior = estado?.routes?.[(estado?.index ?? 0) - 1];
            if (anterior?.name === "activos/[id]" && String(anterior?.params?.id) === String(m.activo)) {
              router.back();
              return;
            }
            router.push({
              pathname: "/activos/[id]",
              params: empresa ? { id: String(m.activo), empresa: String(empresa) } : { id: String(m.activo) },
            });
          }}
        />
      </View>
      {!enLaActiva ? (
        <Alerta tipo="info" texto="Este mantenimiento es de otra empresa. Para registrar la salida o adjuntar, cámbiese a ella en «Cuenta»." />
      ) : null}

      <Seccion titulo="Intervención" testID="datos-del-mantenimiento">
        <Dato nombre="Fecha de ingreso" valor={fechaCorta(m.fecha_intervencion)} />
        <Dato nombre="Fecha de salida" valor={m.fecha_salida ? fechaCorta(m.fecha_salida) : "Sigue fuera de operación"} />
        <Dato nombre={m.tipo_responsable_display || "A cargo de"} valor={m.responsable} />
        <Dato nombre="Causa de la falla" valor={m.causa} />
        <Dato nombre="Trabajo realizado" valor={m.descripcion} />
        <Dato nombre="Diagnóstico" valor={m.diagnostico} />
        <Dato nombre="Solución aplicada" valor={m.solucion} />
        <Dato nombre="Estado final" valor={m.fecha_salida ? m.estado_final_display : null} />
        <Dato nombre="Cubierto por garantía" valor={m.garantia_usada ? "Sí" : "No"} />
        <Dato nombre="Registró" valor={m.registrado_por_nombre} />
      </Seccion>

      <Seccion titulo="Repuestos" testID="repuestos">
        {componentes.length === 0 ? (
          <Text style={estilos.tenue}>Sin repuestos.</Text>
        ) : (
          componentes.map((c) => <Repuesto key={c.id} c={c} />)
        )}
      </Seccion>

      <Seccion titulo="Costos" testID="costos-del-mantenimiento">
        <Dato nombre="Mano de obra" valor={dinero(m.costo_mano_obra ?? 0)} />
        <Dato nombre="Repuestos" valor={dinero(repuestos)} />
        <Dato nombre="Total" valor={dinero(m.costo_total ?? 0)} />
      </Seccion>

      {veAdjuntos || puedeAdjuntar ? (
        <Seccion titulo="Adjuntos" testID="adjuntos-del-mantenimiento">
          {veAdjuntos ? (
            <>
              {adjuntos.estado === "cargando" ? <Text style={estilos.tenue}>Cargando los adjuntos…</Text> : null}
              {adjuntos.error ? <ErrorConReintento texto={adjuntos.error} onReintentar={cargarAdjuntos} /> : null}
              {adjuntos.estado === "listo" && adjuntos.lista.length === 0 ? (
                <Vacio icono="paperclip" texto="Sin adjuntos." />
              ) : null}
              {adjuntos.lista.map((a) => (
                <FilaAdjunto key={a.id} a={a} abriendo={visor.abriendo} onAbrir={visor.abrir} />
              ))}
              {visor.error ? <Alerta tipo="mal" texto={visor.error.texto} clave={visor.error.clave} testID="error-adjunto" /> : null}
            </>
          ) : null}
          {puedeAdjuntar ? (
            <Boton
              testID="adjuntar"
              titulo="Adjuntar foto o archivo"
              icono="paperclip"
              variante="secundario"
              onPress={() => setVentana("adjuntar")}
            />
          ) : null}
        </Seccion>
      ) : null}

      {ventana === "salida" ? (
        <FormularioCerrarMantenimiento mantenimiento={m} onCerrar={() => setVentana(null)} onGuardado={alCerrar} />
      ) : null}
      {ventana === "adjuntar" ? (
        <FormularioAdjuntar mantenimiento={m} onCerrar={() => setVentana(null)} onGuardado={alAdjuntar} />
      ) : null}
      {visor.visor.uri ? <VisorDeImagen {...visor.visor} /> : null}
    </ScrollView>
  );
}

const estilos = crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, paddingBottom: 40, gap: 16 },
  centro: { padding: 16 },
  cabecera: { gap: 6 },
  codigo: { fontSize: 14, fontWeight: "600", color: colores.tintaSuave },
  titulo: { fontSize: 20, fontWeight: "700", color: colores.titulo },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  dato: { fontSize: 15, color: colores.tinta },
  acciones: { gap: 8 },
  fila: {
    gap: 4,
    padding: 12,
    borderRadius: 10,
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
  },
  filaCabecera: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 },
  filaTitulo: { flexShrink: 1, fontSize: 16, fontWeight: "700", color: colores.titulo },
  adjunto: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colores.bordeControl,
    backgroundColor: colores.superficie,
  },
  adjuntoTextos: { flex: 1, gap: 2 },
  adjuntoNombre: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  presionada: { backgroundColor: colores.realce },
});
