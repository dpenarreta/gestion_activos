/*
 * El módulo se portó desde un sistema con su propia sesión. Aquí la sesión es
 * la del sistema: sus pantallas leen lo mismo (`user.permissions`,
 * `user.is_superuser`) del contexto de autenticación común.
 */
export { useAuth } from "../../hooks/useAuth";
