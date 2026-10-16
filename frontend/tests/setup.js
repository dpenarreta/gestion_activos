import "@testing-library/jest-dom/vitest";

// jsdom no implementa `matchMedia` ni `scrollIntoView`. Los paneles laterales
// de react-bootstrap (Dashboards) usan el primero para sus cortes de ancho; quien
// necesite un resultado concreto lo sigue reemplazando en su prueba.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
