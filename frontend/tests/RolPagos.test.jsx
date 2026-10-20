import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Consultar rol de pagos: el código sale de la sesión; ver pide aceptar los
 * términos y la contraseña; luego se puede enviar al correo personal, que solo
 * se guarda si se pide y se acepta.
 */

const servicio = {
  estado: vi.fn(),
  consultar: vi.fn(),
  enviar: vi.fn(),
  olvidarCorreo: vi.fn(),
  configurar: vi.fn(),
};
vi.mock("../src/api/nominaService", () => ({ nominaService: servicio }));
vi.mock("../src/components/common/VisorPdf/VisorPdf", () => ({
  VisorPdf: ({ titulo }) => <div role="dialog" aria-label={titulo} />,
}));

const { RolPagosPage } =
  await import("../src/pages/Institucional/RolPagosPage");

const ESTADO = {
  codigo: "20104758",
  terminos: "Declaro que soy el titular de este rol.",
  version: 3,
  consentimiento_correo: "Autorizo guardar mi correo.",
  correo_guardado: "",
  disponible: true,
  puede_consultar_otros: false,
  puede_configurar: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  servicio.estado.mockResolvedValue(ESTADO);
});

async function consultar() {
  render(<RolPagosPage />);
  expect(await screen.findByLabelText("Código de empleado")).toHaveValue(
    "20104758",
  );
  fireEvent.change(screen.getByLabelText("Año"), { target: { value: "2026" } });
  fireEvent.change(screen.getByLabelText("Mes"), { target: { value: "9" } });
  fireEvent.click(screen.getByRole("button", { name: /Consultar/ }));
  const ventana = screen.getByRole("dialog", {
    name: "Confirmar consulta del rol de pagos",
  });
  return ventana;
}

describe("Consultar rol de pagos", () => {
  it("el código sale de la sesión y ver pide aceptar y la contraseña", async () => {
    servicio.consultar.mockResolvedValue({
      blob: new Blob(["%PDF"]),
      consulta: 41,
    });
    const ventana = await consultar();
    expect(screen.getByLabelText("Código de empleado")).toHaveAttribute(
      "readonly",
    );
    expect(
      within(ventana).getByText("Declaro que soy el titular de este rol."),
    ).toBeInTheDocument();
    const ver = within(ventana).getByRole("button", {
      name: "Ver rol de pagos",
    });
    expect(ver).toBeDisabled();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.change(
      within(ventana).getByLabelText("Contraseña de su cuenta"),
      {
        target: { value: "secreta" },
      },
    );
    fireEvent.click(ver);
    await waitFor(() =>
      expect(servicio.consultar).toHaveBeenCalledWith({
        anio: 2026,
        mes: 9,
        codigo: "",
        acepto: true,
        version: 3,
        password: "secreta",
      }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Rol de pagos · Septiembre 2026",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Enviar a mi correo personal/ }),
    ).toBeInTheDocument();
  });

  it("con la contraseña equivocada lo dice y no muestra el rol", async () => {
    servicio.consultar.mockRejectedValue({
      response: {
        status: 403,
        data: new Blob([
          JSON.stringify({ detail: "La contraseña no es correcta." }),
        ]),
      },
    });
    const ventana = await consultar();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.change(
      within(ventana).getByLabelText("Contraseña de su cuenta"),
      {
        target: { value: "mala" },
      },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Ver rol de pagos" }),
    );
    expect(
      await within(ventana).findByText("La contraseña no es correcta."),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByLabelText("Contraseña de su cuenta"),
    ).toHaveValue("");
  });

  it("enviar al correo: no se guarda salvo que se pida y se acepte", async () => {
    servicio.consultar.mockResolvedValue({
      blob: new Blob(["%PDF"]),
      consulta: 41,
    });
    servicio.enviar.mockResolvedValue({ enviado_a: "r***@gmail.com" });
    const ventana = await consultar();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.change(
      within(ventana).getByLabelText("Contraseña de su cuenta"),
      {
        target: { value: "secreta" },
      },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Ver rol de pagos" }),
    );
    const correo = await screen.findByLabelText("Correo personal");
    fireEvent.change(correo, { target: { value: "rosa@gmail.com" } });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Guardar este correo/ }),
    );
    const enviar = screen.getByRole("button", { name: "Enviar" });
    // Pidió guardarlo: sin aceptar el tratamiento de datos no se envía.
    expect(screen.getByText("Autorizo guardar mi correo.")).toBeInTheDocument();
    expect(enviar).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Acepto que se almacene/ }),
    );
    fireEvent.click(enviar);
    await waitFor(() =>
      expect(servicio.enviar).toHaveBeenCalledWith({
        consulta: 41,
        correo: "rosa@gmail.com",
        guardar: true,
        acepto_guardar: true,
      }),
    );
    expect(
      await screen.findByText("Listo: se envió a r***@gmail.com."),
    ).toBeInTheDocument();
  });

  it("sin código de empleado lo dice y no deja consultar", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, codigo: "" });
    render(<RolPagosPage />);
    expect(
      await screen.findByText(/todavía no tiene código de empleado/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Consultar/ })).toBeDisabled();
  });

  it("Talento Humano puede escribir otro código", async () => {
    servicio.estado.mockResolvedValue({
      ...ESTADO,
      puede_consultar_otros: true,
    });
    render(<RolPagosPage />);
    const codigo = await screen.findByLabelText("Código de empleado");
    expect(codigo).not.toHaveAttribute("readonly");
    expect(codigo).toHaveAttribute("placeholder", "El suyo: 20104758");
  });
});
