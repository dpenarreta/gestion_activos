// Los botones que cierran una ventana sin guardar: la X del encabezado,
// «Cancelar» o «Cerrar» en el pie, o lo que se marque con
// `data-cierra-ventana`. Una X para quitar a alguien de una lista no cuenta, y
// un «Cancelar» que no cierra (vuelve a un paso anterior) se marca con
// `data-no-descarta` (auditoría UX/UI, 27/10/2026).
const BOTON_DE_CIERRE =
  ".mz-panel-head .mz-close, .modal-header .btn-close, .btn-cancelar, [data-cierra-ventana]";
const PIE = ".mz-panel-foot, .mz-actions, .modal-footer";

function esBotonDeCierre(boton) {
  if (boton.closest("[data-no-descarta]")) return false;
  if (boton.matches(BOTON_DE_CIERRE)) return true;
  const nombre = (boton.getAttribute("aria-label") || boton.textContent).trim();
  return Boolean(boton.closest(PIE)) && /^(cancelar|cerrar)$/i.test(nombre);
}

/**
 * Vigila una ventana: si se escribió algo en ella, un clic en sus botones de
 * cierre pregunta antes de descartarlo (con `preguntar`, que devuelve una
 * promesa). Por defecto solo cuentan los campos dentro de un `<form>`: un
 * buscador o un filtro de una ventana de consulta no son «cambios».
 */
export function vigilarDescarte(raiz, { preguntar, soloEnFormulario = true }) {
  let sucio = false;

  function marcar(event) {
    // Un buscador o un filtro marcado con `data-sin-descarte` no es un cambio.
    if (event.target.closest?.("[data-sin-descarte]")) return;
    if (!soloEnFormulario || event.target.closest?.("form")) {
      sucio = true;
    }
  }

  // En captura: corta el clic antes de que llegue al onClick de React.
  function alHacerClic(event) {
    if (!sucio) return;
    const boton = event.target.closest?.("button");
    if (!boton || !raiz.contains(boton) || !esBotonDeCierre(boton)) return;
    event.preventDefault();
    event.stopPropagation();
    preguntar().then((descartar) => {
      if (descartar) {
        sucio = false;
        boton.click();
      }
    });
  }

  raiz.addEventListener("input", marcar);
  raiz.addEventListener("change", marcar);
  raiz.addEventListener("click", alHacerClic, true);
  return {
    estaSucio: () => sucio,
    olvidar: () => {
      sucio = false;
    },
    /** Lo marca (o desmarca) quien sabe que hubo un cambio sin `input`. */
    marcar: (valor = true) => {
      sucio = Boolean(valor);
    },
    desmontar: () => {
      raiz.removeEventListener("input", marcar);
      raiz.removeEventListener("change", marcar);
      raiz.removeEventListener("click", alHacerClic, true);
    },
  };
}
