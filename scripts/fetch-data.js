/**
 * Este script lo ejecuta GitHub Actions solo, cada hora.
 * Descarga la programación real de tvguia.es y la guarda como JSON en /data.
 * El panel HTML lee ese JSON directamente desde GitHub (raw.githubusercontent.com).
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const TVGUIA_CHANNELS = {
  la1: 'la-1', la2: 'la-2', ant3: 'antena-3', cuatro: 'cuatro',
  tele5: 'telecinco', lasexta: 'la-sexta', fdf: 'fdf', neox: 'neox', divinity: 'divinity',
};

function guessGenre(title) {
  const t = title.toLowerCase();
  if (/noticias|telediario|informativ/.test(t)) return 'Informativo';
  if (/cine|película/.test(t)) return 'Cine';
  if (/concurso|millón|pasapalabra|ruleta/.test(t)) return 'Concurso';
  if (/serie|temporada/.test(t)) return 'Ficción';
  return 'Programa';
}

async function fetchChannelSchedule(slug) {
  const url = `https://www.tvguia.es/tv/programacion-${slug}`;
  const { data: html } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9',
      'Referer': 'https://www.tvguia.es/',
    },
    timeout: 15000,
  });
  const $ = cheerio.load(html);
  const items = [];
  $('a[href*="/television/tv-serie-cine/"]').each((_, el) => {
    const text = $(el).text().trim();
    const match = text.match(/(\d{1,2}:\d{2})\s*(.+)/);
    if (match) items.push({ time: match[1], title: match[2].replace(/^[►◄+]\s*/, '').trim() });
  });
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
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'es-ES,es;q=0.9',
    },
    timeout: 15000,
  });
  const $ = cheerio.load(html);
  const bodyText = $('body').text();

  // "Ránking diario de cadenas" aparece como líneas sueltas tipo "La1 / 10,3%"
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

  console.log(`  (debug audiencias) HTML: ${html.length} caracteres, filas de ránking encontradas: ${ranking.length}`);
  return { ranking, updatedAt: new Date().toISOString() };
}

function colorFor(seed) {
  const palette = ['#e51c23', '#f0a83a', '#3ecf8e', '#7d3ac1', '#00a8e8', '#ff7a00', '#c8102e', '#0a3d62', '#39a935', '#d63384'];
  let hash = 0;
  for (const ch of String(seed)) hash = (hash * 31 + ch.charCodeAt(0)) % palette.length;
  return palette[hash];
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
