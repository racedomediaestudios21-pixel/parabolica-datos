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

async function fetchAudiencias() {
  const url = 'https://barloventocomunicacion.es/audiencias-tv-ayer/';
  const { data: html } = await axios.get(url, {
    headers: { ...BROWSER_HEADERS, Referer: 'https://www.google.com/' },
    timeout: 15000,
  });
  const $ = cheerio.load(html);
  const bodyText = $('body').text();

  const ranking = [];
  const rankMatches = bodyText.matchAll(/([A-Za-zÀ-ÿ0-9º.\s]{2,35}?)\s*\/\s*(\d{1,2}(?:,\d)?)\s*%/g);
  const seen = new Set();
  for (const m of rankMatches) {
    const name = m[1].trim();
    const share = parseFloat(m[2].replace(',', '.'));
    if (name.length < 2 || seen.has(name) || share > 100) continue;
    seen.add(name);
    ranking.push({ name, share, color: colorFor(name) });
    if (ranking.length >= 12) break;
  }
  ranking.sort((a, b) => b.share - a.share);

  console.log(`  (debug audiencias) status ok, HTML: ${html.length} caracteres, filas de ránking encontradas: ${ranking.length}`);
  return { ranking, updatedAt: new Date().toISOString() };
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

  try {
    const audiencias = await fetchAudiencias();
    fs.writeFileSync(path.join(outDir, 'audiencias.json'), JSON.stringify(audiencias, null, 2));
    console.log(`✓ audiencias.json guardado (${audiencias.ranking.length} cadenas)`);
  } catch (err) {
    console.error('✗ Error generando audiencias.json:', err.message);
  }
}

main();
