import { nombreDeCargo } from "../../Institucional/organigrama";

/**
 * Lo que necesita el alta de usuarios de cada cargo del organigrama: cómo se
 * llama («Jefe de Cartera · Cartera», con «reporta a …» si hay gemelos, igual
 * que `organigrama.nombre_con_unidad` del servidor), qué rol da, cuántas
 * vacantes le quedan y quién figura en él sin cuenta.
 *
 * Solo los activos: un cargo desactivado no se ocupa. Por orden alfabético
 * español, que es como se busca un cargo en una lista larga.
 */
export function cargosParaElegir(datos) {
  const unidades = datos?.unidades ?? [];
  const todos = datos?.cargos ?? [];
  return todos
    .filter((cargo) => cargo.activo)
    .map((cargo) => ({
      id: cargo.id,
      etiqueta: nombreDeCargo(cargo, unidades, todos),
      rol: cargo.rol ?? null,
      vacantes: cargo.vacantes ?? 0,
      sinCuenta: (cargo.ocupantes ?? [])
        .filter((ocupante) => ocupante.sin_cuenta)
        .map((ocupante) => ocupante.nombre),
    }))
    .sort((a, b) =>
      a.etiqueta.localeCompare(b.etiqueta, "es", { sensitivity: "base" }),
    );
}

/**
 * «Sara  Fernanda MARROQUÍN» → «sara fernanda marroquin». La misma regla que
 * aplica el servidor (`organigrama._nombre_comparable`) para decidir si borra
 * al ocupante sin cuenta: si el aviso y el servidor no comparasen igual, la
 * pantalla prometería un reemplazo que no ocurre.
 */
export function nombreComparable(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/** Busca sin tildes ni mayúsculas, como el resto de buscadores. */
export function coincideCargo(cargo, texto) {
  const buscado = nombreComparable(texto);
  if (!buscado) return true;
  const etiqueta = nombreComparable(cargo.etiqueta);
  return buscado.split(" ").every((palabra) => etiqueta.includes(palabra));
}

/**
 * Los cargos que coinciden con lo buscado, primero los que EMPIEZAN por ello:
 * «jefe de cartera» debe dar «Jefe de Cartera · Cartera» antes que «Asistente
 * del Jefe de Cartera». Dentro de cada grupo se respeta el orden alfabético
 * que ya traen (revisión UX/UI, 09/11/2026).
 */
export function buscarCargos(cargos, texto) {
  const buscado = nombreComparable(texto);
  const encontrados = (cargos ?? []).filter((c) => coincideCargo(c, texto));
  if (!buscado) return encontrados;
  const empieza = (c) => nombreComparable(c.etiqueta).startsWith(buscado);
  return [
    ...encontrados.filter(empieza),
    ...encontrados.filter((c) => !empieza(c)),
  ];
}

/**
 * Lo que hay que saber del cargo elegido además de su rol, en una frase: si
 * reemplaza a un ocupante sin cuenta, si solo hay uno parecido o si no le
 * quedan vacantes. Se pinta y se anuncia con el mismo texto.
 */
export function avisoDelCargo(cargo, nombreCompleto) {
  if (!cargo) return null;
  const ocupante = ocupanteSinCuentaPara(cargo, nombreCompleto);
  if (ocupante?.tipo === "reemplaza") {
    return {
      tipo: "reemplaza",
      texto: `En este cargo figura «${ocupante.nombre}» sin cuenta: se reemplazará por esta cuenta, para que no queden dos personas en la misma plaza.`,
    };
  }
  if (ocupante?.tipo === "parecido") {
    return {
      tipo: "parecido",
      texto: `En este cargo figura «${ocupante.nombre}» sin cuenta. Si es la misma persona, escriba los nombres y apellidos igual que ahí y se reemplazará; si no, quedarán las dos en el cargo.`,
    };
  }
  if (cargo.vacantes <= 0) {
    return {
      tipo: "sin-vacantes",
      texto:
        "El cargo no tiene vacantes: la persona quedará en él además de quienes ya lo ocupan.",
    };
  }
  return null;
}

/** «Recibe el rol «Jefe de Cartera · Cartera» y sus permisos.» */
export function textoDelRol(cargo) {
  return cargo?.rol
    ? `Recibe el rol «${cargo.rol.nombre}» y sus permisos.`
    : "Este cargo todavía no tiene rol: la cuenta no recibirá permisos por él.";
}

/**
 * Qué pasará con quien figura sin cuenta en el cargo, según el nombre que se
 * está escribiendo en el alta:
 *
 * - `reemplaza`: el nombre completo es el mismo (sin tildes ni mayúsculas).
 *   El servidor lo borra al asignar: no quedan dos personas en la plaza.
 * - `parecido`: comparten al menos dos palabras, pero no es igual. El servidor
 *   NO lo toca (no hay forma segura de saber que es la misma persona); se
 *   avisa para que, si lo es, se escriba igual.
 *
 * Devuelve `{ tipo, nombre }` o null.
 */
export function ocupanteSinCuentaPara(cargo, nombreCompleto) {
  const escrito = nombreComparable(nombreCompleto);
  if (!cargo || !escrito) return null;
  const igual = cargo.sinCuenta.find(
    (nombre) => nombreComparable(nombre) === escrito,
  );
  if (igual) return { tipo: "reemplaza", nombre: igual };
  const palabras = new Set(escrito.split(" "));
  const parecido = cargo.sinCuenta.find(
    (nombre) =>
      nombreComparable(nombre)
        .split(" ")
        .filter((palabra) => palabras.has(palabra)).length >= 2,
  );
  return parecido ? { tipo: "parecido", nombre: parecido } : null;
}

/** «Alta de la cuenta de Sara Marroquín: ocupa el cargo Jefe de Cartera ·
 * Cartera». Va a la bitácora del organigrama, que exige un motivo. */
export function motivoDelAlta(nombreCompleto, cargo) {
  return `Alta de la cuenta de ${nombreCompleto.trim()}: ocupa el cargo ${cargo.etiqueta}`;
}
