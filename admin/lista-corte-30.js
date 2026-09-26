/* ============================================================
 * UneFibra SAS — Admin: lista de clientes con CORTE EL DÍA 30
 * ------------------------------------------------------------
 * Página fina a propósito: toda la lógica vive en el módulo
 * compartido assets/js/admin/cortes.js, que usan las dos listas.
 * OJO: en febrero (28 o 29 días) el corte del ciclo 30 cae el
 * último día del mes. Esa regla está en ui.js y en las Functions.
 * ============================================================ */

import { iniciarListaCorte } from "../assets/js/admin/cortes.js";

iniciarListaCorte("30", "corte30");
