/**
 * Dashboard de Calidad – Movistar México (MOV OUT)
 * Lee en vivo las respuestas de los Google Forms (Evaluaciones + Feedback)
 * y sirve el dashboard como Web App.
 *
 * Instalación: ver LEEME.md
 */

var CONFIG = {
  // Libro donde caen las respuestas del forms de FEEDBACK
  SPREADSHEET_ID: '1CROn__xQOuGb6hyub5_-nIF_bUUEwJgwTjAvXtlA0-E',
  // Libro de las EVALUACIONES (pauta de calidad). Vacío = mismo libro de arriba
  EVA_SPREADSHEET_ID: '1N7-zHE_LZ9TDDRpurKC9RrzW0qCfaeYYwcAHgHwU9Nc',
  // Libro con la Dotación. Vacío = se busca en el libro de feedback y luego en el de la pauta
  DOT_SPREADSHEET_ID: '1o6Wj-W7anoUQyl6xPn4gQX_KsCQGvUmmU1ACZ-Y3lC0',   // libro de la dotación
  // Pestaña exacta por su gid (el número después de "gid=" en el link). Vacío = se busca por nombre o encabezados
  EVA_GID: 643164169,   // pestaña "Forms" del libro de la pauta
  FB_GID: 1618586159,
  DOT_GID: 0,  // primera pestaña del libro de la dotación
  // Nombres de pestaña. Vacío = se detectan solas por sus encabezados
  EVA_SHEET: '',
  FB_SHEET: '',
  DOT_SHEET: 'dota',
  // Metas del seguimiento de monitoreos
  EVAS_PROG_SEMANA: 2,       // evaluaciones programadas por agente por semana
  META_DIARIA_MONITOR: 25,   // feedbacks/evaluaciones diarias por monitor
  // Personal que NO se programa en Monitoreo (no son asesores de venta): por jefe directo o por cargo
  EXCLUIR_JEFES: ['Jessica Chirinos', 'Nilton Valencia'],   // back office y estructura
  EXCLUIR_CARGOS: /back|estructura|supervisor|calidad|gerente|formador|capacitador|analista|coordinador|jefe|monitor/i,
  CACHE_SEGUNDOS: 120,
  TZ: 'America/Mexico_City',
  // Inicio de la operación: ninguna respuesta puede ser anterior (sirve para corregir día/mes invertidos)
  INICIO_OPERACION: '2026-08-01'
};

/* ---------------- Web App ---------------- */

// ?central=1 → datos para CENTRAL (Calidad A365): una fila por evaluación con los mismos cálculos del
// dashboard y NADA personal (sin agente, usuario, DN, caso, supervisor, evaluador ni detalle).
var COLUMNAS_CENTRAL = ['Fecha', 'Campaña', 'Tipo de llamada', 'Venta', 'Nota', 'PEC UF', 'PEC NEG', 'PEC CUM', 'ENC', 'PEC Global'];

function central_() {
  var cache = CacheService.getScriptCache();
  var out = cache.get('central_v1');
  if (!out) {
    try {
      var filas = loadSources_().eva.map(function (e) {
        return [e.fecha, e.campana, e.tipo, e.tipo === 'Venta' ? 1 : 0, e.nota, e.uf, e.ecNeg, e.ecCum, e.enc, e.pec];
      });
      out = JSON.stringify({
        ok: true, items: COLUMNAS_CENTRAL, filas: filas,
        actualizado: Utilities.formatDate(new Date(), CONFIG.TZ, 'dd/MM/yyyy HH:mm')
      });
      if (out.length < 95000) cache.put('central_v1', out, CONFIG.CACHE_SEGUNDOS);
    } catch (err) {
      out = JSON.stringify({ ok: false, error: String(err && err.message || err) });
    }
  }
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

/** Ejecutar desde el editor para revisar lo que recibe CENTRAL (registro de ejecución). */
function probarCentral() {
  var r = JSON.parse(central_().getContent());
  Logger.log(r.ok ? (r.filas.length + ' evaluaciones. Primera: ' + JSON.stringify(r.filas[0])) : ('Error: ' + r.error));
}

// ?api=data|mon&callback=fn → datos del dashboard en JSONP para la página de GitHub Pages
// (así la página no tiene que mostrar Apps Script dentro de un marco). Monitoreo exige el hash de la clave.
function api_(p) {
  var cb = String(p.callback || '');
  if (!/^[A-Za-z_$][\w$]{0,60}$/.test(cb)) {
    return ContentService.createTextOutput('{"ok":false,"error":"callback inválido"}').setMimeType(ContentService.MimeType.JSON);
  }
  var out;
  try {
    if (p.api === 'mon') out = monitoreoPorHash_(String(p.h || ''));
    else out = p.r ? refrescar() : getData();
  } catch (err) {
    out = JSON.stringify({ ok: false, error: String(err && err.message || err) });
  }
  return ContentService.createTextOutput(cb + '(' + JSON.stringify(out) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// El navegador envía SHA-256("movout|" + clave), nunca la clave en la URL
function monitoreoPorHash_(h) {
  var guardado = PropertiesService.getScriptProperties().getProperty('MONITOREO_HASH');
  if (!guardado) return JSON.stringify({ ok: false, error: 'La clave aún no fue configurada (ejecuta configurarClave).' });
  if (!h || h !== guardado) {
    Utilities.sleep(800);
    return JSON.stringify({ ok: false, error: 'Clave incorrecta.' });
  }
  var src = loadSources_();
  return JSON.stringify({ ok: true, data: buildMonitoreo_(src.eva, src.fb, src.dot, CONFIG) });
}

// ?avance=1 → módulo "Avance equipo" de CENTRAL: por evaluación solo fecha, hora de envío (Marca temporal) y
// duración de la llamada (si el forms la pide), de los últimos 35 días. Nada de personas (ni agente, ni cliente, ni monitor).
function avance_() {
  var desde = ymd_(new Date(Date.now() - 35 * 86400000));
  try {
    var filas = loadSources_().eva.filter(function (e) { return e.fecha >= desde; }).map(function (e) {
      return [e.fecha, Utilities.formatDate(new Date(e.ts), CONFIG.TZ, 'HH:mm'), e.dur || ''];
    });
    var out = JSON.stringify({ ok: true, items: ['Fecha', 'Hora', 'Duración'], filas: filas,
      actualizado: Utilities.formatDate(new Date(), CONFIG.TZ, "yyyy-MM-dd'T'HH:mm:ss") });
  } catch (err) {
    out = JSON.stringify({ ok: false, error: String(err && err.message || err) });
  }
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}

/** Duración de la llamada: las celdas de duración llegan como fecha desde el 30/12/1899 → segundos. */
function duracion_(v) {
  if (v instanceof Date) return Math.round((v.getTime() - new Date(1899, 11, 30).getTime()) / 1000);
  return str_(v);
}

function doGet(e) {
  if (e && e.parameter && e.parameter.avance) return avance_();
  if (e && e.parameter && e.parameter.central) return central_();
  if (e && e.parameter && e.parameter.api) return api_(e.parameter);
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Dashboard Calidad MOV OUT')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Ejecutar UNA vez desde el editor para fijar la clave de la pestaña Monitoreo. */
function configurarClave() {
  var clave = 'CAMBIAR_ESTA_CLAVE';
  // la comparación va partida para que "reemplazar todo" en el editor no la cambie también
  if (!clave || clave === 'CAMBIAR_' + 'ESTA_CLAVE') throw new Error('Escribe tu clave en la línea de arriba (var clave = ...) antes de ejecutar.');
  PropertiesService.getScriptProperties().setProperty('MONITOREO_HASH', hash_(clave));
  Logger.log('Clave de Monitoreo configurada.');
}

/** Datos generales del dashboard (sin datos de monitoreo). */
function getData() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('data_v1');
  if (hit) return hit;
  var src = loadSources_();
  var out = JSON.stringify({
    eva: src.eva,
    fb: src.fb,
    hojas: src.hojas,
    actualizado: Utilities.formatDate(new Date(), CONFIG.TZ, 'dd/MM/yyyy HH:mm')
  });
  if (out.length < 95000) cache.put('data_v1', out, CONFIG.CACHE_SEGUNDOS);
  return out;
}

/** Fuerza recarga ignorando la caché. */
function refrescar() {
  CacheService.getScriptCache().remove('data_v1');
  return getData();
}

/** Seguimiento de monitoreos: solo responde con la clave correcta. */
function getMonitoreo(clave) {
  var guardado = PropertiesService.getScriptProperties().getProperty('MONITOREO_HASH');
  if (!guardado) return JSON.stringify({ ok: false, error: 'La clave aún no fue configurada (ejecuta configurarClave).' });
  if (!clave || hash_(String(clave)) !== guardado) {
    Utilities.sleep(800);
    return JSON.stringify({ ok: false, error: 'Clave incorrecta.' });
  }
  var src = loadSources_();
  return JSON.stringify({ ok: true, data: buildMonitoreo_(src.eva, src.fb, src.dot, CONFIG) });
}

/** Ejecutar desde el editor si alguna pestaña sale en 0: muestra en el registro qué leyó de cada hoja. */
function diagnostico() {
  var src = loadSources_();
  Logger.log('Hojas encontradas: ' + JSON.stringify(src.hojas));
  Logger.log('Evaluaciones leídas: ' + src.eva.length + ' | Feedbacks: ' + src.fb.length + ' | Dotación: ' + src.dot.length);
  if (src.dot.length) Logger.log('Dotación con nombre: ' + src.dot.filter(function (d) { return d.nombre; }).length + ' de ' + src.dot.length + '. Ejemplo: ' + JSON.stringify({ usuario: src.dot[0].usuario, nombre: src.dot[0].nombre, cargo: src.dot[0].cargo }));
  var evaBook = CONFIG.EVA_SPREADSHEET_ID ? SpreadsheetApp.openById(CONFIG.EVA_SPREADSHEET_ID) : SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  evaBook.getSheets().forEach(function (sh) {
    var lc = Math.max(1, Math.min(sh.getLastColumn(), 12));
    var lr = Math.max(1, Math.min(sh.getLastRow(), 2));
    var top = sh.getRange(1, 1, lr, lc).getDisplayValues().map(function (r) { return r.map(function (x) { return String(x).slice(0, 30); }).join(' | '); });
    Logger.log('Libro pauta → pestaña "' + sh.getName() + '" gid=' + sh.getSheetId() + ' filas=' + sh.getLastRow() + ' | encabezados: ' + top.join(' // '));
  });
  var porMes = function (arr) { var o = {}; arr.forEach(function (x) { o[x.mes] = (o[x.mes] || 0) + 1; }); return JSON.stringify(o); };
  Logger.log('Evaluaciones por mes: ' + porMes(src.eva));
  Logger.log('Feedbacks por mes: ' + porMes(src.fb));
  // Dotación: encabezados, columnas detectadas y cruce con las evaluaciones (sin datos personales)
  var cuenta = function (arr, k) { var o = {}; arr.forEach(function (x) { o[x[k]] = (o[x[k]] || 0) + 1; }); return JSON.stringify(o); };
  Logger.log('VERSION CRUCE DOTACION 3');
  // Activos de la dotación frente a los evaluados del mes actual: ¿coincide el usuario? ¿coincide el nombre?
  var mesAct = ymd_(new Date()).slice(0, 7);
  var clave = function (n) { return norm_(n).replace(/[^a-z ]/g, ' ').split(' ').filter(String).sort().join(' '); };
  var evaMes = src.eva.filter(function (e) { return e.mes === mesAct; });
  var usrEva = {}, nomEva = {};
  evaMes.forEach(function (e) { usrEva[e.usuario] = 1; nomEva[clave(e.agente)] = 1; });
  var activos = src.dot.filter(function (d) { return d.estado === 'ACTIVO'; });
  var linea = activos.map(function (d) {
    return (d.usuario || '(sin usuario)') + ' usr:' + (usrEva[d.usuario] ? 'SI' : 'no') + ' nom:' + (d.nombre ? (nomEva[clave(d.nombre)] ? 'SI' : 'no') : 'vacío') +
      ' cargo:' + (d.cargo || '-');
  });
  Logger.log('Activos en dotación: ' + activos.length + ' · evaluados en ' + mesAct + ' (usuario o nombre): ' +
    activos.filter(function (d) { return usrEva[d.usuario] || nomEva[clave(d.nombre)]; }).length);
  for (var li = 0; li < linea.length; li += 15) Logger.log(linea.slice(li, li + 15).join(' ; '));
  var sinDot = {}; evaMes.forEach(function (e) { if (e.estado === 'Sin dotación') sinDot[e.usuario] = 1; });
  Logger.log('Usuarios evaluados en ' + mesAct + ' sin dotación: ' + Object.keys(sinDot).sort().join(', '));
  Logger.log('Dotación leída: ' + src.dot.length + ' filas · con usuario: ' + src.dot.filter(function (d) { return d.usuario; }).length +
    ' · con nombre: ' + src.dot.filter(function (d) { return d.nombre; }).length + ' · ESTADO: ' + cuenta(src.dot, 'estado'));
  Logger.log('Estado en evaluaciones: ' + cuenta(src.eva, 'estado'));
  var dotSh = null;
  [CONFIG.DOT_SPREADSHEET_ID, CONFIG.SPREADSHEET_ID, CONFIG.EVA_SPREADSHEET_ID].filter(String).forEach(function (id) {
    SpreadsheetApp.openById(id).getSheets().forEach(function (sh) { if (sh.getName() === src.hojas.dot) dotSh = sh; });
  });
  if (dotSh) {
    var h = dotSh.getRange(1, 1, Math.min(10, dotSh.getLastRow()), dotSh.getLastColumn()).getValues();
    var fh = 0; for (var i = 0; i < h.length; i++) if (h[i].map(norm_).indexOf('estado') >= 0) { fh = i; break; }
    Logger.log('Encabezados de "' + dotSh.getName() + '" (fila ' + (fh + 1) + '): ' + h[fh].map(function (x) { return String(x).slice(0, 25); }).join(' | '));
    var ejemplo = src.dot.filter(function (d) { return d.usuario; })[0];
    if (ejemplo) Logger.log('Ejemplo usuario dotación: ' + ejemplo.usuario.replace(/^[^@]*/, '***') + ' · evaluación: ' + (src.eva[0] ? src.eva[0].usuario.replace(/^[^@]*/, '***') : '-'));
  }
  if (src.eva.length) Logger.log('Primera evaluación: ' + src.eva[0].fecha + ' ' + src.eva[0].tipo + ' nota=' + src.eva[0].nota);
}

/* ---------------- Lectura ---------------- */

function loadSources_() {
  var main = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var evaBook = CONFIG.EVA_SPREADSHEET_ID ? SpreadsheetApp.openById(CONFIG.EVA_SPREADSHEET_ID) : main;
  var dotBooks = CONFIG.DOT_SPREADSHEET_ID ? [SpreadsheetApp.openById(CONFIG.DOT_SPREADSHEET_ID)] : (evaBook === main ? [main] : [main, evaBook]);

  var evaSh = findSheet_(evaBook, CONFIG.EVA_SHEET, CONFIG.EVA_GID, function (h) { return h.some(function (x) { return x.indexOf('proceso de negociacion') === 0; }) && h.indexOf('marca temporal') >= 0; });
  var fbSh = findSheet_(main, CONFIG.FB_SHEET, CONFIG.FB_GID, function (h) { return h.indexOf('dni asesor') >= 0 && h.some(function (x) { return x.indexOf('actitud del agente') >= 0; }); });
  var dotSh = null;
  for (var b = 0; b < dotBooks.length && !dotSh; b++) {
    dotSh = (CONFIG.DOT_GID !== '' && CONFIG.DOT_GID != null ? findSheet_(dotBooks[b], '', CONFIG.DOT_GID, null) : null) ||
      findSheet_(dotBooks[b], CONFIG.DOT_SHEET, null, null) ||
      findSheet_(dotBooks[b], '', null, function (h) { return colIdx_(h, ['usuario_sprinklr', 'usuario sprinklr']) >= 0 && h.indexOf('estado') >= 0; });
  }

  var fbRows = fbSh ? fromHeader_(sheetValues_(fbSh), 'marca temporal') : [];
  var evaRows = evaSh ? fromHeader_(sheetValues_(evaSh), 'marca temporal') : [];
  var dotRows = dotSh ? fromHeader_(sheetValues_(dotSh), 'estado') : [];

  var fb = parseFeedback_(fbRows);
  var dot = parseDotacion_(dotRows);
  var eva = parseEva_(evaRows, fb);

  // nombre del agente en feedback: por DN (de la evaluación) o por DNI (dotación)
  var porDn = {}; eva.forEach(function (e) { if (e.dn) porDn[e.dn] = e; });
  var porDni = {}; dot.forEach(function (d) { if (d.dni && (!porDni[d.dni] || d.estado === 'ACTIVO')) porDni[d.dni] = d; });
  // Estado del agente según la dotación: Activo / Inactivo / Sin dotación (para el filtro del dashboard)
  var porUsr = {}, porNom = {};
  var clave = function (n) { return norm_(n).replace(/[^a-z ]/g, ' ').split(' ').filter(String).sort().join(' '); };
  // las cuentas de Sprinklr se reasignan: ante duplicados gana la fila ACTIVO
  dot.forEach(function (d) {
    if (d.usuario && (!porUsr[d.usuario] || d.estado === 'ACTIVO')) porUsr[d.usuario] = d;
    if (d.nombre && (!porNom[clave(d.nombre)] || d.estado === 'ACTIVO')) porNom[clave(d.nombre)] = d;
  });
  var estado = function (d) { return !d ? 'Sin dotación' : d.estado === 'ACTIVO' ? 'Activo' : 'Inactivo'; };
  // DNI del agente: la evaluación no lo trae, pero el feedback sí ("DNI Asesor") y comparte el DN de la llamada.
  // Se obtiene por DN y se extiende a todas las evaluaciones del mismo agente (por nombre).
  var dniPorNom = {};
  var fbPorDn = {}; fb.forEach(function (f) { if (f.dn && f.dni) fbPorDn[f.dn] = f.dni; });
  eva.forEach(function (e) { var dni = fbPorDn[e.dn]; if (dni && !dniPorNom[clave(e.agente)]) dniPorNom[clave(e.agente)] = dni; });
  eva.forEach(function (e) {
    var dniE = fbPorDn[e.dn] || dniPorNom[clave(e.agente)] || '';   // no se envía al navegador
    // prioridad: DNI → nombre → usuario de Sprinklr (las cuentas se reasignan, por eso va al final)
    e.estado = estado((dniE && porDni[dniE]) || porNom[clave(e.agente)] || porUsr[e.usuario]);
  });
  fb.forEach(function (f) {
    var e = porDn[f.dn], d = porDni[f.dni];
    f.agente = (d && d.nombre) || (e && e.agente) || f.dni;
    f.supervisor = (e && e.supervisor) || (d && d.supervisor) || '';
    f.estado = d ? estado(d) : e ? e.estado : 'Sin dotación';
  });

  return {
    eva: unificarSup_(eva, fb, dot) && eva, fb: fb, dot: dot,
    hojas: { eva: evaSh ? evaSh.getName() : null, fb: fbSh ? fbSh.getName() : null, dot: dotSh ? dotSh.getName() : null }
  };
}

function findSheet_(book, name, gid, test) {
  var sheets = book.getSheets();
  if (name) {
    for (var n = 0; n < sheets.length; n++) if (norm_(sheets[n].getName()) === norm_(name)) return sheets[n];
    if (!test) return null;
  }
  if (gid !== '' && gid != null) {
    for (var g = 0; g < sheets.length; g++) {
      if (sheets[g].getSheetId() !== Number(gid)) continue;
      if (!test) return sheets[g];
      var top0 = sheets[g].getLastRow() ? sheets[g].getRange(1, 1, Math.min(10, sheets[g].getLastRow()), sheets[g].getLastColumn()).getValues() : [];
      for (var t0 = 0; t0 < top0.length; t0++) if (test(top0[t0].map(norm_))) return sheets[g];
    }
  }
  if (!test) return null;
  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    if (sh.getLastRow() < 1 || sh.getLastColumn() < 1) continue;
    var top = sh.getRange(1, 1, Math.min(10, sh.getLastRow()), sh.getLastColumn()).getValues();
    for (var t = 0; t < top.length; t++) if (test(top[t].map(norm_))) return sh;
  }
  return null;
}

// Devuelve las filas desde la fila de encabezados (la primera, entre las 10 primeras, que contiene `clave`)
function fromHeader_(rows, clave) {
  for (var i = 0; i < Math.min(10, rows.length); i++) {
    if (rows[i].map(norm_).indexOf(clave) >= 0) return rows.slice(i);
  }
  return rows;
}

function sheetValues_(sh) {
  var lr = sh.getLastRow(), lc = sh.getLastColumn();
  if (lr < 2) return [sh.getRange(1, 1, 1, lc).getValues()[0]];
  return sh.getRange(1, 1, lr, lc).getValues();
}

/* ---------------- Utilidades ---------------- */

// Usuario de Sprinklr comparable: en la dotación aparece como "a365@sprinklr1/com" y en el forms "a365@sprinklr1.com"
function usr_(v) { return norm_(v).replace(/\//g, '.').replace(/\s+/g, ''); }

function norm_(s) {
  return String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function hash_(s) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'movout|' + s);
  return b.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
}

function colIdx_(head, keys) {
  for (var k = 0; k < keys.length; k++) {
    for (var i = 0; i < head.length; i++) if (head[i].indexOf(keys[k]) >= 0) return i;
  }
  return -1;
}

// Fechas en texto: d/m/aaaa o m/d/aaaa. `mdy` = true si la columna viene como mes/día/año
function toDate_(v, mdy) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000));
  if (!v) return null;
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    var a = +m[1], b = +m[2];
    var dia = mdy ? b : a, mes = mdy ? a : b;
    if (mes > 12 && dia <= 12) { var t = dia; dia = mes; mes = t; }
    return new Date(+m[3], mes - 1, dia, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  var d = new Date(s);
  return isNaN(d) ? null : d;
}

// Una respuesta de forms no puede tener fecha futura: si la hay y al invertir día y mes
// queda una fecha pasada, es un día/mes invertido (texto mal leído o la hoja con otro formato regional).
function noFuture_(d, ref) {
  if (!d) return d;
  var limite = new Date().getTime() + 86400000;
  var p = String(CONFIG.INICIO_OPERACION || '2000-01-01').split('-');
  var inicio = new Date(+p[0], +p[1] - 1, +p[2]).getTime();
  var valida = function (x) { return x.getTime() >= inicio && x.getTime() <= limite; };
  // Lectura alternativa con día y mes invertidos (solo si el día puede ser un mes)
  var inv = d.getDate() <= 12 && d.getDate() !== d.getMonth() + 1
    ? new Date(d.getFullYear(), d.getDate() - 1, d.getMonth() + 1, d.getHours(), d.getMinutes(), d.getSeconds()) : null;
  if (!inv) return d;
  var okD = valida(d), okI = valida(inv);
  if (okD && !okI) return d;
  if (okI && !okD) return inv;
  if (!okD && !okI) return d;
  // Ambas posibles: la más cercana a la fecha de referencia (fecha de llamada), si la hay
  if (ref) return Math.abs(inv - ref) < Math.abs(d - ref) ? inv : d;
  return d;
}

// Detecta si una columna de fechas en texto viene como mes/día/año
function colMdy_(rows, ci) {
  if (ci < 0) return false;
  var mdy = 0, dmy = 0;
  for (var r = 1; r < rows.length; r++) {
    var v = rows[r][ci];
    if (v instanceof Date || !v) continue;
    var m = String(v).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.]\d{4}/);
    if (!m) continue;
    if (+m[2] > 12) mdy++;
    else if (+m[1] > 12) dmy++;
  }
  return mdy > dmy;
}

function ymd_(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function semanaMes_(d) { return Math.min(5, Math.ceil(d.getDate() / 7)); }

function str_(v) { return v == null ? '' : String(v).trim(); }
// texto de una celda que debería traer un nombre: un 0 o un error de fórmula (#N/A, #REF!) cuenta como vacío
function txt_(v) { var t = str_(v); return /^[\d\s.,-]*$/.test(t) || /^#/.test(t) ? '' : t; }

function digits_(v) { return str_(v).replace(/\.0+$/, '').replace(/\D/g, ''); }

/* ---------------- Pauta de calidad ---------------- */

// [clave, etiqueta, bloque, peso Venta, peso No Venta, grupo PEC]
var ITEMS = [
  ['rompehielo', 'Pregunta Rompehielo', 'neg', 2, 15, 'NEG'],
  ['fluidez', 'Fluidez de la llamada', 'neg', 2, 10, 'ENC'],
  ['correcta entrega', 'Correcta información', 'neg', 2, 15, 'UF'],
  ['deteccion de necesidades', 'Detección de necesidades', 'neg', 2, 10, 'UF'],
  ['manejo de objecion', 'Manejo de Objeción', 'neg', 2, 15, 'NEG'],
  ['oferta del plan', 'Oferta del plan correcto', 'venta', 5, 0, 'UF'],
  ['validacion de datos', 'Validación de datos de portabilidad', 'venta', 8, 0, 'NEG'],
  ['claridad de la informacion', 'Claridad de la información', 'venta', 8, 0, 'UF'],
  ['cierre con aceptacion', 'Cierre con aceptación expresa', 'venta', 10, 0, 'UF'],
  ['curp', 'Solicita autorización de CURP', 'venta', 10, 0, 'UF'],
  ['aviso de privacidad', 'Aviso de privacidad', 'venta', 10, 0, 'NEG'],
  ['promocional tangible', 'Ofrece promocional tangible', 'venta', 20, 0, 'UF'],
  ['referidos', 'Solicitud de Referidos', 'cierre', 2, 7, 'CUM'],
  ['despedida', 'Despedida profesional', 'cierre', 2, 5, 'ENC'],
  ['tipificacion en discador', 'Correcta Tipificación en Discador', 'cierre', 5, 7, 'CUM'],
  ['leguaje', 'Lenguaje correcto, simple y claro', 'exp', 4, 8, 'UF'],
  ['clima cordial', 'Clima cordial y proyectar seguridad', 'exp', 4, 8, 'ENC']
];

var HABS = ['saludo', 'sondeo', 'argumentacion', 'rebate', 'cierre]'];

function parseEva_(rows, fb) {
  if (rows.length < 2) return [];
  var head = rows[0].map(norm_);
  var c = {
    ts: colIdx_(head, ['marca temporal']),
    agente: colIdx_(head, ['nombre completo']),
    usuario: colIdx_(head, ['usuario sprinklr']),
    dn: head.indexOf('dn') >= 0 ? head.indexOf('dn') : colIdx_(head, ['dn']),
    caso: colIdx_(head, ['numero de caso']),
    sup: colIdx_(head, ['supervisor']),
    camp: colIdx_(head, ['campana']),
    tipo: colIdx_(head, ['tipo de llamada']),
    detalle: colIdx_(head, ['detalle de llamada']),
    tipoEval: colIdx_(head, ['tipo de evaluacion']),
    fLlamada: colIdx_(head, ['fecha de llamada']),
    evaluador: colIdx_(head, ['evaluador']),
    planMayor: colIdx_(head, ['plan mayor']),
    tipoAgente: colIdx_(head, ['tipo de agente']),
    tipoCom: colIdx_(head, ['tipo de comunicacion']),
    objecion: colIdx_(head, ['objeccion del cliente', 'objecion del cliente']),
    causa: colIdx_(head, ['causa raiz']),
    siAg: colIdx_(head, ['si es agente']),
    siCl: colIdx_(head, ['si es cliente']),
    siPr: colIdx_(head, ['si es proceso']),
    tipif: colIdx_(head, ['cumplimiento de tipificacion']),
    dur: colIdx_(head, ['duracion de la llamada', 'duracion de llamada', 'tiempo de llamada'])
  };
  var itemCols = ITEMS.map(function (it) {
    var key = it[0] === 'leguaje' ? ['leguaje', 'lenguaje'] : [it[0]];
    for (var i = 0; i < head.length; i++) {
      if (head[i].indexOf('[') < 0 || head[i].indexOf('medicion') === 0) continue;
      for (var k = 0; k < key.length; k++) if (head[i].indexOf(key[k]) >= 0) return i;
    }
    return -1;
  });
  var habCols = HABS.map(function (h) {
    for (var i = 0; i < head.length; i++) if (head[i].indexOf('habilidades comerciales') >= 0 && head[i].indexOf(h) >= 0) return i;
    return -1;
  });

  var fbDn = {};
  fb.forEach(function (f) { if (f.dn) fbDn[f.dn] = (fbDn[f.dn] || 0) + 1; });

  var out = [];
  var mdyTs = colMdy_(rows, c.ts), mdyLl = colMdy_(rows, c.fLlamada);
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    var fLl = c.fLlamada >= 0 ? noFuture_(toDate_(row[c.fLlamada], mdyLl)) : null;
    var ts = noFuture_(toDate_(row[c.ts], mdyTs), fLl);
    if (!ts) continue;
    if (fLl) fLl = noFuture_(fLl, ts);
    var tipo = norm_(row[c.tipo]) === 'venta' ? 'Venta' : 'No Venta';
    var esVenta = tipo === 'Venta';
    var items = itemCols.map(function (ci) {
      var v = ci < 0 ? '' : norm_(row[ci]);
      return v === 'cumple' ? 'C' : v === 'no cumple' ? 'N' : 'A';
    });
    // Nota ponderada (igual a "Data EVA Formulado"): suma el peso si Cumple o No aplica
    var nota = 0, bloque = { neg: [], venta: [], cierre: [], exp: [] }, grupo = { UF: [], NEG: [], CUM: [], ENC: [] };
    ITEMS.forEach(function (it, i) {
      if (it[2] === 'venta' && !esVenta) return;
      var peso = esVenta ? it[3] : it[4];
      if (items[i] !== 'N') nota += peso;
      bloque[it[2]].push(items[i]);
      grupo[it[5]].push(items[i]);
    });
    var ok = function (arr) { return arr.indexOf('N') >= 0 ? 0 : 1; };
    var uf = ok(grupo.UF), ng = ok(grupo.NEG), cu = ok(grupo.CUM), enc = ok(grupo.ENC);
    var notaCum = (uf + ng + cu) / 3;
    var hab = habCols.map(function (ci) {
      var v = ci < 0 ? '' : norm_(row[ci]);
      if (v === 'efectivo' || v === 'lo hizo bien') return 1;
      if (v === 'parcial' || v === 'regular') return 0.5;
      if (v === 'inefectivo' || v === 'no lo hizo') return 0;
      return null;
    });
    var dn = digits_(row[c.dn]);
    var causa = str_(row[c.causa]);
    out.push({
      ts: ts.getTime(),
      fecha: ymd_(ts), mes: ymd_(ts).slice(0, 7), sem: semanaMes_(ts),
      fLlamada: fLl ? ymd_(fLl) : '',
      agente: str_(row[c.agente]), usuario: usr_(row[c.usuario]), dn: dn,
      caso: str_(row[c.caso]), supervisor: str_(row[c.sup]), campana: str_(row[c.camp]),
      tipo: tipo, tipoEval: str_(row[c.tipoEval]), evaluador: str_(row[c.evaluador]),
      dur: c.dur < 0 ? '' : duracion_(row[c.dur]),
      items: items.join(''),
      nota: nota / 100,
      cNeg: ok(bloque.neg), cVenta: esVenta ? ok(bloque.venta) : null, cCierre: ok(bloque.cierre), cExp: ok(bloque.exp),
      uf: uf, ecNeg: ng, ecCum: cu, enc: enc,
      notaCum: notaCum, pec: Math.max(0, notaCum - (enc ? 0 : 0.1)),
      hab: hab,
      planMayor: str_(row[c.planMayor]), tipoAgente: str_(row[c.tipoAgente]), tipoCom: str_(row[c.tipoCom]),
      objecion: str_(row[c.objecion]).toUpperCase(),
      causa: causa ? causa.charAt(0).toUpperCase() + causa.slice(1).toLowerCase() : '',
      motivo: str_(row[c.siPr]) || str_(row[c.siAg]) || str_(row[c.siCl]),
      tipificacion: str_(row[c.tipif]),
      detalle: str_(row[c.detalle]).slice(0, 600),
      fb: fbDn[dn] ? 1 : 0
    });
  }
  return out;
}

function parseFeedback_(rows) {
  if (rows.length < 2) return [];
  var head = rows[0].map(norm_);
  var c = {
    ts: colIdx_(head, ['marca temporal']),
    dni: colIdx_(head, ['dni asesor']),
    quien: colIdx_(head, ['quien realiza']),
    camp: colIdx_(head, ['campana']),
    dn: head.indexOf('dn'),
    evaluador: colIdx_(head, ['nombre de quien te dio']),
    aQuien: colIdx_(head, ['a quien le diste']),
    acuerdo: colIdx_(head, ['estas de acuerdo']),
    compromiso: colIdx_(head, ['te comprometes']),
    motivo: colIdx_(head, ['motivo por el cual']),
    actitud: colIdx_(head, ['actitud del agente']),
    obs: colIdx_(head, ['alguna observacion']),
    evid: colIdx_(head, ['evidencia'])
  };
  var out = [];
  var mdyTs = colMdy_(rows, c.ts);
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    var ts = noFuture_(toDate_(row[c.ts], mdyTs));
    if (!ts || !str_(row[c.dni])) continue;
    out.push({
      ts: ts.getTime(), fecha: ymd_(ts), mes: ymd_(ts).slice(0, 7), sem: semanaMes_(ts),
      dni: digits_(row[c.dni]), quien: str_(row[c.quien]), campana: str_(row[c.camp]),
      dn: digits_(row[c.dn]), evaluador: str_(row[c.evaluador]), aQuien: str_(row[c.aQuien]),
      acuerdo: str_(row[c.acuerdo]), compromiso: str_(row[c.compromiso]),
      motivo: str_(row[c.motivo]), actitud: str_(row[c.actitud]),
      obs: str_(row[c.obs]).slice(0, 600), evidencia: str_(row[c.evid])
    });
  }
  return out;
}

// Solo se leen columnas necesarias: nunca se envían usuarios/contraseñas de sistemas.
function parseDotacion_(rows) {
  if (rows.length < 2) return [];
  var head = rows[0].map(norm_);
  var c = {
    usuario: colIdx_(head, ['usuario_sprinklr', 'usuario sprinklr']),
    dni: head.indexOf('dni'),
    nombre: colIdx_(head, ['apellidos y nombres', 'apellidos_y_nombres', 'nombres y apellidos', 'nombres_y_apellidos',
      'nombre completo', 'nombre_completo', 'nombre_sprinklr', 'nombre sprinklr', 'nombres', 'nombre', 'agente', 'asesor']),
    cargo: head.indexOf('cargo'),
    cargo2: colIdx_(head, ['cargo_a365', 'cargo a365']),
    camp: colIdx_(head, ['campana']),
    estado: head.indexOf('estado'),
    jefe: colIdx_(head, ['jefe_directo', 'jefe directo', 'supervisor']),
    ingreso: colIdx_(head, ['fecha_ingreso', 'fecha ingreso', 'f ingreso']),
    baja: colIdx_(head, ['fecha_baja', 'fecha baja', 'f baja'])
  };
  // Usuario de Sprinklr: si el encabezado no lo dice, la columna cuyos valores parecen "...@sprinklr..."
  var esSpr = function (ci) { var n = 0; for (var r = 1; r < Math.min(rows.length, 60); r++) if (/@sprinklr/i.test(String(rows[r][ci] || ''))) n++; return n; };
  if (c.usuario < 0 || esSpr(c.usuario) === 0) {
    var mejor = -1, max = 0;
    for (var ci = 0; ci < head.length; ci++) { var k = esSpr(ci); if (k > max) { max = k; mejor = ci; } }
    if (mejor >= 0) c.usuario = mejor;
  }
  // Nombre: si hay columnas separadas de apellidos y nombres, se arma "Apellidos Nombres"
  var cApe = head.indexOf('apellidos'), cNom = head.indexOf('nombres');
  var out = [];
  var mdyIng = colMdy_(rows, c.ingreso), mdyBaja = colMdy_(rows, c.baja);
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    var u = c.usuario >= 0 ? usr_(row[c.usuario]) : '';
    var nombreArmado = cApe >= 0 && cNom >= 0 ? (txt_(row[cApe]) + ' ' + txt_(row[cNom])).trim() : '';
    if (!u && !nombreArmado && !digits_(row[c.dni])) continue;
    var ing = c.ingreso >= 0 ? toDate_(row[c.ingreso], mdyIng) : null;
    var baja = c.baja >= 0 ? toDate_(row[c.baja], mdyBaja) : null;
    out.push({
      usuario: u, dni: digits_(row[c.dni]), nombre: (nombreArmado || txt_(row[c.nombre])).replace(/\s+/g, ' '),
      cargo: (str_(row[c.cargo]) + ' ' + (c.cargo2 >= 0 ? str_(row[c.cargo2]) : '')).trim(), campana: txt_(row[c.camp]), estado: str_(row[c.estado]).toUpperCase(),
      supervisor: txt_(row[c.jefe]),
      ingreso: ing ? ymd_(ing) : '', baja: baja ? ymd_(baja) : ''
    });
  }
  return out;
}

/* ---------------- Seguimiento de monitoreos ---------------- */

// Un nombre de agente válido: texto corto, sin frases (descarta respuestas corridas de columna)
function nombreOk_(n) { n = txt_(n); return n && n.length <= 70 && !/[:"“”?¿!]/.test(n) && n.split(' ').length <= 8 ? n : ''; }
function estadoTxt_(e) { e = String(e || '').toUpperCase(); return e === 'ACTIVO' ? 'Activo' : !e || e === 'NO EN DOTACIÓN' ? 'Sin dotación' : 'Inactivo'; }

function excluirJefe_(sup, cfg) {
  var n = norm_(sup);
  return !!n && (cfg.EXCLUIR_JEFES || []).some(function (j) { var k = norm_(j); return n === k || n.indexOf(k) === 0; });
}

// Unifica nombres de supervisor escritos distinto ("Jorge Cribillero" / "Jorge Cribilleros"):
// misma clave sin acentos ni "s" final por palabra → se usa la forma más frecuente
function unificarSup_(eva, fb, dot) {
  var clave = function (n) { return norm_(n).split(' ').map(function (w) { return w.replace(/s$/, ''); }).join(' '); };
  var cnt = {};
  [eva, fb, dot].forEach(function (arr) { arr.forEach(function (x) { if (x.supervisor) { var k = clave(x.supervisor); (cnt[k] = cnt[k] || {})[x.supervisor] = (cnt[k][x.supervisor] || 0) + 1; } }); });
  var canon = {};
  Object.keys(cnt).forEach(function (k) { canon[k] = Object.keys(cnt[k]).sort(function (a, b) { return cnt[k][b] - cnt[k][a]; })[0]; });
  [eva, fb, dot].forEach(function (arr) { arr.forEach(function (x) { if (x.supervisor) x.supervisor = canon[clave(x.supervisor)]; }); });
  return true;
}

function buildMonitoreo_(eva, fb, dot, cfg) {
  var hoy = ymd_(new Date());
  var meses = {};
  eva.forEach(function (e) { meses[e.mes] = 1; });
  fb.forEach(function (f) { meses[f.mes] = 1; });

  // Agentes: dotación de ejecutivos, o en su defecto los agentes evaluados
  var agentes = {}, excluidos = {};
  // nombre según las evaluaciones, por si la dotación no lo trae
  var nombreEva = {};
  eva.forEach(function (e) { var n = nombreOk_(e.agente); if (e.usuario && n && !nombreEva[e.usuario]) nombreEva[e.usuario] = n; });
  dot.forEach(function (d) {
    if (!/ejecutivo|asesor|agente/i.test(d.cargo) && d.cargo) return;
    if ((cfg.EXCLUIR_CARGOS && cfg.EXCLUIR_CARGOS.test(d.cargo)) || excluirJefe_(d.supervisor, cfg)) { if (d.usuario) excluidos[d.usuario] = 1; return; }
    if (!d.usuario || (agentes[d.usuario] && d.estado !== 'ACTIVO')) return;
    agentes[d.usuario] = { usuario: d.usuario, dni: d.dni, nombre: nombreOk_(d.nombre) || nombreEva[d.usuario] || '', campana: d.campana, supervisor: d.supervisor, estado: estadoTxt_(d.estado), ingreso: d.ingreso, baja: d.baja };
  });
  eva.forEach(function (e) {
    var k = e.usuario || norm_(e.agente);
    if (excluidos[k] || excluirJefe_(e.supervisor, cfg)) return;
    if (!agentes[k]) agentes[k] = { usuario: k, dni: '', nombre: nombreEva[k] || nombreOk_(e.agente), campana: e.campana, supervisor: e.supervisor, estado: dot.length ? (e.estado || 'Sin dotación') : 'Activo', ingreso: '', baja: '' };
  });

  var fbPorDn = {};
  fb.forEach(function (f) { if (f.dn) fbPorDn[f.dn] = f; });

  // Conteo por agente / mes / semana
  var cnt = {};
  eva.forEach(function (e) {
    var k = (e.usuario || norm_(e.agente)) + '|' + e.mes + '|' + e.sem;
    var o = cnt[k] || (cnt[k] = { v: 0, nv: 0, fb: 0 });
    if (e.tipo === 'Venta') o.v++; else o.nv++;
    if (e.fb) o.fb++;
  });

  var evaMes = {};
  eva.forEach(function (e) { evaMes[(e.usuario || norm_(e.agente)) + '|' + e.mes] = 1; });
  var filas = [];
  Object.keys(meses).sort().forEach(function (mes) {
    var y = +mes.slice(0, 4), m = +mes.slice(5, 7);
    var ultimo = new Date(y, m, 0).getDate();
    Object.keys(agentes).forEach(function (k) {
      var a = agentes[k];
      var semanas = [];
      var tieneAlgo = false;
      for (var s = 1; s <= 5; s++) {
        var ini = mes + '-' + ('0' + ((s - 1) * 7 + 1)).slice(-2);
        var finDia = s === 5 ? ultimo : s * 7;
        if ((s - 1) * 7 + 1 > ultimo) { semanas.push(null); continue; }
        var fin = mes + '-' + ('0' + finDia).slice(-2);
        // Programación del mes completo: todas las semanas (incluida la 29-31) desde el día 1,
        // mientras el agente esté vigente (ingreso / baja) en esa semana
        var activo = (!a.ingreso || a.ingreso <= fin) && (!a.baja || a.baja >= ini);
        var o = cnt[k + '|' + mes + '|' + s] || { v: 0, nv: 0, fb: 0 };
        // Solo se programa a los activos; a los que no están en la dotación, solo si tienen evaluaciones ese mes
        var programable = a.estado === 'Activo' || (a.estado === 'Sin dotación' && evaMes[k + '|' + mes]);
        var prog = programable && activo ? cfg.EVAS_PROG_SEMANA : 0;
        if (a.baja && a.baja < ini) prog = 0;
        if (prog || o.v || o.nv) tieneAlgo = true;
        semanas.push({ prog: prog, v: o.v, nv: o.nv, fb: o.fb });
      }
      if (!tieneAlgo || !a.nombre) return;   // sin nombre (ni en dotación ni en evaluaciones) no se muestra
      filas.push({ mes: mes, usuario: a.usuario, dni: a.dni, nombre: a.nombre, campana: a.campana, supervisor: a.supervisor, estado: a.estado, semanas: semanas });
    });
  });

  // Productividad por monitor y día
  var dia = {};
  eva.forEach(function (e) {
    var k = e.fecha + '|' + e.evaluador;
    (dia[k] || (dia[k] = { fecha: e.fecha, mes: e.mes, sem: e.sem, monitor: e.evaluador, evas: 0, fbs: 0 })).evas++;
  });
  fb.forEach(function (f) {
    var k = f.fecha + '|' + f.evaluador;
    (dia[k] || (dia[k] = { fecha: f.fecha, mes: f.mes, sem: f.sem, monitor: f.evaluador, evas: 0, fbs: 0 })).fbs++;
  });

  // Evaluaciones con "No Cumple" que aún no tienen feedback
  var pendientes = eva.filter(function (e) { return !e.fb && e.items.indexOf('N') >= 0 && txt_(e.agente); }).map(function (e) {
    return { fecha: e.fecha, mes: e.mes, sem: e.sem, agente: nombreOk_(e.agente) || e.agente, estado: e.estado, supervisor: e.supervisor, campana: e.campana, evaluador: e.evaluador, dn: e.dn, caso: e.caso, nota: e.nota };
  });

  return {
    meses: Object.keys(meses).sort(),
    progSemana: cfg.EVAS_PROG_SEMANA,
    metaDiaria: cfg.META_DIARIA_MONITOR,
    usaDotacion: dot.length > 0,
    agentes: filas,
    dias: Object.keys(dia).map(function (k) { return dia[k]; }).filter(function (d) { return d.monitor; }),
    pendientes: pendientes
  };
}
