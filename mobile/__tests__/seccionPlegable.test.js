import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { AccessibilityInfo, Platform, Text } from "react-native";

import { SeccionPlegable } from "../src/componentes/SeccionPlegable";

// El ícono real no deja ver su nombre en las pruebas: aquí lo pone en el testID.
jest.mock("../src/componentes/Icono", () => {
  const { Text: T } = require("react-native");
  return { Icono: ({ nombre }) => <T testID={`icono-${nombre}`}>·</T> };
});

const SO_ORIGINAL = Platform.OS;
afterEach(() => {
  Platform.OS = SO_ORIGINAL;
  jest.restoreAllMocks();
});

function Seccion(props) {
  return (
    <SeccionPlegable
      icono="card-account-details-outline"
      titulo="Mis datos"
      descripcion="Una descripción."
      testID="s"
      {...props}
    >
      <Text>Dentro</Text>
    </SeccionPlegable>
  );
}

describe("SeccionPlegable (US-032)", () => {
  it("el chevron pasa de chevron-down a chevron-up y vuelve", async () => {
    await render(<Seccion />);
    const cabecera = screen.getByTestId("s-cabecera");
    expect(within(cabecera).getByTestId("icono-chevron-down")).toBeTruthy();
    expect(within(cabecera).queryByTestId("icono-chevron-up")).toBeNull();
    await fireEvent.press(cabecera);
    expect(within(cabecera).getByTestId("icono-chevron-up")).toBeTruthy();
    expect(within(cabecera).queryByTestId("icono-chevron-down")).toBeNull();
    await fireEvent.press(cabecera);
    expect(within(cabecera).getByTestId("icono-chevron-down")).toBeTruthy();
  });

  it("el aviso se ve cerrada, fuera del botón y del contenido", async () => {
    await render(<Seccion aviso={<Text>Le falta algo.</Text>} />);
    const aviso = screen.getByTestId("s-aviso");
    expect(within(aviso).getByText("Le falta algo.")).toBeTruthy();
    expect(within(screen.getByTestId("s-cabecera")).queryByText("Le falta algo.")).toBeNull();
    expect(screen.queryByTestId("s-contenido")).toBeNull();
    expect(screen.getByRole("button", { name: "Mis datos. Una descripción." })).toBeTruthy();
  });

  it("con `abierta` pero sin `onCambiar` funciona sola", async () => {
    await render(<Seccion abierta={false} />);
    await fireEvent.press(screen.getByTestId("s-cabecera"));
    expect(screen.getByText("Dentro")).toBeTruthy();
  });

  it("con `abierta` y `onCambiar` la controla quien la usa", async () => {
    const onCambiar = jest.fn();
    await render(<Seccion abierta={false} onCambiar={onCambiar} />);
    await fireEvent.press(screen.getByTestId("s-cabecera"));
    expect(onCambiar).toHaveBeenCalledWith(true);
    // Sigue cerrada hasta que el padre cambie `abierta`.
    expect(screen.queryByText("Dentro")).toBeNull();
    await screen.rerender(<Seccion abierta onCambiar={onCambiar} />);
    expect(screen.getByText("Dentro")).toBeTruthy();
  });

  it("en iOS anuncia «Sección abierta» y «Sección cerrada»", async () => {
    Platform.OS = "ios";
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
    anuncio.mockClear();
    await render(<Seccion />);
    await fireEvent.press(screen.getByTestId("s-cabecera"));
    expect(anuncio).toHaveBeenLastCalledWith("Sección abierta");
    await fireEvent.press(screen.getByTestId("s-cabecera"));
    expect(anuncio).toHaveBeenLastCalledWith("Sección cerrada");
  });

  it("en Android no anuncia nada (ya lee `expanded`)", async () => {
    Platform.OS = "android";
    const anuncio = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
    anuncio.mockClear();
    await render(<Seccion />);
    await fireEvent.press(screen.getByTestId("s-cabecera"));
    expect(anuncio).not.toHaveBeenCalled();
  });
});
