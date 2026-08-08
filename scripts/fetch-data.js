/**
 * Este script lo ejecuta GitHub Actions solo, cada hora.
 * Descarga la programación real de tvguia.es y los últimos lanzamientos
 * de Spotify (mercado España), y los guarda como archivos JSON en /data.
 * El panel HTML lee esos JSON directamente desde GitHub (raw.githubusercontent.com),
 * que sí permite ser leído desde el navegador (a diferencia de tvguia.es o Spotify).
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

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

function colorFor(seed) {
  const palette = ['#e51c23', '#f0a83a', '#3ecf8e', '#7d3ac1', '#00a8e8', '#ff7a00', '#c8102e', '#0a3d62', '#39a935', '#d63384'];
  let hash = 0;
  for (const ch of String(seed)) hash = (hash * 31 + ch.charCodeAt(0)) % palette.length;
  return palette[hash];
}

async function fetchChannelSchedule(slug) {
  const url = `https://www.tvguia.es/tv/programacion-${slug}`;
  const { data: html } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ParabolicaPanel/1.0)' },
    timeout: 15000,
  });
  const $ = cheerio.load(html);
  const items = [];
  $('a[href*="/television/tv-serie-cine/"]').each((_, el) => {
    const text = $(el).text().trim();
    const match = text.match(/(\d{1,2}:\d{2})\s*(.+)/);
    if (match) items.push({ time: match[1], title: match[2].replace(/^[►◄+]\s*/, '').trim() });
  });
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

async function getSpotifyToken() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error('Faltan los secretos SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET en GitHub');
  }
  const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await axios.post(
    'https://accounts.spotify.com/api/token',
    'grant_type=client_credentials',
    { headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data.access_token;
}

async function buildMusica() {
  const token = await getSpotifyToken();
  const headers = { Authorization: `Bearer ${token}` };

  const releasesRes = await axios.get('https://api.spotify.com/v1/browse/new-releases?country=ES&limit=20', { headers });
  const releases = releasesRes.data.albums.items.map(album => ({
    artist: album.artists.map(a => a.name).join(', '),
    track: album.name,
    date: album.release_date,
    tags: ['spotify'],
    color: colorFor(album.id),
    url: album.external_urls.spotify,
  }));

  let top10 = [];
  try {
    const searchRes = await axios.get(
      'https://api.spotify.com/v1/search?q=Los%2040%20Principales&type=playlist&market=ES&limit=1',
      { headers }
    );
    const playlistId = searchRes.data.playlists?.items?.[0]?.id;
    if (playlistId) {
      const tracksRes = await axios.get(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks?market=ES&limit=10`,
        { headers }
      );
      top10 = tracksRes.data.items.map((it, idx) => ({
        pos: idx + 1, delta: 0,
        artist: it.track?.artists?.map(a => a.name).join(', ') || '—',
        track: it.track?.name || '—',
        color: colorFor(it.track?.id || idx),
      }));
    }
  } catch (err) {
    console.error('Aviso: no se pudo construir el top10:', err.message);
  }

  return { releases, top10, updatedAt: new Date().toISOString() };
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
    const musica = await buildMusica();
    fs.writeFileSync(path.join(outDir, 'musica.json'), JSON.stringify(musica, null, 2));
    console.log(`✓ musica.json guardado (${musica.releases.length} lanzamientos)`);
  } catch (err) {
    console.error('✗ Error generando musica.json:', err.message);
  }
}

main();
