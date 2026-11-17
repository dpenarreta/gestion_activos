import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";

import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { solicitudesService } from "../../api/servicios";
import { dejarResultado } from "../../activos/avisoPendiente";
import { mensajeDeActivos, puedePedirEquipos, veMisSolicitudes } from "../../activos/formato";
import { hoyIso } from "../../activos/mantenimientos";
import {
  caracteristicasDe,
  CLASES,
  cuerpoDeSolicitud,
  erroresDeEspecificaciones,
  hayCambiosEnLaSolicitud,
  LARGO_DETALLE,
  PRIORIDADES,
  textoDelAvisoDeSolicitud,
  validarSolicitud,
  valoresDeSolicitud,
} from "../../activos/solicitudes";
import { Alerta, Boton, Cargando, ErrorConReintento } from "../../componentes/comunes";
import { ErrorDeCampo, OpcionesEnLinea, SelectorDeLista } from "../../componentes/Selectores";
import { SelectorFecha } from "../../componentes/SelectorFecha";
import { useAlturaCabecera } from "../../navegador/alturaCabecera";
import { useSesion } from "../../sesion/SesionContext";
import { useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { CampoTexto } from "../permisos/piezas";
import { errorDeGuardado, textoRevise, useCandado, useReenvioConfirmado, useSalirConCambios } from "./formularios";
import { useMontado } from "./piezas";
import { rutaDeLaSolicitud } from "./Solicitudes";

export const TEXTO_SIN_PERMISO_PEDIR = "No tiene permiso para pedir equipos en esta empresa.";

/** Los campos en el orden de la pantalla. */
const CAMPOS = {
  clase: "Qué necesita",
  tipo_dispositivo: "Tipo de dispositivo",
  componente: "Componente",
  detalle: "Detalle",
  especificaciones: "Características",
  cantidad: "Cantidad",
  prioridad: "Prioridad",
  fecha_necesaria: "Se necesita para",
  encargado: "Quién realizará la compra",
  justificacion: "Para qué hace falta",
};

const SI_NO = [
  { valor: "", texto: "Sin especificar" },
  { valor: "true", texto: "Sí" },
  { valor: "false", texto: "No" },
];

/** Una característica del tipo como campo, según su dato (como
 * `EspecificacionesDelTipo` de la web): número, sí/no, lista, fecha o texto.
 * La usa también el alta y la edición de un activo (US-023, CA-3). */
export function CampoDeCaracteristica({ c, valor, error, onCambio, deshabilitado, refFoco }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const etiqueta = `${c.nombre}${c.unidad ? ` (${c.unidad})` : ""}`;
  const comun = { etiqueta, obligatorio: Boolean(c.obligatoria), opcional: !c.obligatoria, error, deshabilitado };
  if (c.dato === "booleano") {
    return (
      <OpcionesEnLinea
        {...comun}
        refFoco={refFoco}
        testID={`espec-${c.id}`}
        opciones={SI_NO}
        valor={valor === true ? "true" : valor === false ? "false" : ""}
        onCambio={(v) => onCambio(v === "" ? "" : v === "true")}
      />
    );
  }
  if (c.dato === "lista") {
    return (
      <SelectorDeLista
        {...comun}
        refFoco={refFoco}
        testID={`espec-${c.id}`}
        opciones={(c.opciones ?? []).map((o) => ({ valor: o, texto: o }))}
        valor={valor ?? ""}
        vacio="Sin especificar"
        conVacio
        onCambio={(v) => onCambio(v ?? "")}
      />
    );
  }
  if (c.dato === "fecha") {
    return (
      <View style={estilos.campo}>
        <SelectorFecha
          etiqueta={etiqueta}
          obligatorio={Boolean(c.obligatoria)}
          refFoco={refFoco}
          testID={`espec-${c.id}`}
          valor={valor ?? ""}
          error={error}
          deshabilitado={deshabilitado}
          onCambio={onCambio}
        />
        {valor ? (
          <Boton
            titulo={`Quitar ${c.nombre}`}
            icono="calendar-remove"
            variante="secundario"
            deshabilitado={deshabilitado}
            onPress={() => onCambio("")}
          />
        ) : null}
      </View>
    );
  }
  const numerico = c.dato === "numero" || c.dato === "entero";
  return (
    <CampoTexto
      {...comun}
      refFoco={refFoco}
      testID={`espec-${c.id}`}
      teclado={numerico ? (c.dato === "entero" ? "number-pad" : "decimal-pad") : undefined}
      multilinea={c.dato === "texto_ampliado"}
      maximo={c.dato === "texto_ampliado" ? 2000 : 200}
      valor={valor === undefined || valor === null ? "" : String(valor)}
      onCambio={onCambio}
    />
  );
}

/**
 * «Nueva solicitud» de un equipo (US-022, CA-19), como `SolicitudForm.jsx`
 * de la web: qué se necesita (un dispositivo o un componente), del catálogo
 * (`GET solicitudes/catalogo/`) o descrito a mano (hasta 200 caracteres), con
 * las características que declara el tipo, la cantidad, la prioridad, la
 * fecha en que se necesita, el encargado (`GET solicitudes/encargados/`) y la
 * justificación. Envía `POST solicitudes/`.
 *
 * Un solo envío aunque se toque dos veces; los 400 junto a su campo (también
 * en cada característica); salir con cambios pregunta. Al enviar se abre el
 * detalle, que dice si al encargado no le llegó el correo.
 */
export function NuevaSolicitudDeEquipo() {
  const estilos = useEstilos(fabricaDeEstilos);
  const router = useRouter();
  const alturaCabecera = useAlturaCabecera();
  const { usuario } = useSesion();
  // El catálogo y los encargados son lecturas: piden `solicitudes.ver`;
  // enviar pide `solicitudes.crear` (QA-FUNC B1).
  const permisosDeSesion = usuario?.permissions ?? [];
  const puedePedir = veMisSolicitudes(permisosDeSesion) && puedePedirEquipos(permisosDeSesion);
  const [hoy] = useState(() => hoyIso());
  const [valores, setValores] = useState(valoresDeSolicitud);
  const [catalogos, setCatalogos] = useState({ estado: "cargando", catalogo: null, encargados: [], fallos: {} });
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const montado = useMontado();
  const candado = useCandado();
  const reenvio = useReenvioConfirmado();
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const { salir } = useSalirConCambios(hayCambiosEnLaSolicitud(valores) && !enviando);

  const cargar = useCallback(async () => {
    setCatalogos((c) => ({ ...c, estado: "cargando" }));
    const [catalogo, encargados] = await Promise.allSettled([solicitudesService.catalogo(), solicitudesService.encargados()]);
    if (!montado.current) return;
    const fallos = {};
    if (catalogo.status === "rejected") fallos.catalogo = mensajeDeActivos(catalogo.reason, "No se pudo cargar el catálogo.");
    if (encargados.status === "rejected") {
      fallos.encargado = mensajeDeActivos(encargados.reason, "No se pudo cargar a quién asignarle la solicitud.");
    }
    setCatalogos({
      estado: fallos.catalogo && fallos.encargado ? "error" : "listo",
      catalogo: catalogo.status === "fulfilled" ? catalogo.value : null,
      encargados: encargados.status === "fulfilled" && Array.isArray(encargados.value) ? encargados.value : [],
      fallos,
    });
  }, [montado]);

  useEffect(() => {
    if (puedePedir) cargar();
  }, [cargar, puedePedir]);

  const esDispositivo = valores.clase === "dispositivo";
  const opcionesDelCatalogo = useMemo(() => {
    const lista = esDispositivo ? catalogos.catalogo?.tipos_dispositivo : catalogos.catalogo?.componentes;
    return (lista ?? []).map((x) => ({ valor: String(x.id), texto: x.nombre }));
  }, [catalogos.catalogo, esDispositivo]);
  const opcionesDeEncargado = useMemo(
    () => catalogos.encargados.map((p) => ({ valor: String(p.id), texto: p.nombre })),
    [catalogos.encargados],
  );
  const caracteristicas = caracteristicasDe(catalogos.catalogo, valores);
  const erroresEspec = errores.especificaciones && typeof errores.especificaciones === "object" ? errores.especificaciones : {};

  function fijar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    if (errores[campo]) setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  function cambiarClase(clase) {
    // Una solicitud no lleva un tipo y un componente a la vez: lo elegido de
    // la otra clase se limpia (y sus características).
    setValores((v) => ({ ...v, clase, tipo_dispositivo: "", componente: "", especificaciones: {} }));
    setErrores((e) => ({ ...e, clase: undefined, tipo_dispositivo: undefined, componente: undefined, especificaciones: undefined }));
  }

  function elegirDelCatalogo(valor) {
    const campo = esDispositivo ? "tipo_dispositivo" : "componente";
    // Las características de un tipo no describen otro.
    setValores((v) => ({ ...v, [campo]: String(valor ?? ""), especificaciones: esDispositivo ? {} : v.especificaciones }));
    setErrores((e) => ({ ...e, [campo]: undefined, detalle: undefined, especificaciones: undefined }));
  }

  function fijarEspecificacion(nombre, valor) {
    setValores((v) => {
      const siguiente = { ...v.especificaciones };
      if (valor === "" || valor === null || valor === undefined) delete siguiente[nombre];
      else siguiente[nombre] = valor;
      return { ...v, especificaciones: siguiente };
    });
    if (erroresEspec[nombre]) setErrores((e) => ({ ...e, especificaciones: { ...erroresEspec, [nombre]: undefined } }));
  }

  function mostrarErrores(campos, texto) {
    setErrores(campos);
    setError({ texto, clave: Date.now() });
    const primero = Object.keys(CAMPOS).find((c) =>
      c === "especificaciones" ? Object.values(campos.especificaciones ?? {}).some(Boolean) : campos[c],
    );
    if (primero === "especificaciones") {
      const nombre = caracteristicas.find((c) => campos.especificaciones?.[c.nombre])?.nombre;
      irA("especificaciones", { control: nombre ? `espec-${nombre}` : "especificaciones" });
    } else {
      irA(primero);
    }
  }

  async function enviar() {
    if (!candado.tomar()) return;
    const encontrados = validarSolicitud(valores, catalogos.catalogo, hoyIso());
    if (Object.keys(encontrados).length) {
      candado.soltar();
      mostrarErrores(encontrados, textoRevise(encontrados, CAMPOS));
      return;
    }
    if (!(await reenvio.confirmar())) {
      candado.soltar();
      return;
    }
    if (!montado.current) return;
    setErrores({});
    setError(null);
    setEnviando(true);
    try {
      const creada = await solicitudesService.crear(cuerpoDeSolicitud(valores, catalogos.catalogo));
      if (!montado.current) return;
      reenvio.limpiar();
      dejarResultado(`solicitud-${creada.id}`, {
        texto: `Solicitud #${creada.id} enviada${creada.encargado_nombre ? ` a ${creada.encargado_nombre}` : ""}.`,
        aviso: textoDelAvisoDeSolicitud(creada.aviso, { creada: true }),
      });
      salir(() => router.replace(rutaDeLaSolicitud(creada)));
    } catch (e) {
      if (!montado.current) return;
      const fallo = errorDeGuardado(e, "No se pudo registrar la solicitud.", CAMPOS);
      reenvio.marcar(fallo);
      const deEspec = erroresDeEspecificaciones(e);
      const campos = Object.keys(deEspec).length ? { ...fallo.campos, especificaciones: deEspec } : fallo.campos;
      const texto = Object.keys(deEspec).length && Object.keys(fallo.campos).length === 0 ? textoRevise(campos, CAMPOS) : fallo.texto;
      mostrarErrores(campos, texto);
    } finally {
      candado.soltar();
      if (montado.current) setEnviando(false);
    }
  }

  if (!puedePedir) {
    return (
      <View style={estilos.centro}>
        <Alerta tipo="info" texto={TEXTO_SIN_PERMISO_PEDIR} testID="sin-permiso-pedir" />
      </View>
    );
  }
  if (catalogos.estado === "cargando" && !catalogos.catalogo) return <Cargando texto="Cargando el catálogo…" />;
  if (catalogos.estado === "error") {
    return (
      <View style={estilos.centro}>
        <ErrorConReintento texto={catalogos.fallos.catalogo} onReintentar={cargar} />
      </View>
    );
  }

  const campoDelCatalogo = esDispositivo ? "tipo_dispositivo" : "componente";
  const delCatalogo = esDispositivo ? valores.tipo_dispositivo : valores.componente;

  return (
    <KeyboardAvoidingView
      style={estilos.pantalla}
      behavior="padding"
      enabled={Platform.OS === "android"}
      keyboardVerticalOffset={alturaCabecera}
    >
      <ScrollView
        ref={desplazable}
        testID="nueva-solicitud-equipo"
        style={estilos.pantalla}
        contentContainerStyle={estilos.contenido}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        automaticallyAdjustKeyboardInsets
      >
        <Text style={estilos.titulo} accessibilityRole="header">
          ¿Qué necesita?
        </Text>
        <Text style={estilos.tenue}>
          Pida un dispositivo o un componente que todavía no existe en el inventario. Le llegará a quien elija como
          encargado de la compra.
        </Text>
        {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="solicitud-error" /> : null}
        <Text style={estilos.leyenda}>Los campos con * son obligatorios.</Text>

        <View {...bloque("clase")}>
          <OpcionesEnLinea
            testID="solicitud-clase"
            refFoco={refFoco("clase")}
            etiqueta="Qué necesita"
            obligatorio
            opciones={CLASES}
            valor={valores.clase}
            error={errores.clase}
            deshabilitado={enviando}
            onCambio={cambiarClase}
          />
        </View>

        <View {...bloque(campoDelCatalogo)}>
          <SelectorDeLista
            testID="solicitud-catalogo"
            refFoco={refFoco(campoDelCatalogo)}
            etiqueta={esDispositivo ? "Tipo de dispositivo" : "Componente"}
            ayuda={
              catalogos.fallos.catalogo ??
              (esDispositivo
                ? "Del catálogo, si está: trae sus características. Si no está, descríbalo abajo."
                : "Del catálogo de repuestos, si está. Si no está, descríbalo abajo.")
            }
            opciones={opcionesDelCatalogo}
            valor={delCatalogo}
            vacio="No está en el catálogo"
            conVacio
            buscable
            error={errores[campoDelCatalogo]}
            deshabilitado={enviando}
            onCambio={elegirDelCatalogo}
          />
        </View>

        <View {...bloque("detalle")}>
          <CampoTexto
            testID="solicitud-detalle"
            refFoco={refFoco("detalle")}
            etiqueta="Detalle"
            obligatorio={!delCatalogo}
            opcional={Boolean(delCatalogo)}
            ayuda={
              delCatalogo
                ? "Lo que el catálogo no dice (por ejemplo, «con 32 GB para diseño»)."
                : "Describa qué necesita: no eligió nada del catálogo."
            }
            maximo={LARGO_DETALLE}
            valor={valores.detalle}
            error={errores.detalle}
            deshabilitado={enviando}
            onCambio={(v) => fijar("detalle", v)}
          />
        </View>

        {caracteristicas.length > 0 ? (
          <View {...bloque("especificaciones")} style={estilos.campo} testID="caracteristicas">
            <Text ref={refFoco("especificaciones")} style={estilos.subtitulo} accessibilityRole="header">
              Con qué características
            </Text>
            <Text style={estilos.tenue}>
              Las que declara el tipo. Las marcadas con * hay que especificarlas; el resto, solo si su pedido lo exige.
            </Text>
            {caracteristicas.map((c) => (
              <CampoDeCaracteristica
                key={c.id}
                c={c}
                refFoco={refFoco(`espec-${c.nombre}`)}
                valor={valores.especificaciones?.[c.nombre]}
                error={erroresEspec[c.nombre]}
                deshabilitado={enviando}
                onCambio={(v) => fijarEspecificacion(c.nombre, v)}
              />
            ))}
          </View>
        ) : null}

        <View {...bloque("cantidad")}>
          <CampoTexto
            testID="solicitud-cantidad"
            refFoco={refFoco("cantidad")}
            etiqueta="Cantidad"
            obligatorio
            teclado="number-pad"
            maximo={5}
            valor={valores.cantidad}
            error={errores.cantidad}
            deshabilitado={enviando}
            onCambio={(v) => fijar("cantidad", v)}
          />
        </View>

        <View {...bloque("prioridad")}>
          <OpcionesEnLinea
            testID="solicitud-prioridad"
            refFoco={refFoco("prioridad")}
            etiqueta="Prioridad"
            obligatorio
            opciones={PRIORIDADES}
            valor={valores.prioridad}
            error={errores.prioridad}
            deshabilitado={enviando}
            onCambio={(v) => fijar("prioridad", v)}
          />
        </View>

        <View {...bloque("fecha_necesaria")} style={estilos.campo}>
          <SelectorFecha
            testID="solicitud-fecha"
            refFoco={refFoco("fecha_necesaria")}
            etiqueta="Se necesita para (opcional)"
            valor={valores.fecha_necesaria}
            minimo={hoy}
            ayuda="Vacío significa que no hay fecha comprometida."
            error={errores.fecha_necesaria}
            deshabilitado={enviando}
            onCambio={(v) => fijar("fecha_necesaria", v)}
          />
          {valores.fecha_necesaria ? (
            <Boton
              testID="quitar-fecha-necesaria"
              titulo="Quitar la fecha"
              icono="calendar-remove"
              variante="secundario"
              deshabilitado={enviando}
              onPress={() => fijar("fecha_necesaria", "")}
            />
          ) : null}
        </View>

        <View {...bloque("encargado")}>
          <SelectorDeLista
            testID="solicitud-encargado"
            refFoco={refFoco("encargado")}
            etiqueta="Quién realizará la compra"
            obligatorio
            ayuda={
              catalogos.fallos.encargado ??
              "Solo aparecen quienes pueden gestionar compras: le llegará un aviso y la verá en sus «Recibidas»."
            }
            opciones={opcionesDeEncargado}
            valor={valores.encargado}
            vacio="Elija a quién le llega"
            buscable
            error={errores.encargado}
            deshabilitado={enviando}
            onCambio={(v) => fijar("encargado", String(v ?? ""))}
          />
        </View>
        {catalogos.fallos.encargado || catalogos.fallos.catalogo ? (
          <Boton titulo="Volver a cargar el catálogo" icono="refresh" variante="secundario" onPress={cargar} />
        ) : null}

        <View {...bloque("justificacion")}>
          <CampoTexto
            testID="solicitud-justificacion"
            refFoco={refFoco("justificacion")}
            etiqueta="Para qué hace falta"
            obligatorio
            ayuda="Es lo que sostiene la compra ante quien la autoriza."
            placeholder="Entra un analista el 1 de octubre y no hay equipo libre."
            multilinea
            valor={valores.justificacion}
            error={errores.justificacion}
            deshabilitado={enviando}
            onCambio={(v) => fijar("justificacion", v)}
          />
        </View>
        <ErrorDeCampo error={typeof errores.especificaciones === "string" ? errores.especificaciones : null} />

        <Boton
          testID="enviar-solicitud"
          titulo={enviando ? "Enviando…" : "Enviar solicitud"}
          icono="send"
          cargando={enviando}
          onPress={enviar}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 16, paddingBottom: 40 },
  centro: { padding: 16 },
  campo: { gap: 8 },
  titulo: { fontSize: 22, fontWeight: "700", color: colores.titulo },
  subtitulo: { fontSize: 17, fontWeight: "700", color: colores.titulo },
  leyenda: { fontSize: 14, color: colores.tintaSuave },
  tenue: { fontSize: 14, color: colores.tintaSuave },
});
