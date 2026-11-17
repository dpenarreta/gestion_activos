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
  apariencia: "ilce_apariencia",
  usuarioRecordado: "ilce_usuario_recordado",
  textosDeAcceso: "ilce_textos_acceso",
};

const memoria = {
  access: null,
  refresh: null,
  empresa: null,
  push: null,
  pushExplicado: false,
  cierrePendiente: null,
  usuarioRecordado: null,
  textosDeAcceso: null,
};

/** JSON guardado por la app; ilegible, `null`. */
function leerJson(texto) {
  try {
    return texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
}

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
    const [access, refresh, empresa, push, explicado, pendiente, recordado, textos] = await Promise.all([
      SecureStore.getItemAsync(CLAVES.access),
      SecureStore.getItemAsync(CLAVES.refresh),
      SecureStore.getItemAsync(CLAVES.empresa),
      SecureStore.getItemAsync(CLAVES.push),
      SecureStore.getItemAsync(CLAVES.pushExplicado),
      SecureStore.getItemAsync(CLAVES.cierrePendiente),
      SecureStore.getItemAsync(CLAVES.usuarioRecordado),
      SecureStore.getItemAsync(CLAVES.textosDeAcceso),
    ]);
    memoria.access = access;
    memoria.refresh = refresh;
    memoria.empresa = empresa;
    memoria.push = push;
    memoria.pushExplicado = explicado === "1";
    memoria.cierrePendiente = leerJson(pendiente);
    memoria.usuarioRecordado = leerJson(recordado);
    memoria.textosDeAcceso = leerJson(textos);
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

  /**
   * El modo de la app que eligió la persona (US-026, 17/11/2026): «claro»,
   * «oscuro» o «sistema». Es del teléfono y no de la cuenta, como en la web
   * (que lo guarda por navegador): no se borra al cerrar sesión y la pantalla
   * de inicio de sesión ya lo respeta. Se lee aparte de `cargar()` porque la
   * apariencia se decide antes que la sesión.
   */
  async leerApariencia() {
    return SecureStore.getItemAsync(CLAVES.apariencia);
  },

  async guardarApariencia(preferencia) {
    await escribir("apariencia", preferencia);
  },

  /**
   * El usuario con el que se entró, recordado 30 días (US-028, CA-5, como
   * `usuarioRecordado.js` de la web): `{usuario, vence}`, solo el
   * identificador y nunca la contraseña. Se lee en `cargar()`, antes de
   * mostrar el acceso, para que el campo salga ya lleno. La regla (vence,
   * recordar u olvidar) está en `src/sesion/usuarioRecordado.js`.
   */
  usuarioRecordado() {
    return memoria.usuarioRecordado;
  },

  async guardarUsuarioRecordado(recordado) {
    memoria.usuarioRecordado = recordado || null;
    await escribir("usuarioRecordado", recordado ? JSON.stringify(recordado) : null);
  },

  /**
   * El último título y subtítulo del acceso que mandó el servidor (US-028,
   * CA-4): `{acceso_titulo, acceso_subtitulo}`. Se leen en `cargar()` para
   * que el texto no salte al llegar el tema (`src/sesion/textosDeAcceso.js`).
   */
  textosDeAcceso() {
    return memoria.textosDeAcceso;
  },

  async guardarTextosDeAcceso(textos) {
    memoria.textosDeAcceso = textos || null;
    await escribir("textosDeAcceso", textos ? JSON.stringify(textos) : null);
  },

  /** Cierra la sesión en el teléfono: tokens, empresa y token push. Se
   * conserva lo que es del teléfono y no de la cuenta: si ya se explicó el
   * permiso de avisos, la apariencia elegida (US-026), el cierre pendiente
   * (`cierrePendiente`), el usuario recordado y los textos del acceso
   * (US-028: tras «Cerrar sesión» el campo sale ya lleno, como en la web). */
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
