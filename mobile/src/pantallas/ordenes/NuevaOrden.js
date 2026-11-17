import { useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";

import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { ordenesService } from "../../api/servicios";
import { dejarResultado } from "../../activos/avisoPendiente";
import { hoyIso } from "../../activos/mantenimientos";
import { Alerta, Boton, Cargando, ErrorConReintento } from "../../componentes/comunes";
import { OpcionesEnLinea, SelectorDeLista } from "../../componentes/Selectores";
import { SelectorFecha } from "../../componentes/SelectorFecha";
import { useAlturaCabecera } from "../../navegador/alturaCabecera";
import {
  cuerpoDeNuevaOrden,
  erroresDelAlta,
  hayCambiosEnLaOrden,
  LARGO_TITULO,
  puedeCrearOrdenes,
  TEXTO_SIN_PERMISO_CREAR,
  validarNuevaOrden,
  valoresDeNuevaOrden,
} from "../../ordenes/formato";
import { opcionesDe, opcionesDeSedes, useCatalogosDeOrdenes } from "../../ordenes/useCatalogos";
import { useSesion } from "../../sesion/SesionContext";
import { useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { CampoTexto } from "../permisos/piezas";
import { useSalirConCambios } from "../activos/formularios";
import { useEnvioDeOrden } from "./AccionesDeLaOrden";
import { BuscadorDeResponsable } from "./BuscadorDeResponsable";
import { rutaDeLaOrden } from "./piezas";
import { VentanaRegistrarProveedor } from "./RegistrarProveedor";

/** Los campos en el orden de la pantalla, con su nombre para «Revise…». El
 * error del técnico va en «Quién la realiza» (`erroresDelAlta`). */
const CAMPOS = {
  sede: "Sede",
  categoria: "Categoría",
  prioridad: "Prioridad",
  titulo: "Qué hay que hacer",
  descripcion: "Descripción",
  telefono_contacto: "Teléfono de quien reporta",
  responsable: "Quién la realiza",
  tecnico: "Quién la realiza",
  proveedor: "Proveedor",
  fecha_programada: "Fecha programada",
};

/**
 * «Nueva orden» (US-025, CA-14 a CA-16; el `OrdenForm.jsx` de la web):
 * dónde, qué, qué tan urgente, a quién llamar y, como en la web desde la
 * US-006, quién la realiza y para cuándo. La orden nace programada con ese
 * compromiso.
 *
 * «Quién la realiza» es un proveedor o una persona con cuenta. Al elegir una
 * persona se propone el proveedor de su última orden con proveedor (solo una
 * aproximación): se ve en «Proveedor», justo debajo, y se puede quitar o
 * cambiar. Si el proveedor no existe, «Registrar proveedor nuevo» lo da de
 * alta y lo deja elegido.
 *
 * `POST ordenes/` y, al crearla, se reemplaza por su ficha, que anuncia el
 * número. Un doble toque hace una sola petición; los errores 400 van junto a
 * su campo; salir con cambios pregunta.
 */
export function NuevaOrden() {
  const estilos = useEstilos(fabricaDeEstilos);
  const router = useRouter();
  const alturaCabecera = useAlturaCabecera();
  const { usuario } = useSesion();
  const permisos = usuario?.permissions ?? [];
  const puedeCrear = puedeCrearOrdenes(permisos);
  const catalogos = useCatalogosDeOrdenes(puedeCrear);
  const [hoy] = useState(() => hoyIso());
  const [iniciales] = useState(() => valoresDeNuevaOrden());
  const [valores, setValores] = useState(iniciales);
  // `{tipo: "persona" | "proveedor", id, nombre, proveedor}` o null.
  const [responsable, setResponsable] = useState(null);
  // La última persona elegida: sigue mientras se cambia quién la realiza y
  // se olvida al elegir un proveedor como responsable.
  const [persona, setPersona] = useState(null);
  // El proveedor con el que la persona realiza la orden (o ninguno).
  const [proveedorDePersona, setProveedorDePersona] = useState(null);
  const [textoResponsable, setTextoResponsable] = useState("");
  const [textoProveedor, setTextoProveedor] = useState("");
  // `{destino: "responsable" | "proveedor", nombre}` con la ventana abierta.
  const [registro, setRegistro] = useState(null);
  // Un cambio que no se pidió en ese campo (el proveedor reemplazado al
  // elegir otra persona: `aviso`) o el proveedor recién registrado y elegido
  // (`bien`): se dice a la vista y se anuncia (UX H-02).
  const [aviso, setAviso] = useState(null);
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const { errores, error, guardando, enviar, quitarError } = useEnvioDeOrden(CAMPOS, irA);
  const tocado = hayCambiosEnLaOrden(iniciales, valores, responsable) || Boolean(textoResponsable.trim());
  const { salir } = useSalirConCambios(tocado && !guardando, { ocupado: guardando });
  const conProveedor = Boolean(persona);
  const personaElegida = responsable?.tipo === "persona";
  // QA-TECH: el mismo objeto mientras no cambie (el buscador depende de él).
  const proveedorElegido = useMemo(
    () => (proveedorDePersona ? { tipo: "proveedor", id: proveedorDePersona.id, nombre: proveedorDePersona.nombre, proveedor: null } : null),
    [proveedorDePersona],
  );

  const fijarTextoResponsable = useCallback((t) => setTextoResponsable(t), []);
  const fijarTextoProveedor = useCallback((t) => setTextoProveedor(t), []);

  function fijar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    quitarError(campo);
  }

  function elegirResponsable(elegido) {
    setResponsable(elegido);
    if (!elegido) return; // Se está cambiando: nada más cambia.
    quitarError("responsable", "tecnico", "proveedor");
    setAviso(null);
    if (elegido.tipo === "proveedor") {
      setPersona(null);
      setProveedorDePersona(null);
      return;
    }
    const sugerido = elegido.proveedor;
    // La misma persona otra vez: se respeta lo que ya se eligió.
    if (persona?.id === elegido.id) {
      setPersona(elegido);
      return;
    }
    if (persona && proveedorDePersona && proveedorDePersona.id !== sugerido?.id) {
      setAviso({
        tipo: "aviso",
        texto: sugerido
          ? `El proveedor cambió de ${proveedorDePersona.nombre} a ${sugerido.nombre}, el último de ${elegido.nombre}.`
          : `Se quitó el proveedor ${proveedorDePersona.nombre}: ${elegido.nombre} no tiene proveedor anterior.`,
        clave: Date.now(),
      });
    }
    setPersona(elegido);
    setProveedorDePersona(sugerido ?? null);
  }

  function elegirProveedorDePersona(elegido) {
    setProveedorDePersona(elegido ? { id: elegido.id, nombre: elegido.nombre } : null);
    setAviso(null);
    if (elegido) quitarError("proveedor");
  }

  function proveedorRegistrado(proveedor) {
    const destino = registro?.destino;
    setRegistro(null);
    if (destino === "proveedor" && persona) {
      elegirProveedorDePersona(proveedor);
      setAviso({
        tipo: "bien",
        texto: `Proveedor ${proveedor.nombre} registrado y elegido como proveedor de ${persona.nombre}.`,
        clave: Date.now(),
      });
      return;
    }
    elegirResponsable({ tipo: "proveedor", id: proveedor.id, nombre: proveedor.nombre, proveedor: null });
    setAviso({ tipo: "bien", texto: `Proveedor ${proveedor.nombre} registrado y elegido.`, clave: Date.now() });
  }

  function guardar() {
    enviar({
      validar: () =>
        validarNuevaOrden({
          valores,
          responsable,
          conProveedor,
          proveedorDePersona,
          textoResponsable,
          textoProveedor,
          hoy: hoyIso(),
        }),
      pedir: () => ordenesService.crear(cuerpoDeNuevaOrden(valores, responsable, proveedorDePersona)),
      porDefecto: "No se pudo registrar la orden.",
      traducir: (campos) => erroresDelAlta(campos, conProveedor),
      alGuardar: (creada) => {
        dejarResultado(`orden-${creada.id}`, { texto: `Orden ${creada.numero} registrada.` });
        salir(() => router.replace(rutaDeLaOrden(creada)));
      },
    });
  }

  if (!puedeCrear) {
    return (
      <View style={estilos.centro}>
        <Alerta tipo="info" texto={TEXTO_SIN_PERMISO_CREAR} testID="sin-permiso-crear" />
      </View>
    );
  }
  if (catalogos.estado === "cargando") return <Cargando texto="Cargando las sedes y las categorías…" />;
  if (catalogos.estado === "error") {
    return (
      <View style={estilos.centro}>
        <ErrorConReintento texto={catalogos.error} onReintentar={catalogos.recargar} />
      </View>
    );
  }

  const propuesto = personaElegida && persona?.proveedor && proveedorDePersona?.id === persona.proveedor.id;
  let ayudaProveedor = "Se conserva mientras cambia «Quién la realiza».";
  if (propuesto) {
    ayudaProveedor = `Propuesto: ${persona.proveedor.nombre} (último proveedor de ${persona.nombre}). Quítelo o cámbielo si esta vez no aplica.`;
  } else if (personaElegida) {
    ayudaProveedor = `Si ${persona.nombre} la realiza por cuenta de un proveedor, elíjalo; si no, déjelo vacío.`;
  }

  return (
    <KeyboardAvoidingView
      style={estilos.pantalla}
      behavior="padding"
      enabled={Platform.OS === "android"}
      keyboardVerticalOffset={alturaCabecera}
    >
      <ScrollView
        ref={desplazable}
        testID="nueva-orden-formulario"
        style={estilos.pantalla}
        contentContainerStyle={estilos.contenido}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        automaticallyAdjustKeyboardInsets
      >
        {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="nueva-orden-error" /> : null}
        <Text style={estilos.explicacion}>
          Reporte lo que hay que reparar o mantener en una sede, quién lo realiza y para cuándo. La orden queda programada con esa fecha.
        </Text>
        <Text style={estilos.leyenda}>Los campos con * son obligatorios.</Text>

        <Text style={estilos.subtitulo} accessibilityRole="header">
          Qué y dónde
        </Text>
        <View {...bloque("sede")}>
          <SelectorDeLista
            testID="orden-sede"
            refFoco={refFoco("sede")}
            etiqueta="Sede"
            obligatorio
            buscable
            vacio="Elija la sede"
            opciones={opcionesDeSedes(catalogos.datos?.sedes)}
            valor={valores.sede}
            error={errores.sede}
            deshabilitado={guardando}
            onCambio={(v) => fijar("sede", String(v ?? ""))}
          />
        </View>
        <View {...bloque("categoria")}>
          <SelectorDeLista
            testID="orden-categoria"
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
            testID="orden-prioridad"
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
        <View {...bloque("titulo")}>
          <CampoTexto
            testID="orden-titulo"
            refFoco={refFoco("titulo")}
            etiqueta="Qué hay que hacer"
            obligatorio
            maximo={LARGO_TITULO}
            placeholder="Sin luz en el área de cajas"
            valor={valores.titulo}
            error={errores.titulo}
            deshabilitado={guardando}
            onCambio={(v) => fijar("titulo", v)}
          />
        </View>
        <View {...bloque("descripcion")}>
          <CampoTexto
            testID="orden-descripcion"
            refFoco={refFoco("descripcion")}
            etiqueta="Descripción"
            opcional
            multilinea
            placeholder="Desde cuándo pasa, dónde exactamente y qué se ha intentado."
            valor={valores.descripcion}
            error={errores.descripcion}
            deshabilitado={guardando}
            onCambio={(v) => fijar("descripcion", v)}
          />
        </View>
        <View {...bloque("telefono_contacto")}>
          <CampoTexto
            testID="orden-telefono"
            refFoco={refFoco("telefono_contacto")}
            etiqueta="Teléfono de quien reporta"
            opcional
            teclado="phone-pad"
            maximo={20}
            placeholder="099 000 0000"
            ayuda="De 7 a 15 dígitos. Para que el técnico coordine la visita; se muestra enmascarado a quien no lo necesita completo."
            valor={valores.telefono_contacto}
            error={errores.telefono_contacto}
            deshabilitado={guardando}
            onCambio={(v) => fijar("telefono_contacto", v)}
          />
        </View>

        <Text style={estilos.subtitulo} accessibilityRole="header">
          Quién y para cuándo
        </Text>
        <View {...bloque("responsable")}>
          <BuscadorDeResponsable
            testID="orden-responsable"
            refFoco={refFoco("responsable")}
            etiqueta="Quién la realiza"
            obligatorio
            ayuda="Un proveedor o una persona con cuenta que atiende órdenes."
            placeholder="Nombre del proveedor o de la persona"
            elegido={responsable}
            onElegir={elegirResponsable}
            onTexto={fijarTextoResponsable}
            onRegistrar={(nombre) => setRegistro({ destino: "responsable", nombre })}
            textoVacio={(termino) =>
              termino
                ? `Ningún proveedor ni persona coincide con «${termino}». Puede registrar un proveedor nuevo.`
                : "Todavía no hay proveedores ni personas que atiendan órdenes. Puede registrar un proveedor nuevo."
            }
            error={errores.responsable}
            deshabilitado={guardando}
          />
        </View>
        {conProveedor ? (
          <View {...bloque("proveedor")} style={estilos.proveedorDePersona}>
            <BuscadorDeResponsable
              testID="orden-proveedor"
              refFoco={refFoco("proveedor")}
              etiqueta="Proveedor"
              opcional
              soloProveedores
              ayuda={ayudaProveedor}
              placeholder="Sin proveedor: lo realiza por su cuenta"
              etiquetaQuitar="Quitar el proveedor"
              elegido={proveedorElegido}
              onElegir={elegirProveedorDePersona}
              onTexto={fijarTextoProveedor}
              onRegistrar={(nombre) => setRegistro({ destino: "proveedor", nombre })}
              textoVacio={(termino) =>
                termino
                  ? `Ningún proveedor coincide con «${termino}». Puede registrar un proveedor nuevo.`
                  : "Todavía no hay proveedores. Puede registrar un proveedor nuevo."
              }
              error={errores.proveedor}
              deshabilitado={guardando}
            />
          </View>
        ) : null}
        {aviso ? <Alerta tipo={aviso.tipo} texto={aviso.texto} clave={aviso.clave} testID="aviso-responsable" /> : null}
        {/* UX H-10: «Registrar proveedor nuevo» va al final de los resultados
            de cada buscador; un botón aparte lo repetía. */}
        <View {...bloque("fecha_programada")}>
          <SelectorFecha
            testID="orden-fecha"
            refFoco={refFoco("fecha_programada")}
            etiqueta="Fecha programada"
            obligatorio
            minimo={hoy}
            ayuda="El día en que debe cumplirse: hoy o después."
            valor={valores.fecha_programada}
            error={errores.fecha_programada}
            deshabilitado={guardando}
            onCambio={(v) => fijar("fecha_programada", v)}
          />
        </View>

        <Boton
          testID="guardar-orden"
          titulo={guardando ? "Registrando…" : "Registrar orden"}
          icono="check"
          cargando={guardando}
          onPress={guardar}
        />
      </ScrollView>
      {registro ? (
        <VentanaRegistrarProveedor
          destino={
            registro.destino === "proveedor" && persona
              ? `Quedará como proveedor de ${persona.nombre} en esta orden.`
              : "Quedará como quien realiza la orden."
          }
          nombreInicial={registro.nombre}
          onCerrar={() => setRegistro(null)}
          onRegistrado={proveedorRegistrado}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
  pantalla: { flex: 1, backgroundColor: colores.fondo },
  contenido: { padding: 16, gap: 16, paddingBottom: 40 },
  centro: { padding: 16 },
  explicacion: { fontSize: 15, color: colores.tinta },
  leyenda: { fontSize: 14, color: colores.tintaSuave },
  subtitulo: { fontSize: 17, fontWeight: "700", color: colores.titulo },
  proveedorDePersona: { paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: colores.bordeFuerte },
});
