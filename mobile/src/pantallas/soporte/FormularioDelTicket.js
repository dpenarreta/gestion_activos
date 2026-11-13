import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { anunciar } from "../../accesibilidad/anunciar";
import { Icono } from "../../componentes/Icono";
import { SelectorFecha } from "../../componentes/SelectorFecha";
import { Casilla, OpcionesEnLinea, SelectorDeLista } from "../../componentes/Selectores";
import {
  camposVisibles,
  IMPACTOS_LLANOS,
  TERCERA_PERSONA,
  URGENCIAS_LLANAS,
} from "../../soporte/formato";
import { MINIMO_PARA_SUGERIR, sugerirCasos } from "../../soporte/sugerirCaso";
import { AREA_TACTIL, colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { crearEstilos } from "../../tema/tipografia";
import { CampoTexto } from "../permisos/piezas";

/**
 * Los campos del ticket como los configuró la empresa (`CamposFormulario`
 * de la web, US-014, CA-4 y CA-16): la descripción primero y, debajo, «¿Es
 * alguno de estos?» con hasta 3 casos parecidos (`sugerirCaso.js`); la
 * categoría y el caso; impacto y urgencia en lenguaje llano; y los campos
 * propios de la empresa (con su tipo, si son obligatorios y sus opciones).
 * Un campo propio limitado a ciertas categorías aparece al elegir una.
 *
 * `bloque(clave)` y `refFoco(clave)` son los de `useIrAlBloque`: con un error,
 * la pantalla y el lector van al primer campo que falla.
 */
/** H-19: las sugerencias se calculan (y se anuncian) cuando se deja de
 * escribir, no en cada tecla; el «no encontramos» tampoco aparece antes. */
export const ESPERA_SUGERIR_MS = 400;
export const ESPERA_ANUNCIO_SUGERENCIAS_MS = ESPERA_SUGERIR_MS;
export const TEXTO_SIN_SUGERENCIAS = "No encontramos un caso parecido: elija la categoría y el caso abajo.";

const TECLADOS = { numero: "decimal-pad", correo: "email-address", telefono: "phone-pad" };
const LARGOS = { texto: 200, parrafo: 2000, correo: 254, telefono: 20, numero: 30 };

function Sugerencias({ datos, valores, onBase, deshabilitado }) {
  const descripcion = valores.descripcion ?? "";
  // La descripción con la que se sugiere: la de cuando se dejó de escribir.
  const [pausada, setPausada] = useState(descripcion);
  useEffect(() => {
    const espera = setTimeout(() => setPausada(descripcion), ESPERA_SUGERIR_MS);
    return () => clearTimeout(espera);
  }, [descripcion]);
  const corta = pausada.trim().length < MINIMO_PARA_SUGERIR;
  const sugeridas = useMemo(
    () => (corta ? [] : sugerirCasos(pausada, datos.categorias)),
    [corta, pausada, datos.categorias],
  );
  // Al lector, solo un resumen y cuando deja de escribir (la web también).
  const resumen = corta
    ? ""
    : sugeridas.length
      ? `${sugeridas.length} ${sugeridas.length === 1 ? "caso sugerido" : "casos sugeridos"} bajo la descripción.`
      : "Sin casos sugeridos.";
  useEffect(() => {
    if (resumen) anunciar(resumen);
  }, [resumen]);
  if (corta) return null;
  if (sugeridas.length === 0) {
    return (
      <Text style={estilos.tenue} testID="sin-sugerencias">
        {TEXTO_SIN_SUGERENCIAS}
      </Text>
    );
  }
  return (
    <View style={estilos.sugerencias} testID="sugerencias">
      <Text style={estilos.texto}>
        <Text style={estilos.negrita}>¿Es alguno de estos?</Text> Elija uno y se llenan la categoría y el caso;
        puede cambiarlos abajo.
      </Text>
      {sugeridas.map((s) => {
        const elegida = String(s.caso.id) === String(valores.caso) && String(s.categoria.id) === String(valores.categoria);
        const texto = `${s.categoria.nombre} › ${s.caso.nombre}`;
        return (
          <Pressable
            key={s.caso.id}
            testID={`sugerencia-${s.caso.id}`}
            disabled={deshabilitado}
            onPress={() => {
              onBase("categoria", String(s.categoria.id));
              onBase("caso", String(s.caso.id));
              anunciar(`Elegido: ${texto}.`);
            }}
            accessibilityRole="button"
            accessibilityLabel={elegida ? `${texto}, elegido` : texto}
            accessibilityState={{ selected: elegida, disabled: deshabilitado }}
            style={({ pressed }) => [estilos.pildora, elegida && estilos.pildoraActiva, pressed && !elegida && estilos.presionada]}
          >
            {elegida ? <Icono nombre="check" size={18} color={colores.sobrePrimario} /> : null}
            <Text style={[estilos.pildoraTexto, elegida && estilos.pildoraTextoActivo]}>{texto}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** El control de un campo propio, según su tipo. */
function CampoPropio({ campo, valor, onCambiar, error, refFoco, deshabilitado }) {
  const testID = `campo-${campo.clave}`;
  const comun = {
    etiqueta: campo.etiqueta,
    obligatorio: campo.obligatorio,
    opcional: !campo.obligatorio,
    ayuda: campo.ayuda || undefined,
    error,
  };
  switch (campo.tipo) {
    case "casilla":
      return (
        <Casilla
          {...comun}
          testID={testID}
          refFoco={refFoco}
          marcada={Boolean(valor)}
          onCambio={onCambiar}
        />
      );
    case "lista": {
      const opciones = (campo.opciones ?? []).map((o) => ({ valor: o, texto: o }));
      return opciones.length <= 4 ? (
        <OpcionesEnLinea {...comun} testID={testID} refFoco={refFoco} opciones={opciones} valor={valor ?? ""} onCambio={onCambiar} deshabilitado={deshabilitado} />
      ) : (
        <SelectorDeLista {...comun} testID={testID} refFoco={refFoco} opciones={opciones} valor={valor ?? ""} onCambio={onCambiar} deshabilitado={deshabilitado} />
      );
    }
    case "fecha":
      return (
        <SelectorFecha
          etiqueta={campo.etiqueta}
          obligatorio={campo.obligatorio}
          ayuda={campo.ayuda || undefined}
          error={error}
          testID={testID}
          refFoco={refFoco}
          valor={valor ?? ""}
          onCambio={onCambiar}
          deshabilitado={deshabilitado}
        />
      );
    default:
      return (
        <CampoTexto
          {...comun}
          testID={testID}
          refFoco={refFoco}
          valor={valor ?? ""}
          onCambio={onCambiar}
          multilinea={campo.tipo === "parrafo"}
          maximo={LARGOS[campo.tipo] ?? 200}
          teclado={TECLADOS[campo.tipo]}
          deshabilitado={deshabilitado}
        />
      );
  }
}

export function FormularioDelTicket({
  datos,
  valores,
  onBase,
  adicionales,
  onAdicional,
  errores = {},
  tercera = false,
  describirPrimero = true,
  bloque = () => ({}),
  refFoco = () => undefined,
  deshabilitado = false,
}) {
  const visibles = camposVisibles(datos.campos, valores.categoria, describirPrimero);
  const categorias = datos.categorias ?? [];
  const categoria = categorias.find((c) => String(c.id) === String(valores.categoria));

  return visibles.map((campo) => {
    const error = errores[campo.clave];
    const etiqueta = (tercera && TERCERA_PERSONA.etiquetas[campo.etiqueta]) || campo.etiqueta;
    let control;
    if (!campo.base) {
      control = (
        <CampoPropio
          campo={campo}
          valor={adicionales[campo.clave]}
          onCambiar={(v) => onAdicional(campo.clave, v)}
          error={error}
          refFoco={refFoco(campo.clave)}
          deshabilitado={deshabilitado}
        />
      );
    } else if (campo.clave === "descripcion") {
      control = (
        <>
          <CampoTexto
            testID="campo-descripcion"
            refFoco={refFoco("descripcion")}
            etiqueta={etiqueta}
            obligatorio={campo.obligatorio}
            ayuda={campo.ayuda || (describirPrimero ? "Con sus palabras: qué pasa, desde cuándo y qué mensaje ve." : undefined)}
            placeholder="Por ejemplo: «No puedo imprimir; la impresora dice papel atascado»."
            valor={valores.descripcion ?? ""}
            onCambio={(v) => onBase("descripcion", v)}
            error={error}
            multilinea
            maximo={5000}
            deshabilitado={deshabilitado}
          />
          {describirPrimero ? (
            <Sugerencias datos={datos} valores={valores} onBase={onBase} deshabilitado={deshabilitado} />
          ) : null}
        </>
      );
    } else if (campo.clave === "categoria") {
      control = (
        <SelectorDeLista
          testID="campo-categoria"
          refFoco={refFoco("categoria")}
          etiqueta={etiqueta}
          obligatorio={campo.obligatorio}
          ayuda={campo.ayuda || undefined}
          error={error}
          vacio="Elija la categoría"
          opciones={categorias.map((c) => ({ valor: String(c.id), texto: c.nombre, detalle: c.descripcion || undefined }))}
          valor={valores.categoria ?? ""}
          onCambio={(v) => onBase("categoria", v)}
          deshabilitado={deshabilitado}
        />
      );
    } else if (campo.clave === "caso") {
      const caso = categoria?.casos?.find((c) => String(c.id) === String(valores.caso));
      control = (
        <>
          <SelectorDeLista
            testID="campo-caso"
            refFoco={refFoco("caso")}
            etiqueta={etiqueta}
            obligatorio={campo.obligatorio}
            ayuda={campo.ayuda || undefined}
            error={error}
            vacio="Elija el caso"
            textoDeshabilitado="Elija primero la categoría"
            deshabilitado={deshabilitado || !categoria}
            opciones={(categoria?.casos ?? []).map((c) => ({ valor: String(c.id), texto: c.nombre }))}
            valor={valores.caso ?? ""}
            onCambio={(v) => onBase("caso", v)}
          />
          {/* Sin «P1 · Crítica»: quien pide no sabe qué es y la prioridad
              final depende de lo que responda abajo. */}
          {caso?.tipo_display ? <Text style={estilos.tenue}>{caso.tipo_display}</Text> : null}
        </>
      );
    } else {
      // Impacto y urgencia: en palabras de quien pide (o de la persona por
      // la que se registra).
      const propias =
        campo.clave === "impacto" ? (datos.impactos ?? IMPACTOS_LLANOS) : (datos.urgencias ?? URGENCIAS_LLANAS);
      const opciones = propias.map((o) => ({
        valor: o.id,
        texto: (tercera && TERCERA_PERSONA[campo.clave]?.[o.id]) || o.nombre,
      }));
      control = (
        <OpcionesEnLinea
          testID={`campo-${campo.clave}`}
          refFoco={refFoco(campo.clave)}
          etiqueta={etiqueta}
          obligatorio={campo.obligatorio}
          opcional={!campo.obligatorio}
          ayuda={campo.ayuda || undefined}
          error={error}
          opciones={campo.obligatorio ? opciones : [...opciones, { valor: "", texto: "Prefiero no responder" }]}
          valor={valores[campo.clave] ?? ""}
          onCambio={(v) => onBase(campo.clave, v)}
          deshabilitado={deshabilitado}
        />
      );
    }
    return (
      <View key={campo.clave} style={estilos.grupo} {...bloque(campo.clave)}>
        {control}
      </View>
    );
  });
}

const estilos = crearEstilos({
  grupo: { gap: 6 },
  texto: { fontSize: 15, color: colores.tinta },
  negrita: { fontWeight: "700" },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  sugerencias: { gap: 8 },
  pildora: { ...CONTROLES.pildora, minHeight: AREA_TACTIL, alignSelf: "flex-start", paddingVertical: 8 },
  pildoraActiva: CONTROLES.pildoraActiva,
  pildoraTexto: CONTROLES.pildoraTexto,
  pildoraTextoActivo: CONTROLES.pildoraTextoActivo,
  presionada: { backgroundColor: colores.realce },
});
