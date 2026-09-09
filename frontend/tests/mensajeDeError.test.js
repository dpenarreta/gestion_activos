import { describe, expect, it } from "vitest";

import { mensajeDeError } from "../src/utils/errores";

const respuesta = (data) => ({ response: { data } });

describe("Mensaje de error de la API", () => {
  it("muestra el detalle del campo y no el genérico que lo envuelve", () => {
    /* Era el defecto: un nombre duplicado mostraba «Error en la solicitud.» y
       escondía la única frase que decía qué corregir y con quién chocaba. */
    const mensaje = mensajeDeError(
      respuesta({
        error: {
          code: "validation_error",
          message: "Error en la solicitud.",
          details: {
            nombre: ["Ya existe un tipo llamado «Laptop» (código LAP)."],
          },
        },
      }),
    );

    expect(mensaje).toBe(
      "nombre: Ya existe un tipo llamado «Laptop» (código LAP).",
    );
  });

  it("junta los detalles de varios campos", () => {
    const mensaje = mensajeDeError(
      respuesta({
        error: {
          message: "Error en la solicitud.",
          details: {
            nombre: ["Ya existe un área llamada «Finanzas» (código FIN)."],
            codigo: ["El código «FIN» ya lo usa el área «Finanzas»."],
          },
        },
      }),
    );

    expect(mensaje).toContain("Finanzas");
    expect(mensaje).toContain("·");
  });

  it("usa el mensaje de negocio cuando no hay detalle por campo", () => {
    /* Los errores de negocio —cerrar una sede con equipos dentro— traen la
       explicación completa en `message` y ningún detalle. */
    const mensaje = mensajeDeError(
      respuesta({
        error: {
          code: "sede_con_activos",
          message:
            "No se puede cerrar «Matriz Quito»: todavía hay 3 activo(s) ahí.",
        },
      }),
    );

    expect(mensaje).toBe(
      "No se puede cerrar «Matriz Quito»: todavía hay 3 activo(s) ahí.",
    );
  });

  it("entiende un error de validación sin envolver", () => {
    const mensaje = mensajeDeError(respuesta({ numero_serie: ["Ya existe."] }));

    expect(mensaje).toBe("numero_serie: Ya existe.");
  });

  it("no repite el nombre del campo cuando el error no es de ninguno", () => {
    const mensaje = mensajeDeError(
      respuesta({
        error: {
          message: "x",
          details: { non_field_errors: ["Fechas cruzadas."] },
        },
      }),
    );

    expect(mensaje).toBe("Fechas cruzadas.");
  });

  it("cae en el mensaje por defecto si la respuesta no trae nada", () => {
    expect(
      mensajeDeError(new Error("sin respuesta"), "No se pudo guardar."),
    ).toBe("No se pudo guardar.");
  });
});
