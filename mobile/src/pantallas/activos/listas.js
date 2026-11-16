import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";

import { ESPACIO_BOTON_FLOTANTE } from "../../componentes/BotonFlotante";
import { Alerta, Boton, Cargando, ErrorConReintento, Vacio } from "../../componentes/comunes";
import { Icono } from "../../componentes/Icono";
import { colores } from "../../tema/colores";
import { CONTROLES } from "../../tema/controles";
import { crearEstilos } from "../../tema/tipografia";
import { Separador } from "../soporte/piezas";

/**
 * Las piezas de las listas de la Tanda B de la US-022 (la bitácora, Mis
 * solicitudes y Recibidas), con el mismo aspecto que el inventario: el
 * buscador, los chips de filtro y la lista paginada con sus estados (CA-5).
 */

/** El campo de búsqueda con su lupa. La etiqueta visible no se lee dos
 * veces: el nombre accesible ya la dice. */
export function BuscadorDeLista({ texto, onCambio, onBuscar, etiqueta, placeholder, testID, accion = null }) {
  return (
    <>
      <Text style={estilos.etiqueta} importantForAccessibility="no" accessibilityElementsHidden>
        Buscar
      </Text>
      <View style={estilos.filaBuscador}>
        <View style={estilos.buscador}>
          <Icono nombre="magnify" size={20} color={colores.tintaSuave} />
          <TextInput
            testID={testID}
            value={texto}
            onChangeText={onCambio}
            placeholder={placeholder}
            placeholderTextColor={colores.tintaTenue}
            accessibilityLabel={etiqueta}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={onBuscar}
            style={estilos.entrada}
          />
        </View>
        {accion}
      </View>
    </>
  );
}

/** Los chips de un filtro: el elegido con fondo negro y ✓ (no solo color). */
export function ChipsDeFiltro({ filtros, valor, onCambio, etiqueta, prefijo = "filtro" }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={estilos.chips}
      accessibilityRole="tablist"
      accessibilityLabel={etiqueta}
    >
      {filtros.map((f) => {
        const activo = f.clave === valor;
        return (
          <Pressable
            key={f.clave}
            testID={`${prefijo}-${f.clave}`}
            onPress={() => onCambio(f.clave)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activo }}
            accessibilityLabel={f.texto}
            style={({ pressed }) => [estilos.chip, activo && estilos.chipActivo, pressed && !activo && estilos.presionada]}
          >
            {activo ? <Icono nombre="check" size={16} color={colores.sobrePrimario} /> : null}
            <Text style={[estilos.chipTexto, activo && estilos.chipTextoActivo]}>{f.texto}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * La lista paginada de `useListaPaginada`, con «Cargando…», vacío, error con
 * «Reintentar», «Ver más» y deslizar para actualizar. `cabecera` va arriba
 * (buscador, filtros); `total` es el texto del total («12 mantenimientos»).
 */
export function ListaPaginada({
  testID,
  testIDTotal,
  paginada,
  cabecera,
  renderItem,
  total,
  textos,
  iconoVacio = "information-outline",
}) {
  const { lista, refrescando, cargandoMas, errorMas, cargar, cargarMas, refrescar } = paginada;

  let vacio;
  if (lista.estado === "cargando") vacio = <Cargando texto={textos.cargando} />;
  else if (lista.estado === "error") vacio = <ErrorConReintento texto={lista.error} onReintentar={() => cargar()} />;
  else vacio = <Vacio icono={iconoVacio} texto={textos.vacio} />;

  return (
    <FlatList
      testID={testID}
      style={estilos.lista}
      contentContainerStyle={estilos.contenido}
      keyboardShouldPersistTaps="handled"
      data={lista.estado === "listo" ? lista.items : []}
      keyExtractor={(x) => String(x.id)}
      ListHeaderComponent={
        <View style={estilos.cabecera}>
          {cabecera}
          {lista.estado === "listo" && total ? (
            <Text
              style={estilos.tenue}
              accessibilityLiveRegion="polite"
              testID={testIDTotal ?? (testID ? `${testID}-total` : undefined)}
            >
              {total}
            </Text>
          ) : null}
          {lista.recargando ? (
            <View style={estilos.actualizando} accessible accessibilityRole="progressbar" accessibilityLabel="Actualizando…">
              <ActivityIndicator color={colores.primario} />
              <Text style={estilos.tenue}>Actualizando…</Text>
            </View>
          ) : null}
          {lista.aviso ? <Alerta tipo="aviso" texto={lista.aviso} /> : null}
        </View>
      }
      ListEmptyComponent={vacio}
      ListFooterComponent={
        <View style={estilos.pie}>
          {cargandoMas ? (
            <View accessible accessibilityRole="progressbar" accessibilityLabel={textos.cargandoMas}>
              <ActivityIndicator color={colores.primario} />
            </View>
          ) : null}
          {errorMas ? <ErrorConReintento texto={errorMas} onReintentar={cargarMas} /> : null}
          {lista.estado === "listo" && lista.hayMas && !cargandoMas && !errorMas ? (
            <Boton testID="ver-mas" titulo={textos.verMas} icono="chevron-down" variante="secundario" onPress={cargarMas} />
          ) : null}
        </View>
      }
      onEndReached={() => {
        // Con un error de «más» a la vista se reintenta con su botón, no
        // solo por llegar al final.
        if (!errorMas) cargarMas();
      }}
      onEndReachedThreshold={0.4}
      renderItem={renderItem}
      ItemSeparatorComponent={Separador}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={refrescar} />}
    />
  );
}

export const estilos = crearEstilos({
  lista: { flex: 1 },
  // El final queda libre para la burbuja de «Escanear» (`BotonFlotante`).
  contenido: { padding: 16, paddingTop: 8, paddingBottom: ESPACIO_BOTON_FLOTANTE },
  cabecera: { gap: 8, marginBottom: 12 },
  etiqueta: { fontSize: 15, fontWeight: "600", color: colores.tinta },
  filaBuscador: { flexDirection: "row", alignItems: "center", gap: 8 },
  buscador: { ...CONTROLES.entrada, flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  actualizando: { flexDirection: "row", alignItems: "center", gap: 8 },
  entrada: { flex: 1, fontSize: 16, color: colores.tinta, paddingVertical: 8 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: CONTROLES.pildora,
  chipActivo: CONTROLES.pildoraActiva,
  chipTexto: CONTROLES.pildoraTexto,
  chipTextoActivo: CONTROLES.pildoraTextoActivo,
  presionada: { backgroundColor: colores.realce },
  tenue: { fontSize: 14, color: colores.tintaSuave },
  pie: { marginTop: 12, gap: 8 },
});
