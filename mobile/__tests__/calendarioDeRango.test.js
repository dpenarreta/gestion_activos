import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";
import * as ReactNative from "react-native";
import { AccessibilityInfo, Platform, StyleSheet, Text } from "react-native";

import { CalendarioDeRango, diametroDelNumero, nombreDelDiaEnRango } from "../src/componentes/CalendarioDeRango";
import { moverMes as moverMesDeLaMatriz } from "../src/matriz/formato";
import { diasDeLaCuadricula as cuadriculaDeInicio } from "../src/inicio/calendario";
import { AREA_TACTIL, paletaClara, paletaOscura } from "../src/tema/colores";
import {
  diaCompleto,
  diasDeCalendario,
  diasDeLaCuadricula,
  esFinDeSemana,
  moverMes,
  semanasDeLaCuadricula,
} from "../src/utils/calendario";
import { coloresClarosEn, olvidarApariencia, renderEnOscuro } from "./utilidades/modoOscuro";

/**
 * US-030 (17/11/2026): el calendario para elegir el período de un permiso.
 * Hoy es el martes 17 de noviembre de 2026.
 */
const HOY = "2026-11-17";

/** El calendario con su estado, como lo usa «Nueva solicitud»: los campos
 * son la fuente. `externo.fijar` cambia los valores como lo haría un campo. */
const externo = { fijar: null };
const cambios = [];
function Envoltura({ inicial = { desde: HOY, hasta: HOY }, ...props }) {
  const [valores, setValores] = useState(inicial);
  externo.fijar = setValores;
  return (
    <>
      <CalendarioDeRango
        desde={valores.desde}
        hasta={valores.hasta}
        hoy={HOY}
        onCambio={(nuevos) => {
          cambios.push(nuevos);
          setValores(nuevos);
        }}
        {...props}
      />
      <Text testID="valores">{`${valores.desde}|${valores.hasta}`}</Text>
    </>
  );
}

const dia = (iso) => screen.getByTestId(`calendario-rango-dia-${iso}`);
const tocar = (iso) => fireEvent.press(dia(iso));
const valores = () => screen.getByTestId("valores").props.children;
const mes = () => screen.getByTestId("calendario-rango-mes").props.children;

beforeEach(() => {
  cambios.length = 0;
  jest.restoreAllMocks();
});

describe("lo puro (utils/calendario)", () => {
  test("los días de calendario cuentan los dos extremos", () => {
    expect(diasDeCalendario("2026-11-17", "2026-11-17")).toBe(1);
    expect(diasDeCalendario("2026-11-20", "2026-11-24")).toBe(5);
    // Cruza de mes y de año.
    expect(diasDeCalendario("2026-12-30", "2027-01-02")).toBe(4);
    expect(diasDeCalendario("2026-11-24", "2026-11-20")).toBeNull();
    expect(diasDeCalendario("", "2026-11-20")).toBeNull();
    expect(diasDeCalendario("2026-02-30", "2026-03-01")).toBeNull();
  });

  test("las semanas del mes van de lunes a domingo, sin las ajenas al mes", () => {
    // Noviembre de 2026 empieza en domingo y termina en lunes: 6 semanas.
    const semanas = semanasDeLaCuadricula(2026, 11);
    expect(semanas).toHaveLength(6);
    expect(semanas[0][0].iso).toBe("2026-10-26");
    expect(semanas[0][6]).toEqual({ iso: "2026-11-01", numero: 1, delMes: true, finDeSemana: true });
    expect(semanas[5][0].iso).toBe("2026-11-30");
    // Febrero de 2027 empieza en lunes y tiene 28 días: 4 semanas justas.
    expect(semanasDeLaCuadricula(2027, 2)).toHaveLength(4);
  });

  test("Inicio y la Matriz usan la misma pieza", () => {
    expect(cuadriculaDeInicio).toBe(diasDeLaCuadricula);
    expect(moverMesDeLaMatriz).toBe(moverMes);
    expect(moverMes({ anio: 2026, mes: 12 }, 1)).toEqual({ anio: 2027, mes: 1 });
  });

  test("el nombre completo de un día y los fines de semana", () => {
    expect(diaCompleto("2026-11-17")).toBe("Martes 17 de noviembre de 2026");
    expect(diaCompleto("2026-11-21")).toBe("Sábado 21 de noviembre de 2026");
    expect(esFinDeSemana("2026-11-21")).toBe(true);
    expect(esFinDeSemana("2026-11-22")).toBe(true);
    expect(esFinDeSemana("2026-11-23")).toBe(false);
  });
});

describe("CA-1: el calendario a la vista", () => {
  test("abre en el mes de «Desde», de lunes a domingo", async () => {
    await render(<Envoltura inicial={{ desde: "2027-01-05", hasta: "2027-01-08" }} />);
    expect(mes()).toBe("Enero 2027");
    const cabecera = screen.getAllByText(/^(Lun|Mar|Mié|Jue|Vie|Sáb|Dom)$/, { includeHiddenElements: true });
    expect(cabecera.map((t) => t.props.children)).toEqual(["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]);
  });

  test("sin fecha abre en el mes de hoy", async () => {
    await render(<Envoltura inicial={{ desde: "", hasta: "" }} />);
    expect(mes()).toBe("Noviembre 2026");
    expect(screen.queryByTestId("calendario-rango-resumen")).toBeNull();
  });

  test("se pasa al mes anterior y al siguiente con botones que dicen a cuál", async () => {
    await render(<Envoltura />);
    const siguiente = screen.getByTestId("calendario-rango-mes-siguiente");
    expect(siguiente.props.accessibilityLabel).toBe("Mes siguiente, Diciembre 2026");
    expect(siguiente.props.accessibilityRole).toBe("button");
    await fireEvent.press(siguiente);
    expect(mes()).toBe("Diciembre 2026");
    expect(screen.getByTestId("calendario-rango-dia-2026-12-31")).toBeTruthy();
    expect(screen.queryByTestId("calendario-rango-dia-2026-11-17")).toBeNull();
    await fireEvent.press(screen.getByTestId("calendario-rango-mes-anterior"));
    await fireEvent.press(screen.getByTestId("calendario-rango-mes-anterior"));
    expect(mes()).toBe("Octubre 2026");
    // Cambiar de mes no cambia las fechas.
    expect(valores()).toBe(`${HOY}|${HOY}`);
  });

  test("los días de los meses vecinos quedan en blanco y no se tocan", async () => {
    await render(<Envoltura />);
    expect(screen.queryByTestId("calendario-rango-dia-2026-10-31")).toBeNull();
  });
});

describe("CA-2 y CA-4: elegir el período", () => {
  test("primer toque fija «Desde» y «Hasta»; el segundo, «Hasta»; el conteo al instante", async () => {
    await render(<Envoltura />);
    expect(screen.getByTestId("calendario-rango-resumen").props.children).toBe("17/11/2026: 1 día");

    await tocar("2026-11-20");
    expect(valores()).toBe("2026-11-20|2026-11-20");
    expect(screen.getByTestId("calendario-rango-instruccion").props.children).toMatch(/^Ahora toque el último día/);

    await tocar("2026-11-24");
    expect(valores()).toBe("2026-11-20|2026-11-24");
    expect(screen.getByTestId("calendario-rango-resumen").props.children).toBe("Del 20/11/2026 al 24/11/2026: 5 días");
    expect(cambios).toEqual([
      { desde: "2026-11-20", hasta: "2026-11-20" },
      { desde: "2026-11-20", hasta: "2026-11-24" },
    ]);
  });

  test("el segundo toque en el mismo día deja un período de un día", async () => {
    await render(<Envoltura />);
    await tocar("2026-11-20");
    await tocar("2026-11-20");
    expect(valores()).toBe("2026-11-20|2026-11-20");
    // Ya completo: el siguiente empieza otra selección.
    await tocar("2026-11-25");
    expect(valores()).toBe("2026-11-25|2026-11-25");
  });

  test("al revés: un segundo toque anterior pasa a ser el nuevo «Desde»", async () => {
    await render(<Envoltura />);
    await tocar("2026-11-20");
    await tocar("2026-11-15");
    expect(valores()).toBe("2026-11-15|2026-11-15");
    // Se sigue esperando el último día.
    await tocar("2026-11-18");
    expect(valores()).toBe("2026-11-15|2026-11-18");
  });

  test("con el período completo, un toque empieza otro", async () => {
    await render(<Envoltura />);
    await tocar("2026-11-20");
    await tocar("2026-11-24");
    await tocar("2026-11-26");
    expect(valores()).toBe("2026-11-26|2026-11-26");
    await tocar("2026-11-27");
    expect(valores()).toBe("2026-11-26|2026-11-27");
  });

  test("el período se elige también entre meses", async () => {
    await render(<Envoltura />);
    await tocar("2026-11-28");
    await fireEvent.press(screen.getByTestId("calendario-rango-mes-siguiente"));
    await tocar("2026-12-02");
    expect(valores()).toBe("2026-11-28|2026-12-02");
    expect(screen.getByTestId("calendario-rango-resumen").props.children).toBe("Del 28/11/2026 al 02/12/2026: 5 días");
    // El mes siguiente sigue a la vista y su día 1 está dentro.
    expect(dia("2026-12-01").props.accessibilityLabel).toBe("Martes 1 de diciembre de 2026, dentro del período");
  });

  test("los extremos llevan forma (círculo con borde) y los de dentro una franja con líneas", async () => {
    await render(<Envoltura inicial={{ desde: "2026-11-23", hasta: "2026-11-25" }} />);
    const caja = (iso) => StyleSheet.flatten(dia(iso).children[0].props.style);
    const celda = (iso) => StyleSheet.flatten(dia(iso).props.style);
    expect(caja("2026-11-23").backgroundColor).toBe(paletaClara.primario);
    expect(caja("2026-11-23").borderWidth).toBeGreaterThan(0);
    expect(caja("2026-11-23").borderRadius).toBeGreaterThan(0);
    expect(celda("2026-11-24").backgroundColor).toBe(paletaClara.realce);
    expect(celda("2026-11-24").borderTopWidth).toBeGreaterThan(0);
    expect(celda("2026-11-24").borderBottomWidth).toBeGreaterThan(0);
    expect(caja("2026-11-24").backgroundColor).toBeUndefined();
    expect(celda("2026-11-26").backgroundColor).toBeUndefined();
  });
});

describe("O-5: febrero bisiesto", () => {
  test("febrero de 2028 tiene el 29 y del 27/02 al 01/03 son 4 días", async () => {
    expect(diasDeCalendario("2028-02-27", "2028-03-01")).toBe(4);
    await render(<Envoltura inicial={{ desde: "2028-02-27", hasta: "2028-02-27" }} />);
    expect(mes()).toBe("Febrero 2028");
    expect(dia("2028-02-29").props.accessibilityLabel).toBe("Martes 29 de febrero de 2028");
    await tocar("2028-02-27");
    await fireEvent.press(screen.getByTestId("calendario-rango-mes-siguiente"));
    await tocar("2028-03-01");
    expect(valores()).toBe("2028-02-27|2028-03-01");
    expect(screen.getByTestId("calendario-rango-resumen").props.children).toBe("Del 27/02/2028 al 01/03/2028: 4 días");
  });
});

describe("CA-3: sincronizado con los campos", () => {
  test("un cambio de «Desde» en su campo lleva al mes y reinicia la elección", async () => {
    await render(<Envoltura />);
    await tocar("2026-11-20");
    await act(async () => externo.fijar({ desde: "2027-02-03", hasta: "2027-02-03" }));
    expect(mes()).toBe("Febrero 2027");
    expect(dia("2027-02-03").props.accessibilityLabel).toBe("Miércoles 3 de febrero de 2027, inicio y fin del período");
    // La elección empezó de nuevo: el próximo toque es el primero.
    await tocar("2027-02-10");
    expect(valores()).toBe("2027-02-10|2027-02-10");
    expect(cambios).toHaveLength(2);
  });

  test("un cambio de «Hasta» en su campo lleva al mes de «Hasta»", async () => {
    await render(<Envoltura />);
    await act(async () => externo.fijar({ desde: HOY, hasta: "2027-01-08" }));
    expect(mes()).toBe("Enero 2027");
    expect(dia("2027-01-08").props.accessibilityLabel).toBe("Viernes 8 de enero de 2027, fin del período");
    expect(screen.getByTestId("calendario-rango-resumen").props.children).toBe("Del 17/11/2026 al 08/01/2027: 53 días");
  });

  test("lo elegido en el calendario no mueve el mes que se ve", async () => {
    await render(<Envoltura />);
    await fireEvent.press(screen.getByTestId("calendario-rango-mes-siguiente"));
    await tocar("2026-12-10");
    expect(mes()).toBe("Diciembre 2026");
  });
});

describe("CA-5: un solo día (permiso por horas)", () => {
  test("cada toque elige el único día", async () => {
    await render(<Envoltura unDia />);
    expect(screen.getByTestId("calendario-rango-instruccion").props.children).toBe("Toque el día del permiso.");
    await tocar("2026-11-20");
    expect(valores()).toBe("2026-11-20|2026-11-20");
    await tocar("2026-11-25");
    expect(valores()).toBe("2026-11-25|2026-11-25");
    expect(dia("2026-11-25").props.accessibilityLabel).toBe("Miércoles 25 de noviembre de 2026, día elegido");
    expect(dia("2026-11-20").props.accessibilityState.selected).toBe(false);
    expect(screen.getByTestId("calendario-rango-resumen").props.children).toBe("Día elegido: 25/11/2026");
  });
});

describe("CA-6: días distinguibles", () => {
  test("hoy se marca con anillo y subrayado", async () => {
    await render(<Envoltura inicial={{ desde: "2026-11-20", hasta: "2026-11-20" }} />);
    expect(dia(HOY).props.accessibilityLabel).toBe("Martes 17 de noviembre de 2026, hoy");
    const numero = StyleSheet.flatten(screen.getByText("17").props.style);
    expect(numero.textDecorationLine).toBe("underline");
  });

  test("sábados y domingos van en tono suave y se pueden elegir", async () => {
    await render(<Envoltura />);
    expect(StyleSheet.flatten(dia("2026-11-21").props.style).backgroundColor).toBe(paletaClara.hundido);
    expect(dia("2026-11-22").props.accessibilityState.disabled).toBe(false);
    await tocar("2026-11-21");
    expect(valores()).toBe("2026-11-21|2026-11-21");
  });

  test("los días fuera del mínimo se ven deshabilitados y no se tocan", async () => {
    await render(<Envoltura minimo={HOY} />);
    const ayer = dia("2026-11-16");
    expect(ayer.props.accessibilityState.disabled).toBe(true);
    expect(ayer.props.accessibilityLabel).toBe("Lunes 16 de noviembre de 2026, no disponible");
    expect(StyleSheet.flatten(screen.getByText("16").props.style).textDecorationLine).toBe("line-through");
    await tocar("2026-11-16");
    expect(cambios).toEqual([]);
    // Antes del mínimo no hay días: el mes anterior no se abre.
    expect(screen.getByTestId("calendario-rango-mes-anterior").props.accessibilityState.disabled).toBe(true);
    expect(dia(HOY).props.accessibilityState.disabled).toBe(false);
  });

  test("y los de después del máximo", async () => {
    await render(<Envoltura maximo="2026-11-20" />);
    expect(dia("2026-11-21").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByTestId("calendario-rango-mes-siguiente").props.accessibilityState.disabled).toBe(true);
  });
});

describe("CA-7: accesibilidad y tema", () => {
  test("cada día es un botón de 44 o más con su nombre y su estado", async () => {
    await render(<Envoltura inicial={{ desde: "2026-11-23", hasta: "2026-11-25" }} />);
    const inicio = dia("2026-11-23");
    expect(inicio.props.accessibilityRole).toBe("button");
    expect(inicio.props.accessibilityLabel).toBe("Lunes 23 de noviembre de 2026, inicio del período");
    expect(inicio.props.accessibilityState).toEqual({ selected: true, disabled: false });
    expect(dia("2026-11-24").props.accessibilityLabel).toBe("Martes 24 de noviembre de 2026, dentro del período");
    expect(dia("2026-11-25").props.accessibilityLabel).toBe("Miércoles 25 de noviembre de 2026, fin del período");
    expect(dia("2026-11-26").props.accessibilityState.selected).toBe(false);
    expect(StyleSheet.flatten(inicio.props.style).minHeight).toBeGreaterThanOrEqual(AREA_TACTIL);
    expect(AREA_TACTIL).toBeGreaterThanOrEqual(44);
    expect(inicio.props.accessibilityHint).toBe("Elegir este día para «Desde» o «Hasta»");
  });

  test("anuncia el inicio y luego el período elegido", async () => {
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    await render(<Envoltura />);
    await tocar("2026-11-20");
    expect(anuncio).toHaveBeenLastCalledWith(
      "Desde: Viernes 20 de noviembre de 2026. Ahora toque el último día del período.",
    );
    // La pista no cambia con cada toque: el memo de los días se conserva.
    expect(dia("2026-11-22").props.accessibilityHint).toBe("Elegir este día para «Desde» o «Hasta»");
    await tocar("2026-11-24");
    expect(anuncio).toHaveBeenLastCalledWith(
      "Período elegido: del Viernes 20 de noviembre de 2026 al Martes 24 de noviembre de 2026, 5 días.",
    );
  });

  test("en Android solo se anuncia el inicio: el período lo lee el resumen de la pantalla", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    anuncio.mockClear();
    await render(<Envoltura />);
    await tocar("2026-11-20");
    await tocar("2026-11-24");
    expect(anuncio).toHaveBeenCalledTimes(1);
    expect(anuncio).toHaveBeenCalledWith("Desde: Viernes 20 de noviembre de 2026. Ahora toque el último día del período.");
    expect(valores()).toBe("2026-11-20|2026-11-24");
  });

  test("por horas la pista dice «Elegir este día»", async () => {
    await render(<Envoltura unDia />);
    expect(dia("2026-11-20").props.accessibilityHint).toBe("Elegir este día");
  });

  test("el círculo de los extremos sigue redondo con la letra grande", async () => {
    expect(diametroDelNumero(1)).toBe(36);
    expect(diametroDelNumero(2)).toBeLessThanOrEqual(AREA_TACTIL - 4);
    expect(diametroDelNumero(2)).toBeGreaterThan(diametroDelNumero(1));
    const dimensiones = { width: 360, height: 800, scale: 2, fontScale: 2 };
    jest.spyOn(ReactNative, "useWindowDimensions").mockReturnValue(dimensiones);
    await render(<Envoltura inicial={{ desde: "2026-11-23", hasta: "2026-11-25" }} />);
    const caja = StyleSheet.flatten(dia("2026-11-23").children[0].props.style);
    expect(caja.width).toBe(diametroDelNumero(2));
    expect(caja.height).toBe(caja.width);
    expect(caja.borderRadius).toBe(caja.width / 2);
  });

  test("con la letra al 200 % las celdas crecen y el número se ajusta", async () => {
    await render(<Envoltura />);
    const celda = StyleSheet.flatten(dia("2026-11-20").props.style);
    // Sin alto fijo: solo un mínimo.
    expect(celda.height).toBeUndefined();
    expect(celda.minHeight).toBeGreaterThanOrEqual(AREA_TACTIL);
    const numero = screen.getByText("20");
    expect(numero.props.allowFontScaling).not.toBe(false);
    expect(numero.props.maxFontSizeMultiplier ?? 2).toBeGreaterThanOrEqual(2);
    expect(numero.props.adjustsFontSizeToFit).toBe(true);
  });

  describe("modo oscuro", () => {
    afterEach(olvidarApariencia);

    test("sin colores claros fijos y con los extremos en la paleta oscura", async () => {
      const vista = await renderEnOscuro(<Envoltura inicial={{ desde: "2026-11-23", hasta: "2026-11-25" }} />);
      expect(coloresClarosEn(vista.toJSON())).toEqual([]);
      const caja = StyleSheet.flatten(dia("2026-11-23").children[0].props.style);
      expect(caja.backgroundColor).toBe(paletaOscura.primario);
      expect(StyleSheet.flatten(dia("2026-11-24").props.style).backgroundColor).toBe(paletaOscura.realce);
    });
  });
});

test("el nombre de un día junta todo lo que le corresponde", () => {
  expect(nombreDelDiaEnRango("2026-11-17", { papel: "unico", esHoy: true })).toBe(
    "Martes 17 de noviembre de 2026, inicio y fin del período, hoy",
  );
  expect(nombreDelDiaEnRango("2026-11-16", { fuera: true })).toBe("Lunes 16 de noviembre de 2026, no disponible");
});
