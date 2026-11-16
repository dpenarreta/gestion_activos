import { useRef, useState } from "react";
import { Text, View } from "react-native";

import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { tamanoLegible } from "../../adjuntos/seleccion";
import { adjuntosService, mantenimientosService } from "../../api/servicios";
import {
  elegirArchivoDelEquipo,
  elegirImagenDelEquipo,
  TEXTO_AYUDA_ARCHIVO,
  tomarFotoDelEquipo,
  useArchivoPorEnviar,
} from "../../activos/adjuntos";
import {
  cuerpoDelCierre,
  diasEntre,
  ESTADOS_FINALES,
  FINALES_SIN_VUELTA,
  hoyIso,
  LARGO_DESCRIPCION_ADJUNTO,
  resultadoDelCierre,
  textoDelAvisoDeMantenimiento,
  TEXTO_SIN_VUELTA,
  TIPOS_DE_ADJUNTO,
  validarCierre,
  valoresDeCierre,
} from "../../activos/mantenimientos";
import { Alerta, Boton, BotonIcono } from "../../componentes/comunes";
import { confirmarDescarte } from "../../componentes/confirmarDescarte";
import { Icono } from "../../componentes/Icono";
import { ErrorDeCampo, OpcionesEnLinea, SelectorDeLista } from "../../componentes/Selectores";
import { SelectorFecha } from "../../componentes/SelectorFecha";
import { Ventana } from "../../componentes/Ventana";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { crearEstilos } from "../../tema/tipografia";
import { CampoTexto } from "../permisos/piezas";
import { errorDeGuardado, textoRevise, useCandado, useReenvioConfirmado } from "./formularios";
import { useMontado } from "./piezas";

/**
 * «Registrar salida» (CA-16) y «Adjuntar» (CA-17) desde el detalle de un
 * mantenimiento, cada uno en su ventana, con las reglas de la ficha: candado
 * contra el doble envío, errores junto a su campo, «puede haberse guardado»
 * sin respuesta clara y `confirmarDescarte` al cerrar con cambios.
 */

function subtituloDe(m) {
  return [m?.activo_codigo, m?.activo_nombre].filter(Boolean).join(" · ");
}

// --- Registrar salida (CA-16) -------------------------------------------------------

const CAMPOS_CIERRE = { fecha_salida: "Fecha de salida", solucion: "Solución aplicada", estado_final: "Estado final" };

/**
 * «Registrar salida»: la fecha en que el equipo salió del taller (no futura,
 * no antes del ingreso), la solución y el estado final. Envía `PATCH
 * mantenimientos/{id}/` solo con eso; el servidor devuelve el equipo a su
 * estado anterior, salvo con «No reparable» o «Dado de baja».
 */
export function FormularioCerrarMantenimiento({ mantenimiento, onCerrar, onGuardado }) {
  const [hoy] = useState(() => hoyIso());
  const [iniciales] = useState(() => valoresDeCierre(mantenimiento, hoy));
  const [valores, setValores] = useState(iniciales);
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const montado = useMontado();
  const candado = useCandado();
  const reenvio = useReenvioConfirmado();
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const dias = diasEntre(mantenimiento?.fecha_intervencion, valores.fecha_salida);
  const conCambios = Object.keys(iniciales).some((c) => iniciales[c] !== valores[c]);

  function fijar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    if (errores[campo]) setErrores((e) => ({ ...e, [campo]: undefined }));
  }

  async function cerrar() {
    if (guardando) return;
    if (conCambios && !(await confirmarDescarte())) return;
    onCerrar();
  }

  function mostrarErrores(campos, texto) {
    setErrores(campos);
    setError({ texto, clave: Date.now() });
    irA(Object.keys(CAMPOS_CIERRE).find((c) => campos[c]));
  }

  async function guardar() {
    if (!candado.tomar()) return;
    const encontrados = validarCierre(mantenimiento, valores, hoyIso());
    if (Object.keys(encontrados).length) {
      candado.soltar();
      mostrarErrores(encontrados, textoRevise(encontrados, CAMPOS_CIERRE));
      return;
    }
    if (!(await reenvio.confirmar())) {
      candado.soltar();
      return;
    }
    if (!montado.current) return;
    setErrores({});
    setError(null);
    setGuardando(true);
    try {
      const actualizado = await mantenimientosService.cerrar(mantenimiento.id, cuerpoDelCierre(valores));
      if (!montado.current) return;
      reenvio.limpiar();
      const aviso = textoDelAvisoDeMantenimiento(actualizado?.aviso);
      onGuardado(actualizado, [resultadoDelCierre(valores), aviso].filter(Boolean).join(" "));
    } catch (e) {
      if (!montado.current) return;
      const fallo = errorDeGuardado(e, "No se pudo registrar la salida.", CAMPOS_CIERRE);
      reenvio.marcar(fallo);
      mostrarErrores(fallo.campos, fallo.texto);
    } finally {
      candado.soltar();
      if (montado.current) setGuardando(false);
    }
  }

  return (
    <Ventana
      titulo="Registrar salida"
      subtitulo={subtituloDe(mantenimiento)}
      onCerrar={cerrar}
      ocupada={guardando}
      refDesplazable={desplazable}
      testID="ventana-salida"
    >
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="salida-error" /> : null}
      <Text style={estilos.leyenda}>Los campos con * son obligatorios.</Text>
      <View {...bloque("fecha_salida")}>
        <SelectorFecha
          testID="salida-fecha"
          refFoco={refFoco("fecha_salida")}
          etiqueta="Fecha de salida"
          obligatorio
          valor={valores.fecha_salida}
          minimo={mantenimiento?.fecha_intervencion}
          maximo={hoy}
          ayuda={dias === null ? undefined : `${dias} ${dias === 1 ? "día" : "días"} fuera de operación.`}
          error={errores.fecha_salida}
          deshabilitado={guardando}
          onCambio={(v) => fijar("fecha_salida", v)}
        />
      </View>
      <View {...bloque("solucion")}>
        <CampoTexto
          testID="salida-solucion"
          refFoco={refFoco("solucion")}
          etiqueta="Solución aplicada"
          opcional
          multilinea
          valor={valores.solucion}
          error={errores.solucion}
          deshabilitado={guardando}
          onCambio={(v) => fijar("solucion", v)}
        />
      </View>
      <View {...bloque("estado_final")}>
        <OpcionesEnLinea
          testID="salida-estado"
          refFoco={refFoco("estado_final")}
          etiqueta="Estado final"
          obligatorio
          opciones={ESTADOS_FINALES}
          valor={valores.estado_final}
          error={errores.estado_final}
          deshabilitado={guardando}
          onCambio={(v) => fijar("estado_final", v)}
        />
      </View>
      {FINALES_SIN_VUELTA.includes(valores.estado_final) ? (
        <Alerta tipo="aviso" texto={TEXTO_SIN_VUELTA} testID="salida-sin-vuelta" />
      ) : null}
      <Boton
        testID="guardar-salida"
        titulo={guardando ? "Guardando…" : "Registrar salida"}
        icono="check"
        cargando={guardando}
        onPress={guardar}
      />
      <Boton testID="cancelar-salida" titulo="Cancelar" variante="secundario" deshabilitado={guardando} onPress={cerrar} />
    </Ventana>
  );
}

// --- Adjuntar (CA-17) ---------------------------------------------------------------

const CAMPOS_ADJUNTO = { tipo: "Tipo de documento", archivo: "Archivo", descripcion: "Descripción" };

/**
 * «Adjuntar»: el tipo (foto, informe técnico, factura…), el archivo (foto,
 * imagen o documento, validado como el servidor) y una descripción opcional.
 * Envía multipart a `POST adjuntos/` con el activo y el mantenimiento. Lo
 * elegido y no enviado se borra de la caché al cerrar (LOPDP).
 */
export function FormularioAdjuntar({ mantenimiento, onCerrar, onGuardado }) {
  const [tipo, setTipo] = useState("foto");
  const [descripcion, setDescripcion] = useState("");
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const porEnviar = useArchivoPorEnviar();
  const montado = useMontado();
  const candado = useCandado();
  const reenvio = useReenvioConfirmado();
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const conCambios = Boolean(porEnviar.archivo) || Boolean(descripcion.trim()) || tipo !== "foto";

  async function cerrar() {
    if (guardando) return;
    if (conCambios && !(await confirmarDescarte())) return;
    onCerrar();
  }

  function mostrarErrores(campos, texto) {
    setErrores(campos);
    setError({ texto, clave: Date.now() });
    irA(Object.keys(CAMPOS_ADJUNTO).find((c) => campos[c]));
  }

  async function elegir(como) {
    const listo = await porEnviar.elegir(como);
    if (listo && montado.current && errores.archivo) setErrores((e) => ({ ...e, archivo: undefined }));
  }

  async function guardar() {
    if (!candado.tomar()) return;
    if (!porEnviar.archivo) {
      candado.soltar();
      mostrarErrores({ archivo: "Tome una foto o elija un archivo." }, textoRevise({ archivo: true }, CAMPOS_ADJUNTO));
      return;
    }
    if (!(await reenvio.confirmar())) {
      candado.soltar();
      return;
    }
    if (!montado.current) return;
    setErrores({});
    setError(null);
    setGuardando(true);
    try {
      const adjunto = await adjuntosService.subir({
        activo: mantenimiento.activo,
        mantenimiento: mantenimiento.id,
        tipo,
        descripcion: descripcion.trim(),
        archivo: porEnviar.archivo,
      });
      if (!montado.current) return;
      reenvio.limpiar();
      porEnviar.soltar();
      onGuardado(adjunto, `Archivo adjuntado: ${adjunto?.nombre_original || "listo"}.`);
    } catch (e) {
      if (!montado.current) return;
      const fallo = errorDeGuardado(e, "No se pudo adjuntar el archivo.", CAMPOS_ADJUNTO);
      reenvio.marcar(fallo);
      mostrarErrores(fallo.campos, fallo.texto);
    } finally {
      candado.soltar();
      if (montado.current) setGuardando(false);
    }
  }

  const archivo = porEnviar.archivo;
  return (
    <Ventana
      titulo="Adjuntar"
      subtitulo={subtituloDe(mantenimiento)}
      onCerrar={cerrar}
      ocupada={guardando}
      refDesplazable={desplazable}
      testID="ventana-adjuntar"
    >
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="adjuntar-error" /> : null}
      <Text style={estilos.leyenda}>Los campos con * son obligatorios.</Text>
      <View {...bloque("tipo")}>
        <SelectorDeLista
          testID="adjunto-tipo"
          refFoco={refFoco("tipo")}
          etiqueta="Tipo de documento"
          obligatorio
          opciones={TIPOS_DE_ADJUNTO}
          valor={tipo}
          error={errores.tipo}
          deshabilitado={guardando}
          onCambio={(v) => {
            setTipo(String(v));
            if (errores.tipo) setErrores((e) => ({ ...e, tipo: undefined }));
          }}
        />
      </View>
      <View {...bloque("archivo")} style={estilos.campo}>
        <View
          ref={refFoco("archivo")}
          accessible
          accessibilityLabel={["Archivo (obligatorio)", TEXTO_AYUDA_ARCHIVO, errores.archivo ? `Error: ${errores.archivo}` : null]
            .filter(Boolean)
            .join(". ")}
        >
          <Text style={estilos.etiqueta}>
            Archivo <Text style={estilos.obligatorio}>*</Text>
          </Text>
          <Text style={estilos.tenue}>{TEXTO_AYUDA_ARCHIVO}</Text>
        </View>
        {archivo ? (
          <View style={estilos.elegido} testID="adjunto-elegido">
            <Icono
              nombre={archivo.type?.startsWith("image/") ? "file-image-outline" : "file-document-outline"}
              size={20}
              color={colores.primario}
            />
            <Text style={estilos.elegidoTexto}>{`${archivo.name}${archivo.size ? ` · ${tamanoLegible(archivo.size)}` : ""}`}</Text>
            <BotonIcono
              testID="adjunto-quitar"
              icono="close"
              color={colores.tinta}
              etiqueta={`Quitar el archivo ${archivo.name}`}
              deshabilitado={guardando}
              onPress={porEnviar.quitar}
            />
          </View>
        ) : null}
        <ErrorDeCampo error={errores.archivo} />
        {porEnviar.error ? (
          <Alerta tipo="aviso" texto={porEnviar.error.texto} clave={porEnviar.error.clave} testID="adjunto-no-vale" />
        ) : null}
        <Boton
          testID="adjunto-camara"
          // Siempre «Tomar foto»: con un archivo o una imagen de la galería
          // elegidos, «Tomar otra foto» no era cierto (16/11/2026).
          titulo="Tomar foto"
          icono="camera-outline"
          variante="secundario"
          deshabilitado={guardando}
          onPress={() => elegir(tomarFotoDelEquipo)}
        />
        <Boton
          testID="adjunto-galeria"
          titulo="Elegir imagen"
          icono="image-outline"
          variante="secundario"
          deshabilitado={guardando}
          onPress={() => elegir(elegirImagenDelEquipo)}
        />
        <Boton
          testID="adjunto-archivo"
          titulo="Elegir archivo"
          icono="file-document-outline"
          variante="secundario"
          deshabilitado={guardando}
          onPress={() => elegir(elegirArchivoDelEquipo)}
        />
      </View>
      <View {...bloque("descripcion")}>
        <CampoTexto
          testID="adjunto-descripcion"
          refFoco={refFoco("descripcion")}
          etiqueta="Descripción"
          opcional
          maximo={LARGO_DESCRIPCION_ADJUNTO}
          valor={descripcion}
          error={errores.descripcion}
          deshabilitado={guardando}
          onCambio={(v) => {
            setDescripcion(v);
            if (errores.descripcion) setErrores((e) => ({ ...e, descripcion: undefined }));
          }}
        />
      </View>
      <Boton
        testID="guardar-adjunto"
        titulo={guardando ? "Subiendo…" : "Adjuntar"}
        icono="paperclip"
        cargando={guardando}
        onPress={guardar}
      />
      <Boton testID="cancelar-adjunto" titulo="Cancelar" variante="secundario" deshabilitado={guardando} onPress={cerrar} />
    </Ventana>
  );
}

const estilos = crearEstilos({
  campo: { gap: 8 },
  leyenda: { fontSize: 14, color: colores.tintaSuave },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  obligatorio: { color: colores.malTexto },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  elegido: {
    minHeight: AREA_TACTIL,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colores.bordeControl,
    backgroundColor: colores.superficie,
  },
  elegidoTexto: { flex: 1, fontSize: 15, color: colores.tinta },
});
