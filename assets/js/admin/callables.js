/* ============================================================
 * UneFibra SAS — Admin: envoltura de Cloud Functions
 * ------------------------------------------------------------
 * Devuelve una función callable lista para usar. Las funciones
 * validan el rol del llamador en el servidor (verificarRol).
 *
 * KZ-UNEF-028 · La conexión al emulador usaba SOLO el parámetro de la URL. Como
 * el panel se mueve con rutas relativas (login → dashboard), tras el primer
 * salto el `?emulador=1` desaparecía y las callables dejaban de apuntar al
 * emulador: «registrar pago» y el resto fallaban en local. Ahora se usa el
 * mismo flag persistente que emplea core.js.
 * ============================================================ */

import { app, modoEmuladorActivo } from "./core.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "firebase/functions";

const functions = getFunctions(app);
const CFG = window.UNEFIBRAS_CONFIG;
if (modoEmuladorActivo() && CFG && CFG.emulador) {
  connectFunctionsEmulator(functions, CFG.emulador.host, CFG.emulador.functionsPort);
}

export function call(nombre) {
  return httpsCallable(functions, nombre);
}
