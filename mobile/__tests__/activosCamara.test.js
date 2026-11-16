/**
 * La cámara del escáner sin el módulo nativo (US-022, ronda 1 de QA): la app
 * de desarrollo sin recompilar no trae `ExpoCamera` y el escáner se queda con
 * el ingreso a mano, sin romperse.
 */
const mockNativo = { valor: null, lanza: false };
jest.mock("expo", () => ({
  requireOptionalNativeModule: jest.fn(() => {
    if (mockNativo.lanza) throw new Error("sin módulo");
    return mockNativo.valor;
  }),
}));

const { camaraDisponible, olvidarCamara } = jest.requireActual("../src/activos/camara");

beforeEach(() => {
  olvidarCamara();
  mockNativo.valor = null;
  mockNativo.lanza = false;
});

it("sin el módulo nativo devuelve `null` y no carga `expo-camera`", () => {
  expect(camaraDisponible()).toBeNull();
});

it("si preguntar por el módulo lanza, también devuelve `null`", () => {
  mockNativo.lanza = true;
  expect(camaraDisponible()).toBeNull();
});

it("con el módulo nativo devuelve la vista y el hook del permiso, y se resuelve una sola vez", () => {
  mockNativo.valor = {};
  const camara = camaraDisponible();
  expect(typeof camara.CameraView).toBe("function");
  expect(typeof camara.useCameraPermissions).toBe("function");
  mockNativo.valor = null;
  expect(camaraDisponible()).toBe(camara);
});
