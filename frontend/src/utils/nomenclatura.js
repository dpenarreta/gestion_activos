/**
 * El nombre de usuario que le tocará a una persona: inicial del nombre y
 * apellido completo, sin tildes ni eñes. «Diego Peñarreta» → `dpenarreta`.
 *
 * Lo definitivo lo decide el backend (`apps.users.nomenclatura`), que además
 * desempata si ya existe. Aquí se calcula solo para enseñarlo mientras se
 * escribe: quien da de alta la cuenta tiene que poder ver con qué nombre va a
 * entrar esa persona antes de guardar, no descubrirlo después.
 *
 * Sin apellidos, el nombre se parte —«Anthony Jacome» → `ajacome`— y una
 * sola palabra va completa —«Recepción» → `recepcion`—: nunca una letra
 * suelta (04/11/2026, igual que el backend).
 */
export function baseDeUsername(nombres, apellidos) {
  if (!soloLetras(apellidos)) {
    const palabras = (nombres ?? "").trim().split(/\s+/).filter(Boolean);
    if (palabras.length > 1) {
      return baseDeUsername(palabras[0], palabras.slice(1).join(" "));
    }
    return soloLetras(nombres);
  }
  const inicial = soloLetras(nombres).slice(0, 1);
  return `${inicial}${soloLetras(apellidos)}`;
}

function soloLetras(texto) {
  return (
    (texto ?? "")
      .normalize("NFKD")
      // Se quitan los signos ya separados de su letra: la eñe queda en «n», la
      // tilde desaparece y la diéresis también.
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
  );
}
