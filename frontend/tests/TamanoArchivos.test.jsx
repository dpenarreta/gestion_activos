import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * El peso de un archivo en los mensajes de tamaño, igual que el servidor
 * (US-007, CA-2): dos decimales fijos, coma decimal y redondeado hacia arriba;
 * el máximo, entero si es exacto. Las comprobaciones previas de Mejora
 * continua y de la base de conocimiento de Nova lo usan antes de enviar.
 */

const servicio = {
  documentos: vi.fn(),
  subirDocumento: vi.fn(),
  eliminarDocumento: vi.fn(),
  archivoDocumento: vi.fn(),
  ajustes: vi.fn(),
  cambiarAjustes: vi.fn(),
};
vi.mock("../src/api/novaService", async (importOriginal) => ({
  ...(await importOriginal()),
  novaService: servicio,
}));
vi.mock("../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, permissions: ["nova.conocimiento_gestionar"] },
  }),
}));

const { formatearMegabytes, formatearMaximoMegabytes } =
  await import("../src/utils/formato");
const { problemaDelAdjunto, tamano } =
  await import("../src/pages/GestionHumana/MejoraContinua/mejoraComunes");
const { ConocimientoPage } =
  await import("../src/pages/GestionHumana/Nova/ConocimientoPage");

const MB = 1024 * 1024;

function archivo(nombre, bytes) {
  const f = new File(["x"], nombre, { type: "application/pdf" });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

beforeEach(() => vi.clearAllMocks());

describe("formatearMegabytes", () => {
  it("dos decimales fijos, coma decimal y redondeado hacia arriba", () => {
    expect(formatearMegabytes(5_284_823)).toBe("5,04 MB");
    expect(formatearMegabytes(5 * MB + 1)).toBe("5,01 MB");
    expect(formatearMegabytes(5 * MB)).toBe("5,00 MB");
    expect(formatearMegabytes(5_347_737)).toBe("5,10 MB");
    expect(formatearMegabytes(1_258_291)).toBe("1,20 MB");
    expect(formatearMegabytes(0)).toBe("0,00 MB");
  });

  it("el máximo va entero si es exacto", () => {
    expect(formatearMaximoMegabytes(5 * MB)).toBe("5 MB");
    expect(formatearMaximoMegabytes(5.5 * MB)).toBe("5,50 MB");
  });
});

describe("Comprobaciones previas antes de enviar", () => {
  it("las listas de Mejora continua escriben el peso con coma decimal", () => {
    expect(tamano(1.5 * MB)).toBe("1,5 MB");
    expect(tamano(8 * MB)).toBe("8 MB");
  });

  it("Mejora continua: apenas sobre el máximo no se lee como el máximo", () => {
    expect(problemaDelAdjunto(archivo("a.pdf", 8 * MB + 1))).toBe(
      "El archivo pesa 8,01 MB: el máximo es 8 MB.",
    );
  });

  it("Nova: un PDF de 10,01 MB no dice «10.0 MB»", async () => {
    servicio.documentos.mockResolvedValue({
      resultados: [],
      gestionar: true,
      solo_fuentes: true,
    });
    render(<ConocimientoPage />);
    const campo = await screen.findByLabelText("Documento PDF");
    fireEvent.change(campo, {
      target: { files: [archivo("manual.pdf", 10 * MB + 1)] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Subir/ }));
    expect(
      await screen.findByText("El archivo pesa 10,01 MB y el máximo es 10 MB."),
    ).toBeInTheDocument();
    expect(servicio.subirDocumento).not.toHaveBeenCalled();
  });
});
