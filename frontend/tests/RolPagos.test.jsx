import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Consultar rol de pagos: el código sale de la sesión; ver pide aceptar los
 * términos y escribir el código de 6 dígitos que llega al correo de la cuenta
 * (US-002, 11/11/2026: antes, la contraseña); luego se puede enviar al correo
 * personal, que solo se guarda si se pide y se acepta.
 */

const servicio = {
  estado: vi.fn(),
  pedirCodigo: vi.fn(),
  consultar: vi.fn(),
  enviar: vi.fn(),
  olvidarCorreo: vi.fn(),
  configurar: vi.fn(),
  configuracion: vi.fn(),
  aviso: vi.fn(),
  conformidad: vi.fn(),
  historial: vi.fn(),
  rolDelHistorial: vi.fn(),
  misObservaciones: vi.fn(),
  habilitados: vi.fn(),
  habilitar: vi.fn(),
  areasDescargaMasiva: vi.fn(),
  descargaMasiva: vi.fn(),
  seguimiento: vi.fn(),
  resumenSeguimiento: vi.fn(),
  exportarSeguimiento: vi.fn(),
  recordarPendientes: vi.fn(),
  personaAuditada: vi.fn(),
  rolAuditado: vi.fn(),
};
vi.mock("../src/api/nominaService", () => ({ nominaService: servicio }));
vi.mock("../src/components/common/VisorPdf/VisorPdf", () => ({
  MarcoPdf: () => <div />,
  useUrlDePdf: () => "blob:rol",
  VisorPdf: ({ titulo }) => <div role="dialog" aria-label={titulo} />,
}));

vi.mock("../src/utils/descargas", () => ({ descargarBlob: vi.fn() }));
// Solo para el enlace a «Protección de datos» de la ventana «Textos de la
// consulta» (US-004): quien configura recibió `privacidad.textos`.
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, permissions: ["privacidad.textos"] } }),
}));
const { descargarBlob } = await import("../src/utils/descargas");

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
  // En la lista de habilitados (22/10/2026).
  habilitado: true,
  puede_habilitar: false,
};

/** Un mes sin nadie en ninguna lista (cada prueba pone lo suyo). */
const SEGUIMIENTO = {
  anio: 2025,
  mes: 9,
  periodo: "Septiembre 2025",
  habilitados: 0,
  totales: { sin_abrir: 0, sin_aceptar: 0, con_observacion: 0, aceptados: 0 },
  sin_abrir: [],
  sin_aceptar: [],
  con_observacion: [],
  aceptados: [],
};

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  servicio.estado.mockResolvedValue(ESTADO);
  servicio.misObservaciones.mockResolvedValue([]);
  servicio.pedirCodigo.mockResolvedValue({
    enviado_a: "r***@grupolaar.com",
    vence_en: 600,
    reenviar_en: 60,
  });
});

async function consultar() {
  render(<RolPagosPage />, { wrapper: MemoryRouter });
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

/** Acepta los términos y pide el código: devuelve el campo del código. */
async function pedirCodigo(ventana) {
  fireEvent.click(within(ventana).getByRole("checkbox"));
  fireEvent.click(
    within(ventana).getByRole("button", { name: "Enviarme el código" }),
  );
  return within(ventana).findByLabelText(/^Código de verificación/);
}

/** Acepta, pide el código y confirma con `123456`. */
async function verConCodigo(ventana) {
  const campo = await pedirCodigo(ventana);
  fireEvent.change(campo, { target: { value: "123456" } });
  fireEvent.click(within(ventana).getByRole("button", { name: "Confirmar" }));
}

/** Un error de la consulta como llega con `responseType: "blob"`. */
function errorEnBlob(status, cuerpo) {
  return {
    response: { status, data: new Blob([JSON.stringify(cuerpo)]) },
  };
}

describe("Consultar rol de pagos", () => {
  it("el código sale de la sesión y ver pide aceptar y el código del correo", async () => {
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
    // Ya no se pide la contraseña (CA-1).
    expect(within(ventana).queryByLabelText(/Contraseña/)).toBeNull();
    expect(ventana.querySelector('input[type="password"]')).toBeNull();
    expect(
      within(ventana).getByText("Paso 1 de 2 · Términos"),
    ).toBeInTheDocument();
    const pedir = within(ventana).getByRole("button", {
      name: "Enviarme el código",
    });
    expect(pedir).toBeDisabled();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.click(pedir);
    await waitFor(() =>
      expect(servicio.pedirCodigo).toHaveBeenCalledWith({
        anio: 2026,
        mes: 9,
        codigo: "20104758", // autocompletado con el de la sesión
        acepto: true,
        version: 3,
      }),
    );
    // El correo enmascarado y cuánto dura.
    const enviado = await within(ventana).findByRole("status");
    expect(enviado).toHaveTextContent(
      /^Le enviamos un código de 6 dígitos a r\*\*\*@grupolaar\.com\. Vence a las \d{2}:\d{2}\.$/,
    );
    expect(
      within(ventana).getByText("Paso 2 de 2 · Código de verificación"),
    ).toBeInTheDocument();
    const campo = within(ventana).getByLabelText(/^Código de verificación/);
    expect(campo).toHaveAttribute("inputmode", "numeric");
    expect(campo).toHaveAttribute("autocomplete", "one-time-code");
    // Sin maxlength: cortaría lo pegado antes de quitar lo que no es dígito.
    expect(campo).not.toHaveAttribute("maxlength");
    expect(campo).toHaveAccessibleDescription(
      expect.stringContaining(
        "Revise también la carpeta de correo no deseado.",
      ),
    );
    expect(campo).toHaveAttribute("aria-required", "true");
    await waitFor(() => expect(campo).toHaveFocus());
    // Solo dígitos; con menos de 6, «Confirmar» dice cuántos lleva.
    const confirmar = within(ventana).getByRole("button", {
      name: "Confirmar",
    });
    fireEvent.change(campo, { target: { value: "12a 34" } });
    expect(campo).toHaveValue("1234");
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);
    expect(
      await within(ventana).findAllByText(
        "Escriba los 6 dígitos del código (lleva 4).",
      ),
    ).toHaveLength(2); // junto al campo y en la región que lo anuncia
    // Pulsar otra vez vacía la región y la vuelve a llenar: se repite el
    // anuncio aunque el texto sea el mismo.
    const anuncio = ventana.querySelector('[aria-live="assertive"]');
    fireEvent.click(confirmar);
    expect(anuncio).toHaveTextContent(/^$/);
    await waitFor(() =>
      expect(anuncio).toHaveTextContent(
        "Escriba los 6 dígitos del código (lleva 4).",
      ),
    );
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(servicio.consultar).not.toHaveBeenCalled();
    fireEvent.change(campo, { target: { value: "123456" } });
    fireEvent.click(confirmar);
    await waitFor(() =>
      expect(servicio.consultar).toHaveBeenCalledWith({
        anio: 2026,
        mes: 9,
        codigo: "20104758",
        acepto: true,
        version: 3,
        codigo_verificacion: "123456",
      }),
    );
    expect(servicio.consultar.mock.calls[0][0]).not.toHaveProperty("password");
    expect(
      await screen.findByRole("dialog", {
        name: "Rol de pagos · Septiembre 2026",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Enviar a mi correo personal/ }),
    ).toBeInTheDocument();
  });

  it("un código equivocado se dice junto al campo y no muestra el rol", async () => {
    servicio.consultar.mockRejectedValue(
      errorEnBlob(400, {
        error: {
          code: "invalid",
          message: "Error en la solicitud.",
          details: { codigo_verificacion: "El código no es correcto." },
        },
      }),
    );
    const ventana = await consultar();
    await verConCodigo(ventana);
    const campo = within(ventana).getByLabelText(/^Código de verificación/);
    // Junto al campo (y repetido en la región que lo anuncia).
    await waitFor(() =>
      expect(
        ventana.querySelector("#rol-codigo-verificacion-error"),
      ).toHaveTextContent("El código no es correcto."),
    );
    expect(campo).toHaveAttribute("aria-invalid", "true");
    expect(campo).toHaveClass("is-invalid");
    expect(campo.getAttribute("aria-describedby")).toContain(
      "rol-codigo-verificacion-error",
    );
    expect(campo).toHaveValue("");
    await waitFor(() => expect(campo).toHaveFocus());
    // Con el foco ya en el campo, se anuncia por una región aria-live.
    const anuncio = ventana.querySelector('[aria-live="assertive"]');
    expect(anuncio).toHaveTextContent("El código no es correcto.");
    // Junto al campo, no en la alerta general.
    expect(within(ventana).queryByRole("alert")).toBeNull();
    expect(
      screen.queryByRole("dialog", { name: "Rol de pagos · Septiembre 2026" }),
    ).toBeNull();
    // Al escribir de nuevo, el error se va.
    fireEvent.change(campo, { target: { value: "6" } });
    expect(campo).not.toHaveAttribute("aria-invalid");
  });

  it("enviar al correo: no se guarda salvo que se pida y se acepte", async () => {
    servicio.consultar.mockResolvedValue({
      blob: new Blob(["%PDF"]),
      consulta: 41,
    });
    servicio.enviar.mockResolvedValue({ enviado_a: "r***@gmail.com" });
    const ventana = await consultar();
    await verConCodigo(ventana);
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

  it("guardar el correo envía la versión del consentimiento; si cambió, lo dice junto a la casilla (US-004)", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, version_correo: 2 });
    servicio.consultar.mockResolvedValue({
      blob: new Blob(["%PDF"]),
      consulta: 41,
    });
    servicio.enviar.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            code: "validation_error",
            message: "Revise los datos.",
            details: {
              acepto_guardar: [
                "El texto cambió mientras lo leía. Léalo de nuevo y acéptelo.",
              ],
            },
          },
        },
      },
    });
    const ventana = await consultar();
    await verConCodigo(ventana);
    fireEvent.change(await screen.findByLabelText("Correo personal"), {
      target: { value: "rosa@gmail.com" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Guardar este correo/ }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Acepto que se almacene/ }),
    );
    const llamadasAntes = servicio.estado.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() =>
      expect(servicio.enviar).toHaveBeenCalledWith(
        expect.objectContaining({ version_correo: 2, acepto_guardar: true }),
      ),
    );
    const casilla = screen.getByRole("checkbox", {
      name: /Acepto que se almacene/,
    });
    await waitFor(() =>
      expect(casilla).toHaveAccessibleDescription(
        "El texto cambió mientras lo leía. Léalo de nuevo y acéptelo.",
      ),
    );
    expect(casilla).not.toBeChecked();
    // Recarga el estado para traer el consentimiento nuevo.
    expect(servicio.estado.mock.calls.length).toBeGreaterThan(llamadasAntes);
  });

  it("si los términos cambiaron mientras los leía, lo dice y recarga el estado (US-004)", async () => {
    servicio.consultar.mockRejectedValue(
      errorEnBlob(400, {
        error: {
          code: "validation_error",
          message: "Revise los datos.",
          details: {
            acepto: [
              "Los términos cambiaron mientras los leía: revíselos y acéptelos de nuevo.",
            ],
          },
        },
      }),
    );
    const ventana = await consultar();
    const llamadasAntes = servicio.estado.mock.calls.length;
    await verConCodigo(ventana);
    expect(
      await within(ventana).findByText(
        /Los términos cambiaron mientras los leía/,
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(servicio.estado.mock.calls.length).toBeGreaterThan(llamadasAntes),
    );
    // Vuelve a los términos, sin aceptar.
    expect(within(ventana).getByRole("checkbox")).not.toBeChecked();
  });

  it("los términos son una región enfocable que describe la casilla (US-004)", async () => {
    const ventana = await consultar();
    const region = within(ventana).getByRole("region", {
      name: "Términos y condiciones",
    });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveTextContent(ESTADO.terminos);
    const casilla = within(ventana).getByRole("checkbox", {
      name: /Acepto los términos/,
    });
    expect(casilla.getAttribute("aria-describedby")).toContain(region.id);
    expect(casilla).toHaveAccessibleDescription(new RegExp(ESTADO.terminos));
  });

  it("mientras guarda la configuración, la ventana no se cierra", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_configurar: true });
    servicio.configuracion.mockResolvedValue({
      aviso_activo: false,
      aviso_titulo: "",
      aviso_mensaje: "",
      aviso_titulo_vencido: "",
      aviso_mensaje_vencido: "",
      aviso_dias_habiles: 3,
    });
    servicio.configurar.mockReturnValue(new Promise(() => {}));
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    fireEvent.click(
      await screen.findByRole("button", { name: /Aviso del primer día hábil/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Aviso del primer día hábil",
    });
    await within(ventana).findByRole("group", {
      name: "Aviso del primer día hábil",
    });
    fireEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));
    expect(
      await within(ventana).findByRole("button", { name: "Guardando…" }),
    ).toBeDisabled();
    expect(
      within(ventana).getByRole("button", { name: "Cancelar" }),
    ).toBeDisabled();
    fireEvent.click(within(ventana).getByRole("button", { name: "Cerrar" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("sin código de empleado lo dice y no deja consultar", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, codigo: "" });
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    expect(
      await screen.findByText(/todavía no tiene código de empleado/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Consultar/ })).toBeDisabled();
  });

  it("Talento Humano lo ve autocompletado, puede cambiarlo y volver al suyo", async () => {
    servicio.estado.mockResolvedValue({
      ...ESTADO,
      puede_consultar_otros: true,
    });
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    const codigo = await screen.findByLabelText("Código de empleado");
    expect(codigo).not.toHaveAttribute("readonly");
    await waitFor(() => expect(codigo).toHaveValue("20104758"));
    fireEvent.change(codigo, { target: { value: "20100001" } });
    expect(screen.getByText(/Consultando a otra persona/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Volver a mi código" }));
    expect(codigo).toHaveValue("20104758");
  });

  it("sin permiso el código es el de su cuenta y no se puede cambiar", async () => {
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    const codigo = await screen.findByLabelText("Código de empleado");
    expect(codigo).toHaveValue("20104758");
    expect(codigo).toHaveAttribute("readonly");
    expect(
      screen.getByText(/Solo su código; prohibido usar el de otra persona/),
    ).toBeInTheDocument();
  });

  it("un mes sin rol cierra la ventana y lo explica en la página", async () => {
    servicio.consultar.mockRejectedValue({
      response: {
        status: 404,
        data: new Blob([
          JSON.stringify({
            detail:
              "No hay rol de pagos de abril de 2026 para el código 20104758.",
          }),
        ]),
      },
    });
    const ventana = await consultar();
    await verConCodigo(ventana);
    expect(
      await screen.findByRole("heading", {
        name: "Sin rol de pagos para septiembre de 2026",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No hay rol de pagos de abril de 2026/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", {
        name: "Confirmar consulta del rol de pagos",
      }),
    ).toBeNull();
    // Sin rol no se ofrece enviarlo al correo.
    expect(
      screen.queryByRole("heading", { name: /Enviar a mi correo/ }),
    ).toBeNull();
  });

  it("en el visor se confirma que está de acuerdo", async () => {
    servicio.consultar.mockResolvedValue({
      blob: new Blob(["%PDF"]),
      consulta: 41,
    });
    servicio.conformidad.mockResolvedValue({
      conformidad: "conforme",
      conformidad_display: "Estuvo de acuerdo",
      dia: "martes",
      fecha: "21/10/2026",
      hora: "10:32:05",
      ip: "192.168.1.20",
    });
    const ventana = await consultar();
    await verConCodigo(ventana);
    const visor = await screen.findByRole("dialog", {
      name: "Rol de pagos · Septiembre 2026",
    });
    fireEvent.click(
      within(visor).getByRole("button", { name: /Estoy de acuerdo/ }),
    );
    await waitFor(() =>
      expect(servicio.conformidad).toHaveBeenCalledWith(41, "conforme", ""),
    );
    expect(
      await within(visor).findByText("Estuvo de acuerdo"),
    ).toBeInTheDocument();
    expect(
      within(visor).getByText(
        /el martes 21\/10\/2026 a las 10:32:05 desde la IP 192.168.1.20/,
      ),
    ).toBeInTheDocument();
    // Ya respondió: cierra sin advertencia.
    fireEvent.click(
      within(visor).getByRole("button", { name: "Cerrar visor" }),
    );
    expect(screen.queryByRole("dialog", { name: /Rol de pagos ·/ })).toBeNull();
  });

  it("cerrar sin responder advierte que es aceptar el rol", async () => {
    servicio.consultar.mockResolvedValue({
      blob: new Blob(["%PDF"]),
      consulta: 42,
    });
    servicio.conformidad.mockResolvedValue({
      conformidad: "conforme_al_cerrar",
      conformidad_display: "Aceptó al cerrar sin responder",
    });
    const ventana = await consultar();
    await verConCodigo(ventana);
    const visor = await screen.findByRole("dialog", {
      name: "Rol de pagos · Septiembre 2026",
    });
    fireEvent.click(
      within(visor).getByRole("button", { name: "Cerrar visor" }),
    );
    const aviso = screen.getByRole("alertdialog", {
      name: /Cerrar sin responder/,
    });
    expect(aviso).toHaveTextContent(/acepta que su rol de pagos es correcto/);
    // La opción por defecto es volver: tiene el foco, y Escape cierra solo el
    // aviso (no el visor) sin registrar nada.
    expect(
      within(aviso).getByRole("button", { name: "Volver al rol" }),
    ).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(visor).toBeInTheDocument();
    fireEvent.click(
      within(visor).getByRole("button", { name: "Cerrar visor" }),
    );
    // Volver no cierra ni registra nada.
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Volver al rol",
      }),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(servicio.conformidad).not.toHaveBeenCalled();
    fireEvent.click(
      within(visor).getByRole("button", { name: "Cerrar visor" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cerrar y aceptar" }));
    await waitFor(() =>
      expect(servicio.conformidad).toHaveBeenCalledWith(
        42,
        "conforme_al_cerrar",
        "",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /Rol de pagos ·/ }),
      ).toBeNull(),
    );
  });

  it("una observación pide texto y se envía", async () => {
    servicio.consultar.mockResolvedValue({
      blob: new Blob(["%PDF"]),
      consulta: 43,
    });
    servicio.conformidad.mockResolvedValue({
      conformidad: "observacion",
      conformidad_display: "Dejó una observación",
    });
    const ventana = await consultar();
    await verConCodigo(ventana);
    const visor = await screen.findByRole("dialog", {
      name: "Rol de pagos · Septiembre 2026",
    });
    fireEvent.click(
      within(visor).getByRole("button", { name: /Tengo una observación/ }),
    );
    const enviar = within(visor).getByRole("button", {
      name: "Enviar observación",
    });
    expect(enviar).toBeDisabled();
    fireEvent.change(within(visor).getByLabelText(/Qué no está correcto/), {
      target: { value: "Faltan horas extra." },
    });
    fireEvent.click(enviar);
    await waitFor(() =>
      expect(servicio.conformidad).toHaveBeenCalledWith(
        43,
        "observacion",
        "Faltan horas extra.",
      ),
    );
  });

  it("si Talento Humano corrigió su rol, se lo dice y lo lleva a confirmar", async () => {
    servicio.estado.mockResolvedValue({
      ...ESTADO,
      por_confirmar: [
        { id: 5, anio: 2026, mes: 8, nota: "Se sumaron las horas extra." },
      ],
    });
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    const aviso = await screen.findByRole("region", {
      name: "Correcciones por confirmar",
    });
    expect(
      within(aviso).getByText(/Se sumaron las horas extra/),
    ).toBeInTheDocument();
    fireEvent.click(
      within(aviso).getByRole("button", { name: "Revisar y confirmar" }),
    );
    expect(
      screen.getByRole("dialog", {
        name: "Confirmar consulta del rol de pagos",
      }),
    ).toHaveTextContent(/Agosto de 2026/);
  });

  it("con permiso, el historial por código muestra consultas, conformidad y observación", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_ver_historial: true });
    servicio.historial.mockResolvedValue({
      codigo: "20100001",
      persona: {
        id: 9,
        nombre: "Juan Diego Almachi",
        correo: "j@grupolaar.com",
      },
      periodos: [
        {
          anio: 2026,
          mes: 9,
          desde: "01/09/2026",
          hasta: "30/09/2026",
          consultas: [
            {
              id: 1,
              por: "Juan Diego Almachi",
              propia: true,
              consultada: {
                dia: "martes",
                fecha: "21/10/2026",
                hora: "10:30:00",
              },
              ip: "10.0.0.5",
              conformidad: "conforme",
              conformidad_display: "Estuvo de acuerdo",
              conformidad_en: {
                dia: "martes",
                fecha: "21/10/2026",
                hora: "10:32:05",
              },
              conformidad_ip: "10.0.0.5",
            },
          ],
          observacion: {
            estado: "cerrada",
            estado_display: "Confirmada",
            mensajes: [
              {
                tipo: "observacion",
                tipo_display: "Observación",
                autor: "Juan Diego Almachi",
                texto: "Faltan horas extra.",
                momento: {
                  dia: "lunes",
                  fecha: "20/10/2026",
                  hora: "09:00:00",
                },
              },
            ],
          },
        },
      ],
    });
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    // La primera acción queda a la vista; el resto, en «Gestión de roles».
    fireEvent.click(
      await screen.findByRole("button", { name: /Gestión de roles/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Historial por empleado/ }),
    );
    const ventana = screen.getByRole("dialog", {
      name: "Historial de roles de pagos",
    });
    fireEvent.change(within(ventana).getByLabelText("Código de empleado"), {
      target: { value: "20100001" },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: /Buscar/ }));
    await waitFor(() =>
      expect(servicio.historial).toHaveBeenCalledWith("20100001"),
    );
    expect(
      await within(ventana).findByText("Estuvo de acuerdo"),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText("martes 21/10/2026 10:32:05"),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText("Faltan horas extra."),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByText(/Observación · Confirmada/),
    ).toBeInTheDocument();
  });

  it("sin permiso no aparece el botón del historial", async () => {
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    await screen.findByLabelText("Código de empleado");
    expect(
      screen.queryByRole("button", { name: /Historial por empleado/ }),
    ).toBeNull();
    // Tampoco el menú donde iría.
    expect(
      screen.queryByRole("button", { name: /Gestión de roles/ }),
    ).toBeNull();
  });

  it("Talento Humano: «Roles sin abrir» a la vista y el resto en un menú", async () => {
    servicio.estado.mockResolvedValue({
      ...ESTADO,
      puede_seguimiento: true,
      puede_descarga_masiva: true,
      puede_habilitar: true,
      puede_ver_historial: true,
      puede_configurar: true,
    });
    servicio.areasDescargaMasiva.mockResolvedValue([]);
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    const principal = await screen.findByRole("button", {
      name: /Roles sin abrir/,
    });
    expect(principal).toHaveClass("btn-outline-primary");
    expect(
      screen.queryByRole("button", { name: /Descarga masiva/ }),
    ).toBeNull();

    const menu = screen.getByRole("button", { name: /Gestión de roles/ });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    const lista = screen.getByRole("list", { name: "Gestión de roles" });
    expect(menu).toHaveAttribute("aria-controls", lista.id);
    expect(
      within(lista)
        .getAllByRole("button")
        .map((b) => b.textContent.trim()),
    ).toEqual([
      "Descarga masiva",
      "Usuarios habilitados",
      "Descargar rol auditado",
      "Historial por empleado",
      "Aviso del primer día hábil",
    ]);

    // Escape la cierra y el foco vuelve al botón.
    within(lista)
      .getByRole("button", { name: /Descarga masiva/ })
      .focus();
    fireEvent.keyDown(document.activeElement, { key: "Escape" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "Gestión de roles" })).toBeNull();
    expect(menu).toHaveFocus();

    // Elegir una opción la cierra y abre su ventana.
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole("button", { name: /Descarga masiva/ }));
    expect(
      await screen.findByRole("dialog", { name: "Descarga masiva" }),
    ).toBeInTheDocument();
    expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  it("quien no está habilitado no ve la consulta y sabe por qué", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, habilitado: false });
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    expect(
      await screen.findByText(/no está habilitada para consultar/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Período a consultar" }),
    ).toBeNull();
  });

  it("muestra sus propias observaciones, en todos sus estados", async () => {
    servicio.misObservaciones.mockResolvedValue([
      {
        id: 4,
        anio: 2026,
        mes: 8,
        estado: "cerrada",
        estado_display: "Cerrada",
        ultima: "Faltan horas.",
        mensajes: [
          {
            id: 1,
            tipo: "observacion",
            tipo_display: "Observación",
            autor: "Rosa",
            texto: "Faltan horas.",
            fecha: "2026-09-02T15:00:00Z",
          },
        ],
      },
    ]);
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    const seccion = await screen.findByRole("region", {
      name: "Mis observaciones",
    });
    expect(within(seccion).getByText("Cerrada")).toBeInTheDocument();
  });

  it("nómina habilita a una persona con su código", async () => {
    servicio.estado.mockResolvedValue({
      ...ESTADO,
      habilitado: false,
      puede_habilitar: true,
    });
    servicio.habilitados.mockResolvedValue([
      {
        id: 9,
        nombre: "Rosa Vera",
        correo: "r@x.com",
        codigo: "",
        habilitado: false,
      },
    ]);
    servicio.habilitar.mockResolvedValue({
      id: 9,
      nombre: "Rosa Vera",
      correo: "r@x.com",
      codigo: "20100001",
      habilitado: true,
    });
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    fireEvent.click(
      await screen.findByRole("button", { name: /Usuarios habilitados/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Usuarios habilitados",
    });
    fireEvent.change(
      await within(ventana).findByLabelText("Código de empleado de Rosa Vera"),
      { target: { value: "20100001" } },
    );
    fireEvent.click(within(ventana).getByLabelText("Habilitar a Rosa Vera"));
    await waitFor(() =>
      expect(servicio.habilitar).toHaveBeenCalledWith({
        usuario: 9,
        habilitado: true,
        codigo: "20100001",
      }),
    );
  });

  it("sin permiso no aparece la descarga masiva", async () => {
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    await screen.findByLabelText("Código de empleado");
    expect(
      screen.queryByRole("button", { name: /Descarga masiva/ }),
    ).not.toBeInTheDocument();
  });

  it("Talento Humano descarga los roles de un área en un ZIP", async () => {
    servicio.estado.mockResolvedValue({
      ...ESTADO,
      puede_descarga_masiva: true,
    });
    servicio.areasDescargaMasiva.mockResolvedValue([
      { id: 3, nombre: "Comercial", nivel: "Área", personas: 3, con_codigo: 2 },
      { id: 4, nombre: "Bodega", nivel: "Área", personas: 1, con_codigo: 0 },
    ]);
    const zip = new Blob(["PK"]);
    servicio.descargaMasiva.mockResolvedValue({
      blob: zip,
      incluidos: 2,
      omitidos: 1,
    });
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    fireEvent.click(
      await screen.findByRole("button", { name: /Descarga masiva/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Descarga masiva",
    });
    // Un área sin nadie con código no se puede elegir.
    expect(
      await within(ventana).findByRole("option", { name: /Bodega/ }),
    ).toBeDisabled();
    fireEvent.change(within(ventana).getByLabelText(/^Área/), {
      target: { value: "3" },
    });
    fireEvent.change(within(ventana).getByLabelText("Año"), {
      target: { value: "2025" },
    });
    fireEvent.change(within(ventana).getByLabelText("Mes"), {
      target: { value: "9" },
    });
    fireEvent.change(
      within(ventana).getByLabelText(/^Confirme su contraseña/),
      {
        target: { value: "clave" },
      },
    );
    fireEvent.click(within(ventana).getByRole("button", { name: /Descargar/ }));
    await waitFor(() =>
      expect(servicio.descargaMasiva).toHaveBeenCalledWith({
        unidad: 3,
        anio: 2025,
        mes: 9,
        password: "clave",
      }),
    );
    expect(descargarBlob).toHaveBeenCalledWith(
      zip,
      "Roles de pago - Comercial - Septiembre 2025.zip",
    );
    expect(await within(ventana).findByRole("status")).toHaveTextContent(
      "2 rol(es) de pagos · 1 sin rol",
    );
  });

  it("sin permiso no aparece «Roles sin abrir»", async () => {
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    await screen.findByLabelText("Código de empleado");
    expect(
      screen.queryByRole("button", { name: /Roles sin abrir/ }),
    ).not.toBeInTheDocument();
  });

  it("Talento Humano ve quién no abrió su rol y cómo contactarlo", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_seguimiento: true });
    servicio.resumenSeguimiento.mockResolvedValue([
      {
        anio: 2025,
        mes: 9,
        habilitados: 4,
        abiertos: 2,
        aceptados: 1,
        con_observacion: 0,
        sin_aceptar: 1,
        sin_abrir: 2,
        pendientes: 3,
      },
    ]);
    servicio.seguimiento.mockResolvedValue({
      ...SEGUIMIENTO,
      sin_abrir: [
        {
          id: 1,
          nombre: "Beto Paz",
          codigo: "200",
          cargo: "Analista",
          area: "Comercial",
          correo: "bpaz@grupolaar.com",
          telefono: "0999999999",
          ultima_apertura: { fecha: "05/08/2025" },
        },
        {
          id: 2,
          nombre: "Carla Ruiz",
          codigo: "300",
          cargo: "",
          area: "",
          correo: "cruiz@grupolaar.com",
          telefono: "",
          ultima_apertura: null,
        },
      ],
      aceptados: [
        {
          id: 3,
          nombre: "Ana Mora",
          codigo: "100",
          cargo: "",
          area: "",
          correo: "amora@grupolaar.com",
          telefono: "",
          abierto: {
            dia: "jueves",
            fecha: "02/10/2025",
            hora: "09:15:00",
            ip: "10.0.0.5",
          },
          veces: 1,
          conformidad: "conforme",
          conformidad_display: "Estuvo de acuerdo",
          conformidad_en: {
            dia: "jueves",
            fecha: "02/10/2025",
            hora: "09:20:00",
            ip: "10.0.0.6",
          },
        },
      ],
      totales: {
        sin_abrir: 2,
        sin_aceptar: 1,
        con_observacion: 0,
        aceptados: 1,
      },
      habilitados: 4,
    });
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    fireEvent.click(
      await screen.findByRole("button", { name: /Roles sin abrir/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Roles sin abrir",
    });
    // El resumen del año, mes por mes.
    const resumen = await within(ventana).findByRole("table", {
      name: /Resumen de/,
    });
    const septiembre = within(resumen)
      .getByRole("button", { name: "Septiembre" })
      .closest("tr");
    expect(
      within(septiembre)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["Septiembre", "4", "2", "1", "0", "1", "2"]);

    expect(await within(ventana).findByText("Beto Paz")).toBeInTheDocument();
    expect(within(ventana).getByText(/3 pendiente\(s\)/)).toBeInTheDocument();
    expect(
      within(ventana).getByText("Analista · Comercial"),
    ).toBeInTheDocument();
    expect(within(ventana).getByText("0999999999")).toBeInTheDocument();
    expect(
      within(ventana).queryByRole("button", {
        name: "Copiar el teléfono de Carla Ruiz",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(ventana).getByText("Nunca ha abierto uno"),
    ).toBeInTheDocument();
    expect(within(ventana).queryByText("Ana Mora")).not.toBeInTheDocument();
    // Sin `roles_pago.historial` no se ve el rol de cada persona.
    expect(
      within(ventana).queryByRole("button", { name: /Ver el rol de/ }),
    ).not.toBeInTheDocument();

    fireEvent.change(within(ventana).getByLabelText("Buscar"), {
      target: { value: "carla" },
    });
    expect(within(ventana).queryByText("Beto Paz")).not.toBeInTheDocument();
    fireEvent.change(within(ventana).getByLabelText("Buscar"), {
      target: { value: "" },
    });

    fireEvent.click(
      within(ventana).getByRole("button", { name: "Aceptados (1)" }),
    );
    expect(within(ventana).getByText("Ana Mora")).toBeInTheDocument();
    expect(
      within(ventana).getByText(
        /Abierto y términos aceptados · jueves 02\/10\/2025 · 09:15 · IP 10\.0\.0\.5/,
      ),
    ).toBeInTheDocument();
  });

  it("exporta los pendientes a Excel y les manda un recordatorio", async () => {
    // El seguimiento abre en el mes anterior: con la fecha fija, la prueba
    // no depende del día en que se corre (octubre de 2026 → septiembre).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 15));
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_seguimiento: true });
    servicio.resumenSeguimiento.mockResolvedValue([]);
    servicio.seguimiento.mockResolvedValue({
      ...SEGUIMIENTO,
      totales: {
        sin_abrir: 2,
        sin_aceptar: 1,
        con_observacion: 0,
        aceptados: 0,
      },
      habilitados: 3,
    });
    const excel = new Blob(["xlsx"]);
    servicio.exportarSeguimiento.mockResolvedValue(excel);
    servicio.recordarPendientes.mockResolvedValue({ enviadas: 3 });
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    fireEvent.click(
      await screen.findByRole("button", { name: /Roles sin abrir/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Roles sin abrir",
    });
    fireEvent.click(
      await within(ventana).findByRole("button", {
        name: /Exportar pendientes \(3\)/,
      }),
    );
    await waitFor(() =>
      expect(descargarBlob).toHaveBeenCalledWith(
        excel,
        "roles-2026-09-pendientes.xlsx",
      ),
    );
    expect(servicio.exportarSeguimiento).toHaveBeenCalledWith(
      2026,
      9,
      "pendientes",
    );

    // El recordatorio pide confirmación antes de salir.
    fireEvent.click(
      within(ventana).getByRole("button", {
        name: /Recordar a los pendientes/,
      }),
    );
    expect(servicio.recordarPendientes).not.toHaveBeenCalled();
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Sí, enviar" }),
    );
    expect(
      await within(ventana).findByText(/Se envió el recordatorio a 3 persona/),
    ).toBeInTheDocument();
    expect(servicio.recordarPendientes).toHaveBeenCalledWith(2026, 9);
  });

  it("con el historial se ve el rol de cada persona para validarlo", async () => {
    // El seguimiento abre en el mes anterior: con la fecha fija, la prueba
    // no depende del día en que se corre (octubre de 2026 → septiembre).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 15));
    servicio.estado.mockResolvedValue({
      ...ESTADO,
      puede_seguimiento: true,
      puede_ver_historial: true,
    });
    servicio.resumenSeguimiento.mockResolvedValue([]);
    servicio.seguimiento.mockResolvedValue({
      ...SEGUIMIENTO,
      sin_abrir: [
        {
          id: 1,
          nombre: "Beto Paz",
          codigo: "200",
          cargo: "",
          area: "",
          correo: "bpaz@grupolaar.com",
          telefono: "",
          ultima_apertura: null,
        },
      ],
      totales: {
        sin_abrir: 1,
        sin_aceptar: 0,
        con_observacion: 0,
        aceptados: 0,
      },
      habilitados: 1,
    });
    servicio.rolDelHistorial.mockResolvedValue(new Blob(["%PDF"]));
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    fireEvent.click(
      await screen.findByRole("button", { name: /Roles sin abrir/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Roles sin abrir",
    });
    fireEvent.click(
      await within(ventana).findByRole("button", {
        name: "Ver el rol de Beto Paz",
      }),
    );
    fireEvent.change(
      within(ventana).getByLabelText(
        "Su contraseña para ver el rol de Beto Paz",
      ),
      { target: { value: "clave" } },
    );
    fireEvent.click(within(ventana).getByRole("button", { name: "Ver" }));
    await waitFor(() =>
      expect(servicio.rolDelHistorial).toHaveBeenCalledWith({
        codigo: "200",
        anio: 2026,
        mes: 9,
        password: "clave",
      }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: /Rol de pagos · Beto Paz · Septiembre 2026/,
      }),
    ).toBeInTheDocument();
  });

  it("cambiar el mes vuelve a pedir la lista", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_seguimiento: true });
    servicio.resumenSeguimiento.mockResolvedValue([]);
    servicio.seguimiento.mockResolvedValue(SEGUIMIENTO);
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    fireEvent.click(
      await screen.findByRole("button", { name: /Roles sin abrir/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Roles sin abrir",
    });
    expect(
      await within(ventana).findByText(
        /Todas las personas habilitadas ya abrieron/,
      ),
    ).toBeInTheDocument();
    fireEvent.change(within(ventana).getByLabelText("Año"), {
      target: { value: "2025" },
    });
    fireEvent.change(within(ventana).getByLabelText("Mes"), {
      target: { value: "3" },
    });
    await waitFor(() =>
      expect(servicio.seguimiento).toHaveBeenLastCalledWith(2025, 3),
    );
    expect(servicio.resumenSeguimiento).toHaveBeenCalledWith(2025);
  });

  it("la persona ve cuándo abrió cada rol y cuándo dio su conformidad", async () => {
    servicio.estado.mockResolvedValue({
      ...ESTADO,
      mis_roles: [
        {
          anio: 2026,
          mes: 9,
          veces: 2,
          abierto: {
            dia: "lunes",
            fecha: "26/10/2026",
            hora: "14:43:10",
            ip: "10.0.2.80",
          },
          conformidad: "conforme",
          conformidad_display: "Estuvo de acuerdo",
          conformidad_en: {
            dia: "lunes",
            fecha: "26/10/2026",
            hora: "14:45:00",
            ip: "10.0.2.80",
          },
        },
        {
          anio: 2026,
          mes: 8,
          veces: 1,
          abierto: {
            dia: "martes",
            fecha: "01/09/2026",
            hora: "08:00:00",
            ip: "10.0.2.81",
          },
          conformidad: "",
          conformidad_display: "",
          conformidad_en: null,
        },
      ],
    });
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    const lista = await screen.findByRole("region", {
      name: "Mis roles abiertos",
    });
    expect(within(lista).getByText("Septiembre 2026")).toBeInTheDocument();
    expect(
      within(lista).getByText(
        /Abierto y términos aceptados · martes 01\/09\/2026 · 08:00 · IP 10\.0\.2\.81/,
      ),
    ).toBeInTheDocument();
    expect(
      within(lista).getByText(/Estuvo de acuerdo · lunes 26\/10\/2026 · 14:45/),
    ).toBeInTheDocument();
    expect(
      within(lista).getByText(/Conformidad pendiente/),
    ).toBeInTheDocument();
  });

  it("Talento Humano descarga el rol auditado de varios meses en un ZIP", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_ver_historial: true });
    servicio.personaAuditada.mockResolvedValue({
      codigo: "100",
      persona: { id: 3, nombre: "Ana Mora", correo: "amora@grupolaar.com" },
      con_movimientos: [
        { anio: 2025, mes: 6 },
        { anio: 2025, mes: 4 },
      ],
    });
    const zip = new Blob(["PK"]);
    servicio.rolAuditado.mockResolvedValue({
      blob: zip,
      incluidos: 2,
      omitidos: 0,
    });
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar rol auditado/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Descargar rol auditado",
    });
    fireEvent.change(within(ventana).getByLabelText("Código de empleado"), {
      target: { value: "100" },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: /Buscar/ }));
    expect(await within(ventana).findByText("Ana Mora")).toBeInTheDocument();
    // Abre en el año del último mes con movimientos y se puede filtrar.
    expect(within(ventana).getByLabelText("Año")).toHaveValue("2025");
    fireEvent.click(
      within(ventana).getByLabelText("Solo meses con movimientos"),
    );
    expect(within(ventana).queryByLabelText("Mayo")).not.toBeInTheDocument();
    fireEvent.click(within(ventana).getByLabelText(/Abril/));
    fireEvent.click(within(ventana).getByLabelText(/Junio/));
    expect(
      within(ventana).getByText(/Abril 2025, Junio 2025/),
    ).toBeInTheDocument();
    fireEvent.change(
      within(ventana).getByLabelText(/^Confirme su contraseña/),
      {
        target: { value: "clave" },
      },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: /Descargar ZIP \(2 PDF\)/ }),
    );
    await waitFor(() =>
      expect(servicio.rolAuditado).toHaveBeenCalledWith({
        codigo: "100",
        periodos: [
          { anio: 2025, mes: 4 },
          { anio: 2025, mes: 6 },
        ],
        password: "clave",
      }),
    );
    expect(descargarBlob).toHaveBeenCalledWith(
      zip,
      "Roles auditados - 100 - 2025-04 a 2025-06.zip",
    );
  });

  it("un solo mes baja como PDF", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_ver_historial: true });
    servicio.personaAuditada.mockResolvedValue({
      codigo: "100",
      persona: null,
      con_movimientos: [{ anio: 2025, mes: 4 }],
    });
    const pdf = new Blob(["%PDF"]);
    servicio.rolAuditado.mockResolvedValue({
      blob: pdf,
      incluidos: 1,
      omitidos: 0,
    });
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    fireEvent.click(
      await screen.findByRole("button", { name: /Descargar rol auditado/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Descargar rol auditado",
    });
    fireEvent.change(within(ventana).getByLabelText("Código de empleado"), {
      target: { value: "100" },
    });
    fireEvent.click(within(ventana).getByRole("button", { name: /Buscar/ }));
    fireEvent.click(await within(ventana).findByLabelText(/Abril/));
    fireEvent.change(
      within(ventana).getByLabelText(/^Confirme su contraseña/),
      {
        target: { value: "clave" },
      },
    );
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Descargar PDF" }),
    );
    await waitFor(() =>
      expect(descargarBlob).toHaveBeenCalledWith(
        pdf,
        "Rol auditado - 100 - 2025-04 Abril.pdf",
      ),
    );
  });

  it("si ya aceptó ese mes, ve la aceptación y no se le vuelve a preguntar", async () => {
    servicio.consultar.mockResolvedValue({
      blob: new Blob(["%PDF"]),
      consulta: 50,
      aceptado: {
        conformidad: "conforme",
        conformidad_display: "Estuvo de acuerdo",
        dia: "lunes",
        fecha: "05/10/2026",
        hora: "09:10:00",
        ip: "10.0.2.80",
      },
    });
    const ventana = await consultar();
    await verConCodigo(ventana);
    const visor = await screen.findByRole("dialog", {
      name: "Rol de pagos · Septiembre 2026",
    });
    expect(within(visor).getByText("Estuvo de acuerdo")).toBeInTheDocument();
    expect(
      within(visor).getByText(/La aceptación es definitiva/),
    ).toBeInTheDocument();
    expect(
      within(visor).queryByRole("button", { name: /Estoy de acuerdo/ }),
    ).not.toBeInTheDocument();
    expect(
      within(visor).queryByRole("button", { name: /Tengo una observación/ }),
    ).not.toBeInTheDocument();
  });
});

/*
 * Cargando y error con «Reintentar» (auditoría UX/UI, fase 2, 28/10/2026):
 * antes la página quedaba en blanco mientras cargaba y un fallo en «Mis
 * observaciones» se veía como si no tuviera ninguna.
 */
describe("Rol de pagos: cargando y error", () => {
  it("muestra «Cargando…» mientras llega el estado", async () => {
    servicio.estado.mockReturnValue(new Promise(() => {}));
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    expect(screen.getByRole("status")).toHaveTextContent("Cargando…");
  });

  it("si el estado falla, lo dice y «Reintentar» vuelve a pedirlo", async () => {
    servicio.estado.mockRejectedValueOnce({
      response: { data: { error: { message: "Servicio no disponible." } } },
    });
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Servicio no disponible.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Código de empleado")).toHaveValue(
      "20104758",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(servicio.estado).toHaveBeenCalledTimes(2);
  });

  it("si sus observaciones no cargan, lo dice en vez de ocultarlas", async () => {
    servicio.misObservaciones.mockRejectedValue({});
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudieron cargar sus observaciones.",
    );
  });

  it("la lista de habilitados muestra el error en la tabla con «Reintentar»", async () => {
    servicio.estado.mockResolvedValue({
      ...ESTADO,
      habilitado: false,
      puede_habilitar: true,
    });
    servicio.habilitados.mockRejectedValueOnce({}).mockResolvedValue([
      {
        id: 9,
        nombre: "Rosa Vera",
        correo: "r@x.com",
        codigo: "",
        habilitado: false,
      },
    ]);
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    fireEvent.click(
      await screen.findByRole("button", { name: /Usuarios habilitados/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Usuarios habilitados",
    });
    const tabla = within(ventana).getByRole("table");
    expect(within(tabla).getByRole("status")).toHaveTextContent("Cargando…");
    expect(await within(tabla).findByRole("alert")).toHaveTextContent(
      "No se pudo cargar la lista.",
    );
    fireEvent.click(within(tabla).getByRole("button", { name: "Reintentar" }));
    expect(await within(tabla).findByText("Rosa Vera")).toBeInTheDocument();
  });
});

describe("El aviso del rol de pagos (29/10/2026)", () => {
  it("llegar con ?anio&mes elige el período, también con la página ya abierta", async () => {
    const { Route, Routes, useNavigate } = await import("react-router-dom");
    function IrAlRol() {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={() =>
            navigate("/admin/institucional/rol-pagos?anio=2025&mes=3")
          }
        >
          Ir desde el aviso
        </button>
      );
    }
    render(
      <MemoryRouter
        initialEntries={["/admin/institucional/rol-pagos?anio=2025&mes=7"]}
      >
        <IrAlRol />
        <Routes>
          <Route
            path="/admin/institucional/rol-pagos"
            element={<RolPagosPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByLabelText("Código de empleado");
    expect(screen.getByLabelText("Año")).toHaveValue("2025");
    expect(screen.getByLabelText("Mes")).toHaveValue("7");

    fireEvent.click(screen.getByRole("button", { name: "Ir desde el aviso" }));
    await waitFor(() => expect(screen.getByLabelText("Mes")).toHaveValue("3"));
    expect(screen.getByLabelText("Año")).toHaveValue("2025");
  });

  it("«Aviso del primer día hábil» administra el aviso; los términos se editan en Protección de datos", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_configurar: true });
    servicio.configuracion.mockResolvedValue({
      terminos: ESTADO.terminos,
      version: 3,
      consentimiento_correo: ESTADO.consentimiento_correo,
      aviso_activo: true,
      aviso_titulo: "Su rol de pagos ya está disponible",
      aviso_mensaje: "Revise su rol de {mes} de {anio}.",
      aviso_titulo_vencido: "Plazo vencido",
      aviso_mensaje_vencido: "Superó los {dias} días hábiles.",
      aviso_dias_habiles: 3,
    });
    servicio.configurar.mockResolvedValue({});
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    // Con solo ese permiso, «Aviso del primer día hábil» está a la vista.
    fireEvent.click(
      await screen.findByRole("button", { name: /Aviso del primer día hábil/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Aviso del primer día hábil",
    });
    const seccion = await within(ventana).findByRole("group", {
      name: "Aviso del primer día hábil",
    });
    // Los términos y el consentimiento del correo ya no se editan aquí
    // (US-004, CA-7): un enlace lleva a su texto en Protección de datos.
    expect(
      within(ventana).queryByLabelText(/Términos que se aceptan/),
    ).toBeNull();
    expect(
      within(ventana).queryByLabelText(/Consentimiento para guardar/),
    ).toBeNull();
    expect(
      within(ventana).getByRole("link", { name: "Términos de la consulta" }),
    ).toHaveAttribute(
      "href",
      "/admin/privacidad/textos?texto=rol_pagos_terminos",
    );
    expect(
      within(ventana).getByRole("link", {
        name: "Consentimiento del correo personal",
      }),
    ).toHaveAttribute(
      "href",
      "/admin/privacidad/textos?texto=rol_pagos_correo",
    );
    expect(
      within(seccion).getByRole("switch", { name: /Aviso encendido/ }),
    ).toBeChecked();
    expect(
      within(seccion).getAllByText(/\{mes\}.*\{anio\}.*\{dias\}/).length,
    ).toBeGreaterThan(0);

    fireEvent.change(
      within(seccion).getByLabelText(/^Días hábiles permitidos/),
      { target: { value: "5" } },
    );
    fireEvent.change(within(seccion).getByLabelText(/^Mensaje con el plazo/), {
      target: { value: "Pasaron {dias} días: puede ser sancionado." },
    });
    // La vista previa reemplaza los marcadores.
    expect(seccion).toHaveTextContent("Pasaron 5 días: puede ser sancionado.");
    fireEvent.click(within(ventana).getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(servicio.configurar).toHaveBeenCalledWith({
        aviso_activo: true,
        aviso_titulo: "Su rol de pagos ya está disponible",
        aviso_mensaje: "Revise su rol de {mes} de {anio}.",
        aviso_titulo_vencido: "Plazo vencido",
        aviso_mensaje_vencido: "Pasaron {dias} días: puede ser sancionado.",
        aviso_dias_habiles: 5,
      }),
    );
  });

  it("sin el aviso cargado, «Guardar» queda deshabilitado", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_configurar: true });
    servicio.configuracion.mockReturnValue(new Promise(() => {}));
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    fireEvent.click(
      await screen.findByRole("button", { name: /Aviso del primer día hábil/ }),
    );
    const ventana = await screen.findByRole("dialog", {
      name: "Aviso del primer día hábil",
    });
    expect(
      within(ventana).getByRole("button", { name: "Guardar" }),
    ).toBeDisabled();
  });

  it("el error del servidor sale bajo su campo del aviso", async () => {
    servicio.estado.mockResolvedValue({ ...ESTADO, puede_configurar: true });
    servicio.configuracion.mockResolvedValue({
      aviso_activo: true,
      aviso_titulo: "",
      aviso_mensaje: "",
      aviso_titulo_vencido: "Plazo vencido",
      aviso_mensaje_vencido: "",
      aviso_dias_habiles: 3,
    });
    servicio.configurar.mockRejectedValue({
      response: {
        data: {
          error: {
            details: {
              aviso_titulo: ["Con el aviso encendido, escriba el título."],
            },
          },
        },
      },
    });
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    // Con solo ese permiso, «Aviso del primer día hábil» está a la vista.
    fireEvent.click(
      await screen.findByRole("button", { name: /Aviso del primer día hábil/ }),
    );
    const titulo = await screen.findByLabelText(/^Título del aviso/);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Con el aviso encendido, escriba el título.");
    expect(titulo).toHaveAttribute("aria-invalid", "true");
  });
});

/*
 * El código por correo (US-002, 11/11/2026): vencido o agotado, reenviar con
 * espera, límites (429), correo que no sale (503), cuenta sin correo y
 * cambiar el período.
 */
describe("Rol de pagos: código por correo", () => {
  it("un código vencido limpia el campo y deja pedir otro", async () => {
    servicio.consultar.mockRejectedValue(
      errorEnBlob(400, {
        error: {
          code: "invalid",
          message: "Error en la solicitud.",
          // Los de formato llegan como lista: se leen igual.
          details: {
            codigo_verificacion: ["El código venció: pida uno nuevo."],
          },
        },
      }),
    );
    const ventana = await consultar();
    await verConCodigo(ventana);
    await waitFor(() =>
      expect(
        ventana.querySelector("#rol-codigo-verificacion-error"),
      ).toHaveTextContent("El código venció: pida uno nuevo."),
    );
    expect(
      within(ventana).getByLabelText(/^Código de verificación/),
    ).toHaveValue("");
    expect(
      within(ventana).getByRole("button", { name: /Enviar otro código/ }),
    ).toBeInTheDocument();
  });

  it("reenviar espera 60 s con cuenta regresiva y pide un código nuevo", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ventana = await consultar();
    await pedirCodigo(ventana);
    // El botón tiene un nombre fijo; la espera va en un texto a su lado.
    const reenviar = within(ventana).getByRole("button", {
      name: "Enviar otro código",
    });
    expect(reenviar).toBeDisabled();
    expect(
      within(ventana).getByText("Podrá pedir otro código en 1 minuto."),
    ).not.toHaveAttribute("aria-live");
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(
      within(ventana).getByText(/^Podrá pedir otro código en 4\d segundos\.$/),
    ).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(50_000);
    });
    expect(reenviar).toBeEnabled();
    // Ningún aviso de espera queda al terminar.
    expect(within(ventana).queryByText(/Podrá pedir otro/)).toBeNull();
    // El aviso para el lector de pantalla cambia solo al terminar.
    expect(
      within(ventana).getByText("Ya puede pedir otro código."),
    ).toHaveAttribute("aria-live", "polite");
    fireEvent.click(reenviar);
    expect(
      await within(ventana).findByText(/Le enviamos un código nuevo/),
    ).toBeInTheDocument();
    expect(servicio.pedirCodigo).toHaveBeenCalledTimes(2);
  });

  it("con el límite de envíos (429) muestra la espera y bloquea el reenvío", async () => {
    servicio.pedirCodigo.mockRejectedValue({
      response: {
        status: 429,
        headers: { "retry-after": "1200" },
        data: {
          error: {
            code: "throttled",
            message:
              "Ya pidió 5 códigos en la última hora. Podrá pedir otro en 20 minutos.",
            details: { retry_after: 1200 },
          },
        },
      },
    });
    const ventana = await consultar();
    await pedirCodigo(ventana);
    const alerta = within(ventana).getByRole("alert");
    expect(alerta).toHaveTextContent(
      "Ya pidió 5 códigos en la última hora. Podrá pedir otro en 20 minutos.",
    );
    expect(alerta).toHaveClass("mz-alert--bad");
    await waitFor(() => expect(alerta).toHaveFocus());
    expect(
      within(ventana).getByRole("button", { name: "Enviar otro código" }),
    ).toBeDisabled();
    expect(
      within(ventana).getByText("Podrá pedir otro código en 20 minutos."),
    ).toBeInTheDocument();
  });

  it("al terminar la espera del límite, su aviso se quita", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    servicio.pedirCodigo.mockRejectedValue({
      response: {
        status: 429,
        headers: { "retry-after": "90" },
        data: {
          error: {
            code: "throttled",
            message:
              "Ya pidió 5 códigos en la última hora. Podrá pedir otro en 2 minutos.",
            details: { retry_after: 90 },
          },
        },
      },
    });
    const ventana = await consultar();
    await pedirCodigo(ventana);
    expect(within(ventana).getByRole("alert")).toBeInTheDocument();
    expect(
      within(ventana).getByText("Podrá pedir otro código en 2 minutos."),
    ).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(91_000);
    });
    expect(within(ventana).queryByRole("alert")).toBeNull();
    expect(within(ventana).queryByText(/Podrá pedir otro/)).toBeNull();
    expect(
      within(ventana).getByRole("button", { name: "Enviar otro código" }),
    ).toBeEnabled();
  });

  it("si el correo no sale (503), lo dice en la alerta general", async () => {
    servicio.pedirCodigo.mockRejectedValue({
      response: {
        status: 503,
        data: {
          error: {
            code: "codigo_no_enviado",
            message:
              "No pudimos enviar el código a su correo. Intente de nuevo en unos minutos.",
          },
        },
      },
    });
    const ventana = await consultar();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviarme el código" }),
    );
    const alerta = await within(ventana).findByRole("alert");
    expect(alerta).toHaveTextContent(
      "No pudimos enviar el código a su correo. Intente de nuevo en unos minutos.",
    );
    expect(alerta).toHaveClass("mz-alert--bad");
    await waitFor(() => expect(alerta).toHaveFocus());
    // Sigue en el primer paso: puede volver a intentarlo.
    expect(
      within(ventana).queryByLabelText(/^Código de verificación/),
    ).toBeNull();
    expect(
      within(ventana).getByRole("button", { name: "Enviarme el código" }),
    ).toBeEnabled();
  });

  it("sin correo en la cuenta lo dice en la alerta general, sin el campo", async () => {
    servicio.pedirCodigo.mockRejectedValue({
      response: {
        status: 400,
        data: {
          error: {
            code: "invalid",
            message: "Error en la solicitud.",
            details: {
              codigo_verificacion: [
                "Su cuenta no tiene un correo registrado: pídale a Talento Humano que lo registre.",
              ],
            },
          },
        },
      },
    });
    const ventana = await consultar();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.click(
      within(ventana).getByRole("button", { name: "Enviarme el código" }),
    );
    const alerta = await within(ventana).findByRole("alert");
    expect(alerta).toHaveTextContent(
      /^Su cuenta no tiene un correo registrado: pídale a Talento Humano que lo registre\.$/,
    );
    expect(
      within(ventana).queryByLabelText(/^Código de verificación/),
    ).toBeNull();
  });

  it("«Cambiar el período» vuelve a elegirlo y pide un código nuevo", async () => {
    const ventana = await consultar();
    await pedirCodigo(ventana);
    fireEvent.click(
      within(ventana).getByRole("button", {
        name: "Cambiar el período (pedirá otro código)",
      }),
    );
    expect(
      screen.queryByRole("dialog", {
        name: "Confirmar consulta del rol de pagos",
      }),
    ).toBeNull();
    await waitFor(() => expect(screen.getByLabelText("Año")).toHaveFocus());
    fireEvent.change(screen.getByLabelText("Mes"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: /Consultar/ }));
    const otra = screen.getByRole("dialog", {
      name: "Confirmar consulta del rol de pagos",
    });
    // De vuelta al primer paso: términos sin aceptar y sin el campo.
    expect(otra).toHaveTextContent(/Agosto de 2026/);
    expect(within(otra).getByRole("checkbox")).not.toBeChecked();
    expect(within(otra).queryByLabelText(/^Código de verificación/)).toBeNull();
    await pedirCodigo(otra);
    expect(servicio.pedirCodigo).toHaveBeenLastCalledWith(
      expect.objectContaining({ anio: 2026, mes: 8 }),
    );
  });
  it("pegar «Código: 123 456» deja solo los 6 dígitos", async () => {
    const ventana = await consultar();
    const campo = await pedirCodigo(ventana);
    fireEvent.paste(campo, {
      clipboardData: { getData: () => "Código: 123 456 (vence pronto 7)" },
    });
    expect(campo).toHaveValue("123456");
    expect(
      within(ventana).getByRole("button", { name: "Confirmar" }),
    ).toBeEnabled();
  });

  it("la espera corta entre envíos (429) no es un error: se dice junto al reenvío", async () => {
    servicio.pedirCodigo.mockRejectedValue({
      response: {
        status: 429,
        data: {
          error: {
            code: "throttled",
            message: "Espere 40 segundos para pedir otro código.",
            details: { retry_after: 40 },
          },
        },
      },
    });
    const ventana = await consultar();
    await pedirCodigo(ventana);
    // Sin aviso arriba: solo el texto junto a «Enviar otro código».
    expect(within(ventana).queryByRole("alert")).toBeNull();
    expect(
      within(ventana).getByText("Podrá pedir otro código en 40 segundos."),
    ).toBeInTheDocument();
    const campo = within(ventana).getByLabelText(/^Código de verificación/);
    await waitFor(() => expect(campo).toHaveFocus());
    // El paso se lee con el campo.
    expect(campo).toHaveAccessibleDescription(
      expect.stringContaining("Paso 2 de 2 · Código de verificación"),
    );
    expect(
      within(ventana).getByText(
        /Si ya le llegó un código pedido para septiembre de 2026, escríbalo aquí\. Un código pedido para otro período no sirve\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(ventana).getByRole("button", { name: "Enviar otro código" }),
    ).toBeDisabled();
  });

  it("un error general al confirmar lleva el foco a la alerta", async () => {
    servicio.consultar.mockRejectedValue(
      errorEnBlob(403, {
        error: { code: "permission_denied", message: "No puede ver ese rol." },
      }),
    );
    const ventana = await consultar();
    await verConCodigo(ventana);
    const alerta = await within(ventana).findByRole("alert");
    expect(alerta).toHaveTextContent("No puede ver ese rol.");
    await waitFor(() => expect(alerta).toHaveFocus());
  });

  it("marcar los términos y cancelar cierra sin preguntar", async () => {
    const ventana = await consultar();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    fireEvent.click(within(ventana).getByRole("button", { name: "Cancelar" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Confirmar consulta del rol de pagos",
        }),
      ).toBeNull(),
    );
  });

  it("la página explica que se confirma con el código, no con la contraseña", async () => {
    render(<RolPagosPage />, { wrapper: MemoryRouter });
    expect(
      await screen.findByText(
        /escriba el código de 6 dígitos que le enviaremos/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/contraseña de su cuenta/)).toBeNull();
  });
  it("el código queda fijo a su período: si la página cambia, cierra la ventana", async () => {
    servicio.consultar.mockResolvedValue({
      blob: new Blob(["%PDF"]),
      consulta: 41,
    });
    const ventana = await consultar();
    await pedirCodigo(ventana);
    expect(servicio.pedirCodigo).toHaveBeenLastCalledWith(
      expect.objectContaining({ anio: 2026, mes: 9 }),
    );
    // El período de la página cambia detrás de la ventana (p. ej. un aviso).
    fireEvent.change(screen.getByLabelText("Mes"), { target: { value: "8" } });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Confirmar consulta del rol de pagos",
        }),
      ).toBeNull(),
    );
    expect(servicio.consultar).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Cambió el período: pida un código nuevo para consultarlo.",
      ),
    ).toBeInTheDocument();
  });
  it("el 429 genérico (solo cabecera) se queda en los términos con la espera", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    servicio.pedirCodigo.mockRejectedValue({
      response: {
        status: 429,
        headers: { "retry-after": "30" },
        data: {
          error: {
            code: "throttled",
            message: "Demasiadas solicitudes seguidas. Espere un momento.",
            details: null,
          },
        },
      },
    });
    const ventana = await consultar();
    fireEvent.click(within(ventana).getByRole("checkbox"));
    const pedir = within(ventana).getByRole("button", {
      name: "Enviarme el código",
    });
    fireEvent.click(pedir);
    const alerta = await within(ventana).findByRole("alert");
    expect(alerta).toHaveTextContent(
      "Demasiadas solicitudes seguidas. Espere un momento.",
    );
    await waitFor(() => expect(alerta).toHaveFocus());
    // Sin paso al código ni «Si ya le llegó un código…».
    expect(
      within(ventana).getByText("Paso 1 de 2 · Términos"),
    ).toBeInTheDocument();
    expect(
      within(ventana).queryByLabelText(/^Código de verificación/),
    ).toBeNull();
    expect(within(ventana).queryByText(/Si ya le llegó un código/)).toBeNull();
    expect(pedir).toBeDisabled();
    expect(
      within(ventana).getByText("Podrá pedir otro código en 30 segundos."),
    ).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    expect(pedir).toBeEnabled();
    expect(within(ventana).queryByText(/Podrá pedir otro/)).toBeNull();
  });

  it("el 429 propio del código (con retry_after) pasa al campo del código", async () => {
    servicio.pedirCodigo.mockRejectedValue({
      response: {
        status: 429,
        headers: { "retry-after": "30" },
        data: {
          error: {
            code: "throttled",
            message: "Espere 30 segundos para pedir otro código.",
            details: { retry_after: 30 },
          },
        },
      },
    });
    const ventana = await consultar();
    const campo = await pedirCodigo(ventana);
    expect(campo).toBeInTheDocument();
    expect(
      within(ventana).getByText(/Si ya le llegó un código pedido para/),
    ).toBeInTheDocument();
    expect(within(ventana).queryByRole("alert")).toBeNull();
  });
});
