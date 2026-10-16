# Dashboard de Calidad – Movistar MX OUT

Dashboard web que lee **en vivo** las respuestas de los Google Forms (Evaluaciones / pauta de calidad y Feedback). Cada respuesta nueva del forms aparece al pulsar **↻ Actualizar** o al recargar la página (la caché dura 2 minutos).

## Pestañas
| Pestaña | Equivale en el Excel a |
|---|---|
| Resumen | R. Global (por campaña y supervisor) |
| Pauta por ítem | Negociación, Venta, Cierre Vta, Exp. Clte |
| Semanal | Semanal |
| Errores / Pareto | Errores, PARETO |
| Agentes | detalle por agente, con clic para ver sus evaluaciones y feedbacks |
| Causa raíz | CIERRE REPORTE (objeciones, causa raíz, habilidades) |
| Feedback | FEEDBACK (motivo, actitud, evaluador por semana) |
| 🔒 Monitoreo | Control de EVA Agente, DESVIACIÓN, Control EVA Monitor (**con clave**) |

Los cálculos replican las fórmulas de la hoja "Data EVA Formulado": nota ponderada por tipo de llamada, CUM por bloque, UF / NEG / CUM / ENC y PEC global.

## Instalación (una sola vez, ~5 minutos)
1. Abre la Google Sheet del feedback → **Extensiones → Apps Script**.
2. Reemplaza el contenido de `Code.gs` por el de este `Code.gs`.
3. **+ → HTML**, nómbralo `Index` (sin .html) y pega el contenido de `Index.html`.
4. En `CONFIG` (arriba de `Code.gs`):
   - `EVA_SPREADSHEET_ID`: si las respuestas del forms de evaluaciones están en **otro** libro, pon aquí su ID (lo que va entre `/d/` y `/edit` en la URL). Si están en el mismo libro, déjalo vacío.
   - `DOT_SPREADSHEET_ID` / `DOT_SHEET`: libro y pestaña con la Dotación (columnas `USUARIO_SPRINKLR`, `DNI`, `Apellidos y Nombres`, `CARGO`, `CAMPAÑA`, `ESTADO`, `JEFE_DIRECTO`, `FECHA_INGRESO`, `FECHA_BAJA`). Es opcional; sin ella, Monitoreo toma la lista de agentes de las evaluaciones. Solo se leen esas columnas; usuarios y contraseñas de sistemas nunca salen de la hoja.
   - `EVAS_PROG_SEMANA` (2) y `META_DIARIA_MONITOR` (25): metas del seguimiento.
   - Las pestañas se detectan solas por sus encabezados; si falla, escribe el nombre en `EVA_SHEET` / `FB_SHEET`.
5. **Clave de Monitoreo**: en `configurarClave()` cambia `'CAMBIAR_ESTA_CLAVE'` por tu clave, selecciona esa función en la barra superior y pulsa **Ejecutar** (acepta los permisos). Luego vuelve a poner `'CAMBIAR_ESTA_CLAVE'` para que la clave no quede escrita en el código. Se guarda cifrada (SHA-256) en las Propiedades del script.
6. **Implementar → Nueva implementación → Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario de tu organización** (o "Solo yo"). Evita "Cualquier persona": son datos de personal.
7. Copia la URL `/exec` y compártela. Para cambios futuros: **Implementar → Gestionar implementaciones → Editar → Nueva versión**.

## Sobre la clave
La clave se valida en el servidor: sin la clave correcta los datos de Monitoreo no llegan al navegador. Para cambiarla, repite el paso 5.
