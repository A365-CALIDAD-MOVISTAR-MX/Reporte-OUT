# Reporte-OUT

Dashboard de Calidad – Movistar MX OUT (Google Apps Script).

Lee en vivo las respuestas de los Google Forms de evaluaciones (pauta de calidad) y feedback, y muestra:
Resumen, Pauta por ítem, Semanal, Errores/Pareto, Agentes, Causa raíz, Feedback y Monitoreo (con clave).

- `index.html`: página de GitHub Pages (https://a365-calidad-movistar-mx.github.io/Reporte-OUT/) que muestra el dashboard de Apps Script.
- `apps-script/Code.gs`: backend Apps Script (lectura de hojas, cálculos de la pauta, clave de Monitoreo).
- `apps-script/index.html`: interfaz del dashboard (en Apps Script el archivo HTML se llama `index`).
- `LEEME.md`: instalación paso a paso.

El dashboard corre en Apps Script; este repositorio guarda el código y la página de acceso. No subir datos de respuestas ni la clave.
