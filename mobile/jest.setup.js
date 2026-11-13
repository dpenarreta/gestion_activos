/**
 * Los módulos nativos no existen en Jest: se reemplazan por dobles en memoria.
 * Cada prueba puede cambiar su comportamiento con `mockResolvedValueOnce`.
 */

jest.mock("expo-secure-store", () => {
  const datos = new Map();
  return {
    __datos: datos,
    getItemAsync: jest.fn(async (clave) => (datos.has(clave) ? datos.get(clave) : null)),
    setItemAsync: jest.fn(async (clave, valor) => {
      datos.set(clave, valor);
    }),
    deleteItemAsync: jest.fn(async (clave) => {
      datos.delete(clave);
    }),
  };
});

jest.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 4, MAX: 5 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ status: "undetermined", canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[prueba]" })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  setBadgeCountAsync: jest.fn(async () => true),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  unregisterForNotificationsAsync: jest.fn(async () => undefined),
}));

jest.mock("expo-device", () => ({ modelName: "Pixel 7", isDevice: true }));

jest.mock("expo-linking", () => ({
  openURL: jest.fn(async () => true),
  openSettings: jest.fn(async () => true),
}));

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "opened" })) }));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "1.0.0", extra: { eas: { projectId: "proyecto-de-prueba" } } } },
}));

jest.mock("@expo/vector-icons/MaterialCommunityIcons", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return function IconoFalso() {
    return React.createElement(Text, null, "·");
  };
});

// --- US-010: documento de respaldo y fechas -------------------------------

/** Un sistema de archivos en memoria con la forma de `expo-file-system`
 * (SDK 58): `File`, `Directory` y `Paths.cache`. */
jest.mock("expo-file-system", () => {
  const existentes = new Set();
  const tamanos = new Map();
  function unir(partes) {
    return partes
      .map((p) => (typeof p === "string" ? p : p.uri))
      .reduce((a, b) => `${a.replace(/\/+$/, "")}/${b.replace(/^\/+/, "")}`);
  }
  class Directory {
    constructor(...partes) {
      this.uri = unir(partes);
    }
    get exists() {
      return existentes.has(this.uri);
    }
    create() {
      existentes.add(this.uri);
    }
    delete() {
      for (const uri of [...existentes]) {
        if (uri === this.uri || uri.startsWith(`${this.uri}/`)) existentes.delete(uri);
      }
    }
  }
  class File {
    constructor(...partes) {
      this.uri = unir(partes);
    }
    get exists() {
      return existentes.has(this.uri);
    }
    get size() {
      return tamanos.get(this.uri) ?? 0;
    }
    delete() {
      existentes.delete(this.uri);
    }
  }
  File.downloadFileAsync = jest.fn(async (_url, destino) => {
    existentes.add(destino.uri);
    return destino;
  });
  File.canPreview = jest.fn(async () => true);
  File.preview = jest.fn(async () => undefined);
  return {
    __existentes: existentes,
    __tamanos: tamanos,
    File,
    Directory,
    Paths: { cache: new Directory("file:///cache"), document: new Directory("file:///documentos") },
  };
});

jest.mock("expo-image-picker", () => ({
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" },
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, status: "granted" })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: null })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

jest.mock("expo-document-picker", () => ({
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

jest.mock("@react-native-community/datetimepicker", () => {
  const React = require("react");
  const { View } = require("react-native");
  function SelectorFalso(props) {
    return React.createElement(View, { testID: "selector-nativo", ...props });
  }
  return {
    __esModule: true,
    default: SelectorFalso,
    DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn() },
  };
});

/**
 * El `FormData` de React Native: acepta partes `{uri, name, type}` y las
 * enumera con `getParts()`. El de Node (el que hay en Jest) convertiría el
 * archivo en el texto «[object Object]».
 */
class FormDataDeReactNative {
  constructor() {
    this._partes = [];
  }
  append(clave, valor) {
    this._partes.push(
      typeof valor === "string" ? { fieldName: clave, string: valor } : { fieldName: clave, ...valor },
    );
  }
  getParts() {
    return this._partes;
  }
}
global.FormData = FormDataDeReactNative;

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(async () => true),
  hideAsync: jest.fn(async () => undefined),
  hide: jest.fn(),
  setOptions: jest.fn(),
}));

// La altura de la cabecera (`src/navegador/alturaCabecera.js`): fuera de una
// pantalla de Expo Router no hay cabecera.
jest.mock("expo-router/build/react-navigation/elements/Header/HeaderHeightContext.js", () => ({
  HeaderHeightContext: require("react").createContext(undefined),
}));
