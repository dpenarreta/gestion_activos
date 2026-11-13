/** Pruebas de la app con jest-expo y Testing Library (perfil DEV-1). */
module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.js"],
  // El primer render de cada archivo carga React Native entero: en Windows
  // supera los 5 s por defecto.
  testTimeout: 30000,
  testMatch: ["<rootDir>/__tests__/**/*.test.js"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*)",
  ],
};
