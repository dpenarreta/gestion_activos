import { useRef, useState } from "react";
import { Text, View } from "react-native";

import { useIrAlBloque } from "../../accesibilidad/irAlBloque";
import { ordenesService } from "../../api/servicios";
import { Alerta, Boton } from "../../componentes/comunes";
import { confirmarDescarte } from "../../componentes/confirmarDescarte";
import { ErrorDeCampo } from "../../componentes/Selectores";
import { Ventana } from "../../componentes/Ventana";
import { cuerpoDelProveedor, erroresDelProveedor, validarProveedor, valoresDeProveedor } from "../../ordenes/formato";
import { useEstilos } from "../../tema/apariencia";
import { crearEstilos } from "../../tema/tipografia";
import { CampoTexto } from "../permisos/piezas";
import { useEnvioDeOrden } from "./AccionesDeLaOrden";

const CAMPOS_PROVEEDOR = {
  nombre: "Nombre o razón social",
  medio: "Contacto",
  telefono: "Teléfono",
  correo: "Correo",
  contacto: "Persona de contacto",
  identificacion: "Cédula o RUC",
};

/**
 * «Registrar proveedor nuevo» sin salir de la orden (US-025, CA-15; el
 * `RegistrarProveedorDialog.jsx` de la web): nombre o razón social y una
 * forma de contactarlo (teléfono o correo, al menos uno), más la persona de
 * contacto y la cédula o el RUC, opcionales. `POST ordenes/proveedores/`
 * devuelve `{id, nombre}` y el proveedor queda elegido en el formulario.
 *
 * `destino` dice dónde quedará al guardarlo; `nombreInicial`, lo que se
 * escribió en el buscador.
 */
export function VentanaRegistrarProveedor({ destino, nombreInicial = "", onCerrar, onRegistrado }) {
  const estilos = useEstilos(fabricaDeEstilos);
  const [iniciales] = useState(() => valoresDeProveedor(nombreInicial));
  const [valores, setValores] = useState(iniciales);
  const desplazable = useRef(null);
  const { bloque, refFoco, irA } = useIrAlBloque(desplazable);
  const { errores, error, guardando, enviar, quitarError } = useEnvioDeOrden(CAMPOS_PROVEEDOR, irA);
  const cambios = Object.keys(iniciales).some((c) => iniciales[c] !== valores[c]);

  function fijar(campo, valor) {
    setValores((v) => ({ ...v, [campo]: valor }));
    // Escribir teléfono o correo resuelve el error del grupo.
    quitarError(...(campo === "telefono" || campo === "correo" ? [campo, "medio"] : [campo]));
  }

  async function cerrar() {
    if (guardando) return;
    if (cambios && !(await confirmarDescarte())) return;
    onCerrar();
  }

  function guardar() {
    enviar({
      validar: () => validarProveedor(valores),
      pedir: () => ordenesService.registrarProveedor(cuerpoDelProveedor(valores)),
      porDefecto: "No se pudo registrar el proveedor.",
      alGuardar: (proveedor) => onRegistrado(proveedor),
      traducir: (campos) => erroresDelProveedor(campos, valores),
    });
  }

  return (
    <Ventana
      titulo="Registrar proveedor nuevo"
      subtitulo={destino}
      onCerrar={cerrar}
      ocupada={guardando}
      refDesplazable={desplazable}
      testID="ventana-proveedor"
    >
      {error ? <Alerta tipo="mal" texto={error.texto} clave={error.clave} testID="proveedor-error" /> : null}
      <Text style={estilos.leyenda}>Los campos con * son obligatorios.</Text>
      <View {...bloque("nombre")}>
        <CampoTexto
          testID="proveedor-nombre"
          refFoco={refFoco("nombre")}
          etiqueta="Nombre o razón social"
          obligatorio
          maximo={150}
          valor={valores.nombre}
          error={errores.nombre}
          deshabilitado={guardando}
          onCambio={(v) => fijar("nombre", v)}
        />
      </View>
      {/* UX H-09: cada bloque es hijo directo del `ScrollView`, para que
          `useIrAlBloque` mida bien su posición y lleve la vista al error. */}
      <View {...bloque("medio")} style={estilos.grupo}>
        <Text
          ref={refFoco("medio")}
          style={estilos.etiqueta}
          accessible
          accessibilityRole="header"
          accessibilityLabel={`Contacto, al menos uno (obligatorio)${errores.medio ? `. Error: ${errores.medio}` : ""}`}
        >
          Contacto (al menos uno)
          <Text style={estilos.obligatorio}> *</Text>
        </Text>
        <ErrorDeCampo error={errores.medio} />
      </View>
      <View {...bloque("telefono")} style={estilos.deContacto}>
        <CampoTexto
          testID="proveedor-telefono"
          refFoco={refFoco("telefono")}
          etiqueta="Teléfono"
          teclado="phone-pad"
          maximo={30}
          valor={valores.telefono}
          error={errores.telefono}
          deshabilitado={guardando}
          onCambio={(v) => fijar("telefono", v)}
        />
      </View>
      <View {...bloque("correo")} style={estilos.deContacto}>
        <CampoTexto
          testID="proveedor-correo"
          refFoco={refFoco("correo")}
          etiqueta="Correo"
          teclado="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          maximo={254}
          valor={valores.correo}
          error={errores.correo}
          deshabilitado={guardando}
          onCambio={(v) => fijar("correo", v)}
        />
      </View>
      <View {...bloque("contacto")}>
        <CampoTexto
          testID="proveedor-contacto"
          refFoco={refFoco("contacto")}
          etiqueta="Persona de contacto"
          opcional
          maximo={120}
          valor={valores.contacto}
          error={errores.contacto}
          deshabilitado={guardando}
          onCambio={(v) => fijar("contacto", v)}
        />
      </View>
      <View {...bloque("identificacion")}>
        <CampoTexto
          testID="proveedor-identificacion"
          refFoco={refFoco("identificacion")}
          etiqueta="Cédula o RUC"
          opcional
          maximo={20}
          ayuda="La cédula (10 dígitos) o el RUC (13)."
          valor={valores.identificacion}
          error={errores.identificacion}
          deshabilitado={guardando}
          onCambio={(v) => fijar("identificacion", v)}
        />
      </View>
      <Boton
        testID="guardar-proveedor"
        titulo={guardando ? "Registrando…" : "Registrar y elegir"}
        icono="check"
        cargando={guardando}
        onPress={guardar}
      />
      <Boton testID="cancelar-proveedor" titulo="Cancelar" variante="secundario" deshabilitado={guardando} onPress={cerrar} />
    </Ventana>
  );
}

const fabricaDeEstilos = (colores) => crearEstilos({
  leyenda: { fontSize: 14, color: colores.tintaSuave },
  grupo: { gap: 8 },
  // Teléfono y correo, bajo «Contacto (al menos uno)».
  deContacto: { paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: colores.bordeFuerte },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  obligatorio: { color: colores.malTexto },
});
