import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Registro de descargas (26/10/2026): toda descarga pasa por `descargarBlob`,
 * que guarda el archivo y lo manda al registro; Auditoría → «Descargas de
 * archivos» muestra quién, qué, cuándo, la IP y la copia.
 */

const post = vi.fn(() => Promise.resolve({ data: { id: 1 } }));
vi.mock("../src/api/client", () => ({ apiClient: { post } }));

const servicio = {
  listar: vi.fn(),
  modulos: vi.fn(),
  copia: vi.fn(),
  exportar: vi.fn(),
};
vi.mock("../src/api/descargasService", () => ({ descargasService: servicio }));
vi.mock("../src/api/nominaService", () => ({
  nominaService: { rolDelHistorial: vi.fn() },
}));
let permisos = [];
vi.mock("../src/hooks/usePermission", () => ({
  usePermission: (codigo) => permisos.includes(codigo),
}));

const { descargarBlob } = await import("../src/utils/descargas");
const { registrarDescarga } = await import("../src/utils/registroDescargas");
// El de verdad (la configuración de las pruebas lo reemplaza en todas).
const real = await vi.importActual("../src/utils/registroDescargas");
const { RegistroDescargas } =
  await import("../src/pages/Admin/Auditoria/RegistroDescargas");

beforeEach(() => {
  vi.clearAllMocks();
  permisos = [];
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

describe("descargarBlob", () => {
  it("guarda el archivo y lo registra", () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    descargarBlob(blob, "acta.pdf");
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(registrarDescarga).toHaveBeenCalledWith(blob, "acta.pdf");
  });
});

describe("registrarDescarga", () => {
  it("manda el archivo, su nombre, su tipo y la pantalla", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    await real.registrarDescarga(blob, "acta.pdf");
    const [ruta, datos] = post.mock.calls[0];
    expect(ruta).toBe("/descargas/");
    expect(datos.get("nombre")).toBe("acta.pdf");
    expect(datos.get("tipo")).toBe("application/pdf");
    expect(datos.get("pantalla")).toBe(window.location.pathname);
    expect(datos.get("archivo")).toBeInstanceOf(Blob);
  });

  it("si el registro falla, no rompe nada", async () => {
    post.mockRejectedValueOnce(new Error("sin red"));
    await expect(
      real.registrarDescarga(new Blob(["x"]), "x.txt"),
    ).resolves.toBeUndefined();
  });
});

const FILA = {
  id: 7,
  momento: { fecha: "26/10/2026", hora: "15:02:11" },
  usuario: { id: 3, nombre: "Ana Mora", correo: "amora@grupolaar.com" },
  nombre: "acta-12.pdf",
  tamano: 2048,
  modulo: "Gestión de Activos",
  ip: "10.0.2.80",
  verificada: true,
  tiene_copia: true,
  sin_copia: "",
  referencia: {},
  pantalla: "/admin/activos/3",
  origen: "/api/v1/activos/3/acta/",
  navegador: "Chrome",
  sha256: "abc123",
};

function pintar() {
  return render(
    <MemoryRouter>
      <RegistroDescargas />
    </MemoryRouter>,
  );
}

describe("Auditoría → Descargas de archivos", () => {
  it("muestra quién, qué, cuándo, la IP y baja la copia", async () => {
    servicio.modulos.mockResolvedValue(["Gestión de Activos"]);
    servicio.listar.mockResolvedValue({ count: 1, results: [FILA] });
    const copia = new Blob(["copia"]);
    servicio.copia.mockResolvedValue(copia);
    pintar();

    const fila = (await screen.findByText("Ana Mora")).closest("tr");
    expect(within(fila).getByText("26/10/2026")).toBeInTheDocument();
    expect(within(fila).getByText("15:02:11")).toBeInTheDocument();
    expect(within(fila).getByText("10.0.2.80")).toBeInTheDocument();
    expect(within(fila).getByText("acta-12.pdf")).toBeInTheDocument();
    expect(within(fila).getByText(/Comprobado/)).toBeInTheDocument();

    fireEvent.click(within(fila).getByRole("button", { name: "Detalle" }));
    expect(within(fila).getByText("abc123")).toBeInTheDocument();

    fireEvent.click(
      within(fila).getByRole("button", {
        name: "Descargar la copia de acta-12.pdf",
      }),
    );
    await waitFor(() => expect(servicio.copia).toHaveBeenCalledWith(7));
  });

  it("filtra por persona y fechas", async () => {
    servicio.modulos.mockResolvedValue([]);
    servicio.listar.mockResolvedValue({ count: 0, results: [] });
    pintar();
    expect(
      await screen.findByText("Sin descargas para esos filtros"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Persona, archivo o IP"), {
      target: { value: "ana" },
    });
    fireEvent.change(screen.getByLabelText("Desde"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Filtrar/ }));
    await waitFor(() =>
      expect(servicio.listar).toHaveBeenLastCalledWith({
        page: 1,
        q: "ana",
        desde: "2026-10-01",
      }),
    );
  });

  it("el rol de pagos no tiene copia y se vuelve a generar con el permiso", async () => {
    permisos = ["roles_pago.historial"];
    servicio.modulos.mockResolvedValue([]);
    servicio.listar.mockResolvedValue({
      count: 1,
      results: [
        {
          ...FILA,
          nombre: "rol-de-pagos-2026-09.pdf",
          tiene_copia: false,
          sin_copia:
            "Rol de pagos: no se guarda; se vuelve a generar desde nómina",
          referencia: { tipo: "rol_pagos", anio: 2026, mes: 9, codigo: "100" },
        },
      ],
    });
    pintar();
    expect(
      await screen.findByText(/Rol de pagos de Septiembre 2026 · código 100/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Descargar la copia/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Volver a generar/ }),
    ).toBeInTheDocument();
  });
});
