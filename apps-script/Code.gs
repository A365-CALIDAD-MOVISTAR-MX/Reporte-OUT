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
  DOT_SPREADSHEET_ID: '',
  // Pestaña exacta por su gid (el número después de "gid=" en el link). Vacío = se busca por nombre o encabezados
  EVA_GID: 1565779780,
  FB_GID: 1618586159,
  // Nombres de pestaña. Vacío = se detectan solas por sus encabezados
  EVA_SHEET: '',
  FB_SHEET: '',
  DOT_SHEET: 'dota',
  // Metas del seguimiento de monitoreos
  EVAS_PROG_SEMANA: 2,       // evaluaciones programadas por agente por semana
  META_DIARIA_MONITOR: 25,   // feedbacks/evaluaciones diarias por monitor
  CACHE_SEGUNDOS: 120,
  TZ: 'America/Mexico_City'
};

/* ---------------- Web App ---------------- */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Dashboard Calidad MOV OUT')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Ejecutar UNA vez desde el editor para fijar la clave de la pestaña Monitoreo. */
function configurarClave() {
  var clave = 'CAMBIAR_ESTA_CLAVE';
  if (clave === 'CAMBIAR_ESTA_CLAVE') throw new Error('Edita la variable "clave" antes de ejecutar.');
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
  var evaBook = CONFIG.EVA_SPREADSHEET_ID ? SpreadsheetApp.openById(CONFIG.EVA_SPREADSHEET_ID) : SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  evaBook.getSheets().forEach(function (sh) {
    var lc = Math.max(1, Math.min(sh.getLastColumn(), 12));
    var lr = Math.max(1, Math.min(sh.getLastRow(), 2));
    var top = sh.getRange(1, 1, lr, lc).getDisplayValues().map(function (r) { return r.map(function (x) { return String(x).slice(0, 30); }).join(' | '); });
    Logger.log('Libro pauta → pestaña "' + sh.getName() + '" gid=' + sh.getSheetId() + ' filas=' + sh.getLastRow() + ' | encabezados: ' + top.join(' // '));
  });
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
    dotSh = findSheet_(dotBooks[b], CONFIG.DOT_SHEET, null, null) ||
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
  var porDni = {}; dot.forEach(function (d) { if (d.dni) porDni[d.dni] = d; });
  fb.forEach(function (f) {
    var e = porDn[f.dn], d = porDni[f.dni];
    f.agente = (d && d.nombre) || (e && e.agente) || f.dni;
    f.supervisor = (e && e.supervisor) || (d && d.supervisor) || '';
  });

  return {
    eva: eva, fb: fb, dot: dot,
    hojas: { eva: evaSh ? evaSh.getName() : null, fb: fbSh ? fbSh.getName() : null, dot: dotSh ? dotSh.getName() : null }
  };
}

function findSheet_(book, name, gid, test) {
  var sheets = book.getSheets();
  if (name) {
    for (var n = 0; n < sheets.length; n++) if (norm_(sheets[n].getName()) === norm_(name)) return sheets[n];
    if (!test) return null;
  }
  if (gid) {
    for (var g = 0; g < sheets.length; g++) if (sheets[g].getSheetId() === Number(gid)) return sheets[g];
  }
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

function toDate_(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000));
  if (!v) return null;
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  var d = new Date(s);
  return isNaN(d) ? null : d;
}

function ymd_(d) {
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

function semanaMes_(d) { return Math.min(5, Math.ceil(d.getDate() / 7)); }

function str_(v) { return v == null ? '' : String(v).trim(); }

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
    tipif: colIdx_(head, ['cumplimiento de tipificacion'])
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
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    var ts = toDate_(row[c.ts]);
    if (!ts) continue;
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
    var fLl = c.fLlamada >= 0 ? toDate_(row[c.fLlamada]) : null;
    var dn = digits_(row[c.dn]);
    var causa = str_(row[c.causa]);
    out.push({
      ts: ts.getTime(),
      fecha: ymd_(ts), mes: ymd_(ts).slice(0, 7), sem: semanaMes_(ts),
      fLlamada: fLl ? ymd_(fLl) : '',
      agente: str_(row[c.agente]), usuario: norm_(row[c.usuario]), dn: dn,
      caso: str_(row[c.caso]), supervisor: str_(row[c.sup]), campana: str_(row[c.camp]),
      tipo: tipo, tipoEval: str_(row[c.tipoEval]), evaluador: str_(row[c.evaluador]),
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
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    var ts = toDate_(row[c.ts]);
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
    nombre: colIdx_(head, ['apellidos y nombres', 'nombre completo', 'nombre_sprinklr']),
    cargo: head.indexOf('cargo'),
    camp: colIdx_(head, ['campana']),
    estado: head.indexOf('estado'),
    jefe: colIdx_(head, ['jefe_directo', 'jefe directo', 'supervisor']),
    ingreso: colIdx_(head, ['fecha_ingreso', 'fecha ingreso', 'f ingreso']),
    baja: colIdx_(head, ['fecha_baja', 'fecha baja', 'f baja'])
  };
  var out = [];
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    var u = norm_(row[c.usuario]);
    if (!u) continue;
    var ing = c.ingreso >= 0 ? toDate_(row[c.ingreso]) : null;
    var baja = c.baja >= 0 ? toDate_(row[c.baja]) : null;
    out.push({
      usuario: u, dni: digits_(row[c.dni]), nombre: str_(row[c.nombre]).replace(/\s+/g, ' '),
      cargo: str_(row[c.cargo]), campana: str_(row[c.camp]), estado: str_(row[c.estado]).toUpperCase(),
      supervisor: str_(row[c.jefe]),
      ingreso: ing ? ymd_(ing) : '', baja: baja ? ymd_(baja) : ''
    });
  }
  return out;
}

/* ---------------- Seguimiento de monitoreos ---------------- */

function buildMonitoreo_(eva, fb, dot, cfg) {
  var hoy = ymd_(new Date());
  var meses = {};
  eva.forEach(function (e) { meses[e.mes] = 1; });
  fb.forEach(function (f) { meses[f.mes] = 1; });

  // Agentes: dotación de ejecutivos, o en su defecto los agentes evaluados
  var agentes = {};
  dot.forEach(function (d) {
    if (!/ejecutivo|asesor|agente/i.test(d.cargo) && d.cargo) return;
    agentes[d.usuario] = { usuario: d.usuario, dni: d.dni, nombre: d.nombre, campana: d.campana, supervisor: d.supervisor, estado: d.estado, ingreso: d.ingreso, baja: d.baja };
  });
  eva.forEach(function (e) {
    var k = e.usuario || norm_(e.agente);
    if (!agentes[k]) agentes[k] = { usuario: k, dni: '', nombre: e.agente, campana: e.campana, supervisor: e.supervisor, estado: dot.length ? 'NO EN DOTACIÓN' : 'ACTIVO', ingreso: '', baja: '' };
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
        var activo = (!a.ingreso || a.ingreso <= fin) && (!a.baja || a.baja >= ini) && ini <= hoy;
        // la semana 5 (días 29-31) solo programa si el agente ya tiene evaluaciones ahí
        var o = cnt[k + '|' + mes + '|' + s] || { v: 0, nv: 0, fb: 0 };
        var prog = activo && (s < 5 || o.v + o.nv > 0) && a.estado !== 'INACTIVO' ? cfg.EVAS_PROG_SEMANA : 0;
        if (a.baja && a.baja < ini) prog = 0;
        if (prog || o.v || o.nv) tieneAlgo = true;
        semanas.push({ prog: prog, v: o.v, nv: o.nv, fb: o.fb });
      }
      if (!tieneAlgo) return;
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
  var pendientes = eva.filter(function (e) { return !e.fb && e.items.indexOf('N') >= 0; }).map(function (e) {
    return { fecha: e.fecha, mes: e.mes, sem: e.sem, agente: e.agente, supervisor: e.supervisor, campana: e.campana, evaluador: e.evaluador, dn: e.dn, caso: e.caso, nota: e.nota };
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
