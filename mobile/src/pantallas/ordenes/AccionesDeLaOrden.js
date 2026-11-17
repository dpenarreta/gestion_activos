import { useEffect, useRef, useState } from "react";
import { Alert, Platform, Text, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { ordenesService } from "../../api/servicios";
import { dinero } from "../../activos/formato";
import { hoyIso } from "../../activos/mantenimientos";
import { Alerta, Boton, Cargando, ErrorConReintento } from "../../componentes/comunes";
import { confirmarDescarte } from "../../componentes/confirmarDescarte";
import { Casilla, OpcionesEnLinea, SelectorDeLista } from "../../componentes/Selectores";
import { SelectorFecha } from "../../componentes/SelectorFecha";
import { Ventana } from "../../componentes/Ventana";
import {
  cuerpoDeAsignacion,
  cuerpoDeCorreccion,
  cuerpoDelCambioDeEstado,
  cuerpoDelCosto,
  decimalDe,
  esDevolucion,
  LARGO_DESCRIPCION_COSTO,
  LARGO_TITULO,
  notaObligatoria,
  OPCIONES_DE_ERROR,
  resultadoDeAsignacion,
  resultadoDelPaso,
  textoDelPaso,
  TEXTO_SIN_CAMBIOS_ASIGNAR,
  TIPOS_DE_COSTO,
  validarAsignacion,
  validarCambioDeEstado,
  validarCorreccion,
  validarCosto,
  valoresDeAsignacion,
  valoresDeCorreccion,
} from "../../ordenes/formato";
import { opcionesDe, opcionesDeNombres, opcionesDeSedes } from "../../ordenes/useCatalogos";
import { useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { CampoTexto } from "../permisos/piezas";
import { errorDeGuardado, textoRevise, useCandado, useReenvioConfirmado } from "../activos/formularios";
import { useMontado } from "../activos/piezas";

/**
 * Lo que se hace desde la ficha de una orden (US-025, CA-10 a CA-13), cada
 * cosa en su ventana, con las reglas de los formularios de Gestión de
 * Activos (US-022 y US-023): candado contra el doble envío (`useCandado`),
 * errores 400 junto a su campo, «puede haberse guardado» sin respuesta clara
 * con confirmación antes de reenviar (`useReenvioConfirmado`) y
 * `confirmarDescarte` al cerrar con cambios.
 *
 * Cada envío devuelve el detalle de la orden: la ficha lo pinta tal cual y
 * anuncia el resultado.
 */

function subtituloDe(orden) {
  return [orden?.numero, orden?.titulo].filter(Boolean).join(" · ");
}

/**
 * El envío de un formulario de órdenes: valida, pide confirmación si el
 * último quedó en duda, envía y reparte los errores entre sus campos y el
 * aviso de arriba. `campos`: `{campo: nombre}` en el orden de la pantalla.
 *
 * `onRechazo(texto)` (QA-FUNC O-1, 17/11/2026): si el servidor rechaza el
 * paso por algo que no es de un campo de la ventana (un 403, un 404, o un
 * 400 en `estado` o sin campo: la orden cambió mientras tanto), la ventana
 * se cierra, la ficha dice el motivo y se vuelve a leer en silencio.
 */
export function useEnvioDeOrden(campos, irA, { onRechazo } = {}) {
  const [errores, setErrores] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const montado = useMontado();
  const candado = useCandado();
  const reenvio = useReenvioConfirmado();

  function mostrar(encontrados, texto) {
    setErrores(encontrados);
    // `deCampos`: el aviso resume errores de campos; se va cuando se corrigen
    // todos (prueba del Tech Lead, 17/11/2026).
    setError({ texto, clave: Date.now(), deCampos: Object.keys(encontrados).some((c) => encontrados[c]) });
    irA(Object.keys(campos).find((c) => encontrados[c]));
  }

  function quitarError(...nombres) {
    setErrores((actuales) => {
      if (!nombres.some((n) => actuales[n])) return actuales;
      const resto = { ...actuales };
      nombres.forEach((n) => delete resto[n]);
      return resto;
    });
  }

  /** `validar()` devuelve `{campo: mensaje}`; `pedir()` hace la petición;
   * `alGuardar(respuesta)`; `traducir(campos)` reparte los del 400. */
  async function enviar({ validar, pedir, porDefecto, alGuardar, traducir }) {
    if (!candado.tomar()) return;
    const encontrados = validar ? validar() : {};
    if (Object.keys(encontrados).length) {
      candado.soltar();
      const texto = encontrados._bloque ?? textoRevise(encontrados, campos);
      const { _bloque, ...deCampo } = encontrados;
      mostrar(deCampo, texto);
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
      const respuesta = await pedir();
      if (!montado.current) return;
      reenvio.limpiar();
      alGuardar(respuesta);
    } catch (e) {
      if (!montado.current) return;
      const fallo = errorDeGuardado(e, porDefecto, campos, OPCIONES_DE_ERROR);
      reenvio.marcar(fallo);
      const status = e?.response?.status;
      const deLaVentana = Object.keys(fallo.campos).some((c) => campos[c]);
      if (onRechazo && !fallo.dudoso && (status === 403 || status === 404 || (status === 400 && !deLaVentana))) {
        onRechazo(fallo.texto);
        return;
      }
      const deCampo = traducir ? traducir(fallo.campos) : fallo.campos;
      // Si los errores cambiaron de campo («proveedor» va a «Quién la
      // realiza»), el «Revise…» de arriba nombra los campos donde quedaron.
      const generico = fallo.texto === textoRevise(fallo.campos, campos);
      mostrar(deCampo, generico ? textoRevise(deCampo, campos) : fallo.texto);
    } finally {
      candado.soltar();
      if (montado.current) setGuardando(false);
    }
  }

  useEffect(() => {
    if (error?.deCampos && !Object.values(errores).some(Boolean)) setError(null);
  }, [error, errores]);

  return { errores, error, guardando, enviar, quitarError };
}

async function cerrarCon(cambios, guardando, onCerrar) {
  if (guardando) return;
  if (cambios && !(await confirmarDescarte())) return;
  onCerrar();
}

// --- Cambiar el estado (CA-10) ------------------------------------------------------


const EXPLICACION_DEL_PASO = {
  programada: "Fije el día en que se hará el trabajo.",
  pausada: "La orden queda en pausa hasta que se reanude.",
  pendiente_aprobacion: "Quien responde por la sede revisa el trabajo y lo acepta o lo devuelve.",
  cerrada: "Acepta el trabajo terminado y cierra la orden. Una orden cerrada no se vuelve a abrir: si el problema vuelve, es una orden nueva.",
};

/**
 * Un paso del recorrido (`POST ordenes/{id}/cambiar-estado/`), con el verbo
 * de la web. «Programar» pide la fecha; «Pausar» y «Devolver a ejecución»
 * exigen el motivo; «Aceptar y cerrar» permite marcar «con observaciones»,
 * que entonces se escriben en la nota.
 */
export function VentanaCambioDeEstado({ orden, destino, onCerrar, onGuardado, onRechazo }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const actual = orden?.estado;
  const [hoy] = useState(() => hoyIso());
  const [nota, setNota] = useState("");
  const [fecha, setFecha] = useState(orden?.fecha_programada ?? "");
  const [conObservaciones, setConObservaciones] = useState(false);
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const verbo = textoDelPaso(destino, actual);
  const devolucion = esDevolucion(destino, actual);
  const obligatoria = notaObligatoria(destino, actual, conObservaciones);
  const cambios = Boolean(nota.trim()) || conObservaciones || fecha !== (orden?.fecha_programada ?? "");

  let etiquetaNota = "Nota";
  if (destino === "cerrada" && conObservaciones) etiquetaNota = "Observaciones";
  else if (destino === "pausada" || devolucion) etiquetaNota = "Motivo";
  // «Revise el campo: …» con la etiqueta que se ve (Nota, Motivo u
  // Observaciones).
  const camposDelPaso = { fecha_programada: "Fecha programada", nota: etiquetaNota };
  const { errores, error, guardando, enviar, quitarError } = useEnvioDeOrden(camposDelPaso, irA, { onRechazo });
  const explicacion = devolucion
    ? "El trabajo vuelve a quien lo ejecuta. Diga qué falta o qué hay que corregir."
    : EXPLICACION_DEL_PASO[destino];

  function guardar() {
    enviar({
      validar: () =>
        validarCambioDeEstado({ destino, actual, nota, fecha, conObservaciones, fechaActual: orden?.fecha_programada ?? "", hoy: hoyIso() }),
      pedir: () => ordenesService.cambiarEstado(orden.id, cuerpoDelCambioDeEstado({ destino, nota, fecha, conObservaciones })),
      porDefecto: "No se pudo cambiar el estado de la orden.",
      alGuardar: (actualizada) => onGuardado(actualizada, resultadoDelPaso(destino, actual, conObservaciones)),
    });
  }

  return (
    <Ventana
      titulo={verbo}
      subtitulo={subtituloDe(orden)}
      onCerrar={() => cerrarCon(cambios, guardando, onCerrar)}
      ocupada={guardando}
      refDesplazable={desplazable}
      testID="ventana-paso"
    >
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="paso-error" /> : null}
      {explicacion ? <Text style={estilos.explicacion}>{explicacion}</Text> : null}
      {destino === "programada" ? (
        <View {...bloque("fecha_programada")}>
          <SelectorFecha
            testID="paso-fecha"
            refFoco={refFoco("fecha_programada")}
            etiqueta="Fecha programada"
            obligatorio
            valor={fecha}
            minimo={hoy}
            ayuda="El día en que debe cumplirse: hoy o después."
            error={errores.fecha_programada}
            deshabilitado={guardando}
            onCambio={(v) => {
              setFecha(v);
              quitarError("fecha_programada");
            }}
          />
        </View>
      ) : null}
      {destino === "cerrada" ? (
        <Casilla
          testID="paso-observaciones"
          etiqueta="Aceptar con observaciones"
          ayuda="La orden se cierra igual y cuenta en «Con observaciones». Las observaciones van en la nota."
          marcada={conObservaciones}
          deshabilitado={guardando}
          onCambio={(v) => {
            setConObservaciones(v);
            if (!v) quitarError("nota");
          }}
        />
      ) : null}
      <View {...bloque("nota")}>
        <CampoTexto
          testID="paso-nota"
          refFoco={refFoco("nota")}
          etiqueta={etiquetaNota}
          obligatorio={obligatoria}
          opcional={!obligatoria}
          multilinea
          maximo={2000}
          ayuda={obligatoria && destino !== "cerrada" ? "Es lo que lee quien tiene que retomar la orden." : undefined}
          valor={nota}
          error={errores.nota}
          deshabilitado={guardando}
          onCambio={(v) => {
            setNota(v);
            quitarError("nota");
          }}
        />
      </View>
      <Boton
        testID="guardar-paso"
        titulo={guardando ? "Guardando…" : verbo}
        icono="check"
        cargando={guardando}
        onPress={guardar}
      />
      <Boton
        testID="cancelar-paso"
        titulo="Cancelar"
        variante="secundario"
        deshabilitado={guardando}
        onPress={() => cerrarCon(cambios, guardando, onCerrar)}
      />
    </Ventana>
  );
}

// --- Asignar o reasignar (CA-11) ----------------------------------------------------

const CAMPOS_ASIGNAR = { tecnico: "Técnico", proveedor: "Proveedor", fecha_programada: "Fecha programada", nota: "Nota" };

/**
 * «Asignar» o «Reasignar» (`POST ordenes/{id}/asignar/`): el técnico, el
 * proveedor o los dos, la fecha y una nota. Con los datos actuales ya
 * puestos, cambiar solo la fecha es reprogramar. Solo se envía lo que cambió.
 *
 * Las personas y los proveedores salen de `GET ordenes/catalogos/`, como en
 * la web (`OrdenDetalle.jsx`): quien asigna es quien coordina, y el
 * catálogo se los da; `ordenes/responsables/` pide `ordenes.crear`, que un
 * coordinador puede no tener. Las listas se filtran escribiendo. `catalogos`
 * lo carga la ficha una sola vez (`useCatalogosDeOrdenes`).
 */
export function VentanaAsignar({ orden, catalogos, onCerrar, onGuardado, onRechazo }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const [hoy] = useState(() => hoyIso());
  const [iniciales] = useState(() => valoresDeAsignacion(orden));
  const [valores, setValores] = useState(iniciales);
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const { errores, error, guardando, enviar, quitarError } = useEnvioDeOrden(CAMPOS_ASIGNAR, irA, { onRechazo });
  const tieneResponsable = Boolean(orden?.tecnico || orden?.proveedor);
  const accion = tieneResponsable ? "Reasignar" : "Asignar";
  const cambios = Object.keys(iniciales).some((c) => String(iniciales[c] ?? "") !== String(valores[c] ?? ""));
  const tecnicos = opcionesDeNombres(catalogos.datos?.tecnicos, orden?.tecnico);
  const proveedores = opcionesDeNombres(catalogos.datos?.proveedores, orden?.proveedor);

  function fijar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    // El error de «técnico o proveedor» lo resuelve cualquiera de los dos.
    quitarError(...(campo === "proveedor" ? ["proveedor", "tecnico"] : [campo]));
  }

  function guardar() {
    let cuerpo = null;
    enviar({
      validar: () => {
        const encontrados = validarAsignacion(iniciales, valores, hoyIso());
        if (Object.keys(encontrados).length) return encontrados;
        cuerpo = cuerpoDeAsignacion(iniciales, valores);
        if (Object.keys(cuerpo).filter((c) => c !== "nota").length === 0) return { _bloque: TEXTO_SIN_CAMBIOS_ASIGNAR };
        return {};
      },
      pedir: () => ordenesService.asignar(orden.id, cuerpo),
      porDefecto: "No se pudo asignar la orden.",
      alGuardar: (actualizada) => onGuardado(actualizada, resultadoDeAsignacion(orden, cuerpo)),
    });
  }

  let contenido;
  if (catalogos.estado === "cargando" || catalogos.estado === "inactivo") {
    contenido = <Cargando texto="Cargando los técnicos y proveedores…" />;
  } else if (catalogos.estado === "error") {
    // QA-FUNC O-4: el motivo real (módulo apagado, sin conexión…), como en
    // «Corregir».
    contenido = <ErrorConReintento texto={catalogos.error} onReintentar={catalogos.recargar} />;
  } else {
    contenido = (
      <>
        <Text style={estilos.explicacion}>Indique el técnico, el proveedor o los dos.</Text>
        <View {...bloque("tecnico")}>
          <SelectorDeLista
            testID="asignar-tecnico"
            refFoco={refFoco("tecnico")}
            etiqueta="Técnico"
            buscable
            conVacio
            vacio={valores.proveedor ? "Ninguno: lo realiza el proveedor" : "Elija quién ejecuta"}
            opciones={tecnicos}
            valor={valores.tecnico}
            ayuda={
              tecnicos.length === 0
                ? "Nadie tiene todavía el permiso «Ejecutar las órdenes asignadas» en esta empresa: asígneselo a un rol en Configuración → Roles."
                : undefined
            }
            error={errores.tecnico}
            deshabilitado={guardando}
            onCambio={(v) => fijar("tecnico", String(v ?? ""))}
          />
        </View>
        <View {...bloque("proveedor")}>
          <SelectorDeLista
            testID="asignar-proveedor"
            refFoco={refFoco("proveedor")}
            etiqueta="Proveedor"
            opcional
            buscable
            conVacio
            vacio="Ninguno: personal interno"
            opciones={proveedores}
            valor={valores.proveedor}
            error={errores.proveedor}
            deshabilitado={guardando}
            onCambio={(v) => fijar("proveedor", String(v ?? ""))}
          />
        </View>
        <View {...bloque("fecha_programada")}>
          <SelectorFecha
            testID="asignar-fecha"
            refFoco={refFoco("fecha_programada")}
            etiqueta="Fecha programada"
            obligatorio={Boolean(iniciales.fecha_programada)}
            valor={valores.fecha_programada}
            minimo={hoy}
            ayuda="El día en que debe cumplirse: hoy o después."
            error={errores.fecha_programada}
            deshabilitado={guardando}
            onCambio={(v) => fijar("fecha_programada", v)}
          />
        </View>
        <View {...bloque("nota")}>
          <CampoTexto
            testID="asignar-nota"
            refFoco={refFoco("nota")}
            etiqueta="Nota"
            opcional
            maximo={2000}
            valor={valores.nota}
            error={errores.nota}
            deshabilitado={guardando}
            onCambio={(v) => fijar("nota", v)}
          />
        </View>
        <Boton
          testID="guardar-asignacion"
          titulo={guardando ? (tieneResponsable ? "Reasignando…" : "Asignando…") : accion}
          icono="account-switch-outline"
          cargando={guardando}
          onPress={guardar}
        />
      </>
    );
  }

  return (
    <Ventana
      titulo={accion}
      subtitulo={subtituloDe(orden)}
      onCerrar={() => cerrarCon(cambios, guardando, onCerrar)}
      ocupada={guardando}
      refDesplazable={desplazable}
      testID="ventana-asignar"
    >
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="asignar-error" /> : null}
      {contenido}
      <Boton
        testID="cancelar-asignacion"
        titulo="Cancelar"
        variante="secundario"
        deshabilitado={guardando}
        onPress={() => cerrarCon(cambios, guardando, onCerrar)}
      />
    </Ventana>
  );
}

// --- Materiales y mano de obra (CA-12) ----------------------------------------------

/**
 * «Agregar material» (`POST ordenes/{id}/materiales/`: descripción,
 * cantidad y costo unitario) o «Agregar mano de obra» (`mano-de-obra/`:
 * descripción, horas y costo por hora). Los números aceptan coma o punto
 * decimal; se envían con punto.
 */
export function VentanaCosto({ orden, tipo, onCerrar, onGuardado, onRechazo }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const config = TIPOS_DE_COSTO[tipo];
  const campos = Object.fromEntries(config.campos.map((c) => [c.clave, c.nombre]));
  const [valores, setValores] = useState(() => Object.fromEntries(config.campos.map((c) => [c.clave, ""])));
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const { errores, error, guardando, enviar, quitarError } = useEnvioDeOrden(campos, irA, { onRechazo });
  const cambios = Object.values(valores).some((v) => String(v).trim());
  const [, campoA, campoB] = config.campos;
  const a = decimalDe(valores[campoA.clave]);
  const b = decimalDe(valores[campoB.clave]);
  const subtotal = a !== null && b !== null ? Number(a) * Number(b) : null;
  const textoSubtotal = subtotal === null ? null : `Subtotal: ${dinero(subtotal)} (sin IVA)`;

  // UX H-12: en iOS `accessibilityLiveRegion` no existe; el subtotal se
  // anuncia cuando se deja de escribir.
  useEffect(() => {
    if (Platform.OS !== "ios" || !textoSubtotal) return undefined;
    const pausa = setTimeout(() => anunciar(textoSubtotal), 900);
    return () => clearTimeout(pausa);
  }, [textoSubtotal]);

  function guardar() {
    enviar({
      validar: () => validarCosto(tipo, valores),
      pedir: () =>
        tipo === "materiales"
          ? ordenesService.agregarMaterial(orden.id, cuerpoDelCosto(tipo, valores))
          : ordenesService.agregarManoDeObra(orden.id, cuerpoDelCosto(tipo, valores)),
      porDefecto: "No se pudo registrar el costo.",
      alGuardar: (actualizada) => onGuardado(actualizada, config.resultado),
    });
  }

  return (
    <Ventana
      titulo={config.titulo}
      subtitulo={subtituloDe(orden)}
      onCerrar={() => cerrarCon(cambios, guardando, onCerrar)}
      ocupada={guardando}
      refDesplazable={desplazable}
      testID="ventana-costo"
    >
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="costo-error" /> : null}
      <Text style={estilos.explicacion}>Los campos con * son obligatorios. Los montos, en dólares, con coma o punto decimal.</Text>
      {config.campos.map((c) => (
        <View key={c.clave} {...bloque(c.clave)}>
          <CampoTexto
            testID={`costo-${c.clave}`}
            refFoco={refFoco(c.clave)}
            etiqueta={c.nombre}
            obligatorio
            maximo={c.clave === "descripcion" ? LARGO_DESCRIPCION_COSTO : 14}
            teclado={c.clave === "descripcion" ? undefined : "decimal-pad"}
            placeholder={c.ejemplo ? `Por ejemplo ${c.ejemplo}` : undefined}
            valor={valores[c.clave]}
            error={errores[c.clave]}
            deshabilitado={guardando}
            onCambio={(v) => {
              setValores((x) => ({ ...x, [c.clave]: v }));
              quitarError(c.clave);
            }}
          />
        </View>
      ))}
      {textoSubtotal ? (
        <Text style={estilos.subtotal} accessibilityLiveRegion="polite" testID="costo-subtotal">
          {textoSubtotal}
        </Text>
      ) : null}
      <Boton
        testID="guardar-costo"
        titulo={guardando ? "Guardando…" : "Agregar"}
        icono="plus"
        cargando={guardando}
        onPress={guardar}
      />
      <Boton
        testID="cancelar-costo"
        titulo="Cancelar"
        variante="secundario"
        deshabilitado={guardando}
        onPress={() => cerrarCon(cambios, guardando, onCerrar)}
      />
    </Ventana>
  );
}

export const TITULO_QUITAR_COSTO = "¿Quitar esta fila?";

/** Quitar un material o unas horas pide confirmación (CA-12). */
export function confirmarQuitarCosto(fila) {
  return new Promise((resolver) => {
    Alert.alert(
      TITULO_QUITAR_COSTO,
      `«${fila?.descripcion ?? ""}» deja de contar en los costos de la orden. Queda dicho en su historial.`,
      [
        { text: "No, conservarla", style: "cancel", onPress: () => resolver(false) },
        { text: "Quitar", style: "destructive", onPress: () => resolver(true) },
      ],
      { cancelable: true, onDismiss: () => resolver(false) },
    );
  });
}

// --- Corregir (CA-13) ---------------------------------------------------------------

const CAMPOS_CORREGIR = {
  titulo: "Qué hay que hacer",
  sede: "Sede",
  categoria: "Categoría",
  prioridad: "Prioridad",
  descripcion: "Descripción",
  telefono_contacto: "Teléfono de contacto",
};

/**
 * «Corregir» (`PATCH ordenes/{id}/`): qué hay que hacer, la sede, la
 * categoría, la prioridad, la descripción y, si el servidor lo da completo
 * (`telefono_contacto_editable`), el teléfono. Solo se envía lo que cambió.
 * El responsable no se corrige aquí: se reasigna. `catalogos` lo carga la
 * ficha una sola vez.
 */
export function VentanaCorregir({ orden, catalogos, onCerrar, onGuardado, onRechazo }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const [iniciales] = useState(() => valoresDeCorreccion(orden));
  const [valores, setValores] = useState(iniciales);
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const { errores, error, guardando, enviar, quitarError } = useEnvioDeOrden(CAMPOS_CORREGIR, irA, { onRechazo });
  const cambios = Object.keys(iniciales).some((c) => String(iniciales[c] ?? "") !== String(valores[c] ?? ""));
  const sedes = opcionesDeSedes(catalogos.datos?.sedes);
  // Una sede que se cerró sigue a la vista mientras no se cambie.
  if (orden?.sede?.id && !sedes.some((s) => s.valor === String(orden.sede.id))) {
    sedes.unshift({ valor: String(orden.sede.id), texto: orden.sede.nombre });
  }

  function fijar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    quitarError(campo);
  }

  function guardar() {
    let cuerpo = null;
    enviar({
      validar: () => {
        const encontrados = validarCorreccion(valores);
        if (Object.keys(encontrados).length) return encontrados;
        cuerpo = cuerpoDeCorreccion(iniciales, valores);
        if (Object.keys(cuerpo).length === 0) return { _bloque: "No cambió nada: corrija algún dato o cierre la ventana." };
        return {};
      },
      pedir: () => ordenesService.corregir(orden.id, cuerpo),
      porDefecto: "No se pudieron corregir los datos.",
      alGuardar: (actualizada) => onGuardado(actualizada, "Datos corregidos."),
    });
  }

  let contenido;
  if (catalogos.estado === "cargando" || catalogos.estado === "inactivo") {
    contenido = <Cargando texto="Cargando las sedes y las categorías…" />;
  } else if (catalogos.estado === "error") {
    contenido = <ErrorConReintento texto={catalogos.error} onReintentar={catalogos.recargar} />;
  } else {
    contenido = (
      <>
        <Text style={estilos.explicacion}>Los campos con * son obligatorios.</Text>
        <View {...bloque("titulo")}>
          <CampoTexto
            testID="corregir-titulo"
            refFoco={refFoco("titulo")}
            etiqueta="Qué hay que hacer"
            obligatorio
            maximo={LARGO_TITULO}
            valor={valores.titulo}
            error={errores.titulo}
            deshabilitado={guardando}
            onCambio={(v) => fijar("titulo", v)}
          />
        </View>
        <View {...bloque("sede")}>
          <SelectorDeLista
            testID="corregir-sede"
            refFoco={refFoco("sede")}
            etiqueta="Sede"
            obligatorio
            buscable
            vacio="Elija la sede"
            opciones={sedes}
            valor={valores.sede}
            error={errores.sede}
            deshabilitado={guardando}
            onCambio={(v) => fijar("sede", String(v ?? ""))}
          />
        </View>
        <View {...bloque("categoria")}>
          <SelectorDeLista
            testID="corregir-categoria"
            refFoco={refFoco("categoria")}
            etiqueta="Categoría"
            obligatorio
            vacio="Elija la categoría"
            opciones={opcionesDe(catalogos.datos?.categorias)}
            valor={valores.categoria}
            error={errores.categoria}
            deshabilitado={guardando}
            onCambio={(v) => fijar("categoria", v)}
          />
        </View>
        <View {...bloque("prioridad")}>
          <OpcionesEnLinea
            testID="corregir-prioridad"
            refFoco={refFoco("prioridad")}
            etiqueta="Prioridad"
            obligatorio
            opciones={opcionesDe(catalogos.datos?.prioridades)}
            valor={valores.prioridad}
            error={errores.prioridad}
            deshabilitado={guardando}
            onCambio={(v) => fijar("prioridad", v)}
          />
        </View>
        <View {...bloque("descripcion")}>
          <CampoTexto
            testID="corregir-descripcion"
            refFoco={refFoco("descripcion")}
            etiqueta="Descripción"
            opcional
            multilinea
            valor={valores.descripcion}
            error={errores.descripcion}
            deshabilitado={guardando}
            onCambio={(v) => fijar("descripcion", v)}
          />
        </View>
        {"telefono_contacto" in valores ? (
          <View {...bloque("telefono_contacto")}>
            <CampoTexto
              testID="corregir-telefono"
              refFoco={refFoco("telefono_contacto")}
              etiqueta="Teléfono de contacto"
              opcional
              teclado="phone-pad"
              maximo={20}
              ayuda="De 7 a 15 dígitos."
              valor={valores.telefono_contacto}
              error={errores.telefono_contacto}
              deshabilitado={guardando}
              onCambio={(v) => fijar("telefono_contacto", v)}
            />
          </View>
        ) : null}
        <Boton
          testID="guardar-correccion"
          titulo={guardando ? "Guardando…" : "Guardar"}
          icono="check"
          cargando={guardando}
          onPress={guardar}
        />
      </>
    );
  }

  return (
    <Ventana
      titulo="Corregir los datos"
      subtitulo={subtituloDe(orden)}
      onCerrar={() => cerrarCon(cambios, guardando, onCerrar)}
      ocupada={guardando}
      refDesplazable={desplazable}
      testID="ventana-corregir"
    >
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="corregir-error" /> : null}
      {contenido}
      <Boton
        testID="cancelar-correccion"
        titulo="Cancelar"
        variante="secundario"
        deshabilitado={guardando}
        onPress={() => cerrarCon(cambios, guardando, onCerrar)}
      />
    </Ventana>
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
  explicacion: { fontSize: 15, color: colores.tintaSuave },
  subtotal: { fontSize: 16, fontWeight: "700", color: colores.titulo },
});
