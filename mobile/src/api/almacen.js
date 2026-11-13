import * as SecureStore from "expo-secure-store";

/**
 * Lo que la app guarda en el teléfono, todo en `expo-secure-store` (Keychain
 * en iOS, Keystore en Android). Nunca AsyncStorage: los tokens dan acceso a la
 * cuenta (perfil DEV-1, US-009, 12/11/2026). La empresa y el token push no son
 * secretos, pero van aquí también para no sumar otra dependencia y para que
 * «borrar los datos locales» al cerrar sesión sea un solo lugar.
 *
 * SecureStore es asíncrono: se carga una vez al abrir la app y se mantiene una
 * copia en memoria, para que el cliente HTTP lea el token sin esperar.
 */
const CLAVES = {
  access: "ilce_access",
  refresh: "ilce_refresh",
  empresa: "ilce_empresa",
  push: "ilce_push_token",
  pushExplicado: "ilce_push_explicado",
  cierrePendiente: "ilce_cierre_pendiente",
};

const memoria = {
  access: null,
  refresh: null,
  empresa: null,
  push: null,
  pushExplicado: false,
  cierrePendiente: null,
};

async function escribir(clave, valor) {
  if (valor === null || valor === undefined || valor === "") {
    await SecureStore.deleteItemAsync(CLAVES[clave]);
  } else {
    await SecureStore.setItemAsync(CLAVES[clave], String(valor));
  }
}

export const almacen = {
  /** Lee todo del almacén seguro. Llamar una vez al arrancar. */
  async cargar() {
    const [access, refresh, empresa, push, explicado, pendiente] = await Promise.all([
      SecureStore.getItemAsync(CLAVES.access),
      SecureStore.getItemAsync(CLAVES.refresh),
      SecureStore.getItemAsync(CLAVES.empresa),
      SecureStore.getItemAsync(CLAVES.push),
      SecureStore.getItemAsync(CLAVES.pushExplicado),
      SecureStore.getItemAsync(CLAVES.cierrePendiente),
    ]);
    memoria.access = access;
    memoria.refresh = refresh;
    memoria.empresa = empresa;
    memoria.push = push;
    memoria.pushExplicado = explicado === "1";
    try {
      memoria.cierrePendiente = pendiente ? JSON.parse(pendiente) : null;
    } catch {
      memoria.cierrePendiente = null;
    }
  },

  /**
   * Un cierre de sesión que el servidor no recibió (sin red): `{refresh,
   * token}` de la sesión anterior, para revocarla y dar de baja el push en
   * cuanto haya red (`src/sesion/cierrePendiente.js`). Sobrevive a
   * `borrarSesion` a propósito.
   */
  cierrePendiente() {
    return memoria.cierrePendiente;
  },

  async guardarCierrePendiente(pendiente) {
    memoria.cierrePendiente = pendiente || null;
    await escribir("cierrePendiente", pendiente ? JSON.stringify(pendiente) : null);
  },

  tokens() {
    return { access: memoria.access, refresh: memoria.refresh };
  },

  /** Se guardan juntos: el refresh rota en cada renovación y el anterior ya
   * no sirve (el backend revoca la sesión si se reutiliza). */
  async guardarTokens(access, refresh) {
    memoria.access = access || null;
    memoria.refresh = refresh || null;
    await Promise.all([escribir("access", access), escribir("refresh", refresh)]);
  },

  empresa() {
    return memoria.empresa;
  },

  async guardarEmpresa(id) {
    memoria.empresa = id ? String(id) : null;
    await escribir("empresa", memoria.empresa);
  },

  pushToken() {
    return memoria.push;
  },

  async guardarPushToken(token) {
    memoria.push = token || null;
    await escribir("push", memoria.push);
  },

  pushExplicado() {
    return memoria.pushExplicado;
  },

  async marcarPushExplicado() {
    memoria.pushExplicado = true;
    await escribir("pushExplicado", "1");
  },

  /** Cierra la sesión en el teléfono: tokens, empresa y token push. Se
   * conserva solo si ya se explicó el permiso de avisos (es del teléfono, no
   * de la cuenta). */
  async borrarSesion() {
    memoria.access = null;
    memoria.refresh = null;
    memoria.empresa = null;
    memoria.push = null;
    await Promise.all([
      escribir("access", null),
      escribir("refresh", null),
      escribir("empresa", null),
      escribir("push", null),
    ]);
  },
};
