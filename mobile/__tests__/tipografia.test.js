import { crearEstilos, familia, usaPoppins, usarFuenteDelSistema } from "../src/tema/tipografia";

describe("tipografía de la marca (Poppins)", () => {
  it("cada peso usa su familia y, si Poppins falla, vuelve a la fuente del sistema", () => {
    const estilos = crearEstilos({
      titulo: { fontSize: 20, fontWeight: "700", color: "#000" },
      texto: { fontSize: 15 },
      caja: { padding: 4 },
    });
    expect(estilos.titulo).toEqual({ fontSize: 20, color: "#000", fontFamily: "Poppins_700Bold" });
    expect(estilos.texto.fontFamily).toBe("Poppins_400Regular");
    expect(estilos.caja).toEqual({ padding: 4 });

    usarFuenteDelSistema();

    expect(usaPoppins()).toBe(false);
    expect(estilos.titulo).toEqual({ fontSize: 20, color: "#000", fontWeight: "700" });
    expect(estilos.texto.fontFamily).toBeUndefined();
    expect(familia(600)).toBeUndefined();
    expect(crearEstilos({ nuevo: { fontSize: 12, fontWeight: "600" } }).nuevo).toEqual({ fontSize: 12, fontWeight: "600" });
  });
});
