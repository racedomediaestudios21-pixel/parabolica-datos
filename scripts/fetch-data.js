/**
 * Este script lo ejecuta GitHub Actions solo, cada hora.
 * Descarga la programación real de tvguia.es y el ránking de audiencias de
 * Barlovento Comunicación, y los guarda como JSON en /data.
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const TVGUIA_CHANNELS = {
  la1: 'la-1', la2: 'la-2', ant3: 'antena-3', cuatro: 'cuatro',
  tele5: 'telecinco', lasexta: 'la-sexta', fdf: 'fdf', neox: 'neox', divinity: 'divinity',
};

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9',
};

function guessGenre(title) {
  const t = title.toLowerCase();
  if (/noticias|telediario|informativ/.test(t)) return 'Informativo';
  if (/cine|película/.test(t)) return 'Cine';
  if (/concurso|millón|pasapalabra|ruleta/.test(t)) return 'Concurso';
  if (/serie|temporada/.test(t)) return 'Ficción';
  if (/deporte/.test(t)) return 'Deportivo';
  if (/tiempo|meteo/.test(t)) return 'Meteorológico';
  return 'Programa';
}

function colorFor(seed) {
  const palette = ['#e51c23', '#f0a83a', '#3ecf8e', '#7d3ac1', '#00a8e8', '#ff7a00', '#c8102e', '#0a3d62', '#39a935', '#d63384'];
  let hash = 0;
  for (const ch of String(seed)) hash = (hash * 31 + ch.charCodeAt(0)) % palette.length;
  return palette[hash];
}

async function fetchChannelSchedule(slug) {
  const url = `https://www.tvguia.es/tv/programacion-${slug}`;
  const { data: html } = await axios.get(url, {
    headers: { ...BROWSER_HEADERS, Referer: 'https://www.tvguia.es/' },
    timeout: 15000,
  });
  const $ = cheerio.load(html);

  // Cada programa genera 3 enlaces consecutivos con el MISMO href:
  // uno con la hora, uno con el título (en negrita) y uno con la descripción.
  // Los agrupamos por href (que es único por emisión) y separamos hora/título.
  const groups = []; // [{href, texts:[]}]
  $('a[href*="/programacion/"]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!text) return;
    const last = groups[groups.length - 1];
    if (last && last.href === href) {
      last.texts.push(text);
    } else {
      groups.push({ href, texts: [text] });
    }
  });

  const items = [];
  for (const g of groups) {
    const timeText = g.texts.find(t => /^\d{1,2}:\d{2}$/.test(t));
    if (!timeText) continue;
    // El título es el texto corto que no es la hora ni la descripción larga
    const candidates = g.texts.filter(t => t !== timeText);
    const title = candidates.sort((a, b) => a.length - b.length)[0];
    if (!title || title.length > 90) continue;
    items.push({ time: timeText, title });
  }

  console.log(`  (debug ${slug}) status ok, HTML: ${html.length} caracteres, programas encontrados: ${items.length}`);
  return items;
}

async function buildParrilla() {
  const entries = await Promise.all(
    Object.entries(TVGUIA_CHANNELS).map(async ([id, slug]) => {
      try {
        const items = await fetchChannelSchedule(slug);
        return [id, items.map(i => ({ t: i.time, p: i.title, g: guessGenre(i.title) }))];
      } catch (err) {
        console.error(`Aviso: no se pudo leer ${id} (${err.message})`);
        return [id, []];
      }
    })
  );
  const channels = Object.fromEntries(entries.filter(([, v]) => v.length > 0));
  return { channels, updatedAt: new Date().toISOString() };
}

const MONTHS_ES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

function parseDataDate(text) {
  // Barlovento publica cada mañana los datos del día ANTERIOR. La propia
  // página dice explícitamente qué día describe (ej. "ayer lunes 10 de
  // agosto de 2026"), así que usamos ESA fecha literal en vez de calcularla
  // nosotros — evita confusiones de zona horaria o de cuándo corre el robot.
  const m = text.match(/ayer\s+\w+\s+(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthKey = m[2].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const month = MONTHS_ES[monthKey];
  const year = parseInt(m[3], 10);
  if (!month) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseMasVisto(text) {
  const m = text.match(/LO MÁS VISTO de ayer[^.]*?fue\s+([^,]+?),\s*emitido en\s+([\wÀ-ÿ]+)\s+a las\s+(\d{1,2}:\d{2})\s*horas\./i);
  if (!m) return null;
  // Tomamos los siguientes ~250 caracteres tal cual (sin cortar por punto,
  // porque los números como "1.737.000" ya llevan puntos que confundirían
  // a un patrón que buscara el primer punto como final de frase).
  const restStart = m.index + m[0].length;
  const rest = text.slice(restStart, restStart + 250);
  const viewersMatch = rest.match(/([\d.]{4,})\s*(?:espectadores|individuos)/);
  const shareMatch = rest.match(/(\d{1,2}(?:,\d)?)\s*%/);
  return {
    prog: m[1].trim(),
    chan: m[2].trim(),
    time: m[3],
    viewers: viewersMatch ? parseInt(viewersMatch[1].replace(/\./g, ''), 10) : null,
    share: shareMatch ? parseFloat(shareMatch[1].replace(',', '.')) : null,
  };
}

function parseMinutoOro(text) {
  const m = text.match(/MINUTO DE ORO de la jornada de ayer se registr[oó]\s+a las\s+(\d{1,2}:\d{2})\s*horas durante la emisi[oó]n en\s+([\wÀ-ÿ]+)\s+de\s+([^.]+?)\.\s*En ese instante,\s*([\d.]{4,})\s*espectadores/i);
  if (!m) return null;
  return { time: m[1], chan: m[2].trim(), prog: m[3].trim(), viewers: parseInt(m[4].replace(/\./g, ''), 10) };
}

function parsePrimeTime(text) {
  const re = /\d+\.\s*\(([^)]+)\)\s*([^:<]+?)(?:<([^>]+)>)?\s*:\s*(\d{1,2}(?:,\d)?)%\s*y\s*([\d.]+)\./g;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null && out.length < 8) {
    const prog = m[2].trim() + (m[3] ? ` <${m[3].trim()}>` : '');
    out.push({
      chan: m[1].trim(),
      prog,
      share: parseFloat(m[4].replace(',', '.')),
      viewers: parseInt(m[5].replace(/\./g, ''), 10) / 1000000, // en millones, como ya usa el panel
    });
  }
  return out;
}

function parseConsumo(text) {
  const m = text.match(/consumo televisivo de ayer[^0-9]*?fue de\s*(\d{2,3})\s*minutos por individuo/i);
  return m ? parseInt(m[1], 10) : null;
}

function parseEspectadoresTotales(text) {
  const m = text.match(/En la jornada de ayer,\s*([\d.]+)\s*españoles vieron al menos un minuto de televisi[oó]n,\s*lo que representa el\s*(\d{1,2}(?:,\d)?)%/i);
  if (!m) return null;
  return { viewers: parseInt(m[1].replace(/\./g, ''), 10), percent: parseFloat(m[2].replace(',', '.')) };
}

async function fetchAudiencias() {
  const url = 'https://barloventocomunicacion.es/audiencias-tv-ayer/';
  const { data: html } = await axios.get(url, {
    headers: { ...BROWSER_HEADERS, Referer: 'https://www.google.com/' },
    timeout: 15000,
  });
  const $ = cheerio.load(html);
  const bodyText = $('body').text();

  // En vez de capturar CUALQUIER texto seguido de "/ NN%" (lo que a veces
  // arrastraba titulares o menús pegados sin espacio), solo reconocemos las
  // cadenas/categorías que Barlovento reporta habitualmente. Así se evita
  // capturar texto suelto de la página por error.
  const LABELS = [
    'LA SEXTA', 'TEMATICAS PAGO', 'TEMÁTICAS PAGO', 'CUATRO',
    'LA 1', 'LA 2', 'LA1', 'LA2', 'ANTENA 3', 'A3',
    'T5', 'TELECINCO', 'AUTONOMICAS', 'AUTONÓMICAS', 'AUT', 'FORTA',
  ];
  const LABEL_DISPLAY = {
    A3: 'Antena 3', ANTENA3: 'Antena 3',
    T5: 'Telecinco', TELECINCO: 'Telecinco',
    LA1: 'La 1', LA2: 'La 2',
    CUATRO: 'Cuatro',
    LASEXTA: 'laSexta',
    AUT: 'Autonómicas (FORTA)', AUTONOMICAS: 'Autonómicas (FORTA)', FORTA: 'Autonómicas (FORTA)',
    TEMATICASPAGO: 'Temáticas de Pago',
  };
  function normLabel(s) {
    return s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');
  }

  const escaped = LABELS
    .map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length); // los de varias palabras primero
  const re = new RegExp('(' + escaped.join('|') + ')\\s*/\\s*(\\d{1,2}(?:,\\d)?)\\s*%', 'gi');

  const ranking = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(bodyText)) !== null) {
    const norm = normLabel(m[1]);
    const display = LABEL_DISPLAY[norm] || m[1].trim();
    if (seen.has(display)) continue;
    const share = parseFloat(m[2].replace(',', '.'));
    if (share > 100) continue;
    seen.add(display);
    ranking.push({ name: display, share, color: colorFor(display) });
  }
  ranking.sort((a, b) => b.share - a.share);

  const dataDate = parseDataDate(bodyText);
  const masVisto = parseMasVisto(bodyText);
  const minutoOro = parseMinutoOro(bodyText);
  const prime = parsePrimeTime(bodyText);
  const consumoMin = parseConsumo(bodyText);
  const espectadoresTotales = parseEspectadoresTotales(bodyText);

  console.log(`  (debug audiencias) status ok, HTML: ${html.length} caracteres, filas de ránking: ${ranking.length}, fecha de los datos: ${dataDate || 'no detectada'}, lo más visto: ${masVisto ? masVisto.prog : 'no detectado'}, prime time: ${prime.length} filas`);

  return {
    ranking,
    dataDate,           // fecha REAL que describen los datos (día anterior a la publicación)
    masVisto,
    minutoOro,
    prime,
    consumoMin,
    espectadoresTotales,
    updatedAt: new Date().toISOString(), // momento en que el robot corrió (para mostrar "actualizado hace...")
  };
}

async function fetchNoticias() {
  const url = 'https://laparabolica.tv/';
  const { data: html } = await axios.get(url, {
    headers: { ...BROWSER_HEADERS, Referer: 'https://www.google.com/' },
    timeout: 15000,
  });
  const $ = cheerio.load(html);

  const items = [];
  const seen = new Set();
  $('a[href^="https://laparabolica.tv/"]').each((_, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    // Descartamos enlaces de navegación (secciones, autores, la home) y quedarnos
    // solo con enlaces a artículos reales, con un titular de longitud razonable.
    if (!href || seen.has(href)) return;
    if (/\/(secciones|author)\//.test(href)) return;
    if (href === url || href === url.slice(0, -1)) return;
    if (text.length < 20 || text.length > 160) return;
    seen.add(href);
    items.push({ t: text, u: href });
    if (items.length >= 10) return false;
  });

  console.log(`  (debug noticias) status ok, HTML: ${html.length} caracteres, titulares encontrados: ${items.length}`);
  return { items, updatedAt: new Date().toISOString() };
}

async function main() {
  const outDir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(outDir, { recursive: true });

  try {
    const parrilla = await buildParrilla();
    fs.writeFileSync(path.join(outDir, 'parrilla.json'), JSON.stringify(parrilla, null, 2));
    console.log(`✓ parrilla.json guardado (${Object.keys(parrilla.channels).length} canales)`);
  } catch (err) {
    console.error('✗ Error generando parrilla.json:', err.message);
  }

  let audiencias = null;
  try {
    audiencias = await fetchAudiencias();
    fs.writeFileSync(path.join(outDir, 'audiencias.json'), JSON.stringify(audiencias, null, 2));
    console.log(`✓ audiencias.json guardado (${audiencias.ranking.length} cadenas)`);
  } catch (err) {
    console.error('✗ Error generando audiencias.json:', err.message);
  }

  // Histórico: guardamos un snapshot por día (se queda con los últimos 30 días).
  // Usamos la fecha REAL que describen los datos (dataDate), no la fecha en la
  // que corrió el robot — evita el desfase de un día que causaba confusión.
  if (audiencias && audiencias.ranking.length) {
    try {
      const historialPath = path.join(outDir, 'audiencias-historial.json');
      let historial = [];
      if (fs.existsSync(historialPath)) {
        try { historial = JSON.parse(fs.readFileSync(historialPath, 'utf8')); } catch (e) { historial = []; }
      }
      const entryDate = audiencias.dataDate || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const entry = {
        date: entryDate,
        ranking: audiencias.ranking.slice(0, 8),
        masVisto: audiencias.masVisto,
        minutoOro: audiencias.minutoOro,
        prime: audiencias.prime,
        consumoMin: audiencias.consumoMin,
        espectadoresTotales: audiencias.espectadoresTotales,
      };
      historial = historial.filter(h => h.date !== entryDate); // evita duplicar si corre varias veces el mismo día
      historial.push(entry);
      historial.sort((a, b) => a.date.localeCompare(b.date));
      historial = historial.slice(-30);
      fs.writeFileSync(historialPath, JSON.stringify(historial, null, 2));
      console.log(`✓ audiencias-historial.json actualizado (${historial.length} días guardados, último: ${entryDate})`);
    } catch (err) {
      console.error('✗ Error actualizando el histórico de audiencias:', err.message);
    }
  }

  try {
    const noticias = await fetchNoticias();
    fs.writeFileSync(path.join(outDir, 'noticias.json'), JSON.stringify(noticias, null, 2));
    console.log(`✓ noticias.json guardado (${noticias.items.length} titulares)`);
  } catch (err) {
    console.error('✗ Error generando noticias.json:', err.message);
  }
}

main();
