# Automatización de datos — La Parabólica TV

Esto hace que tu panel se actualice **solo, cada hora, para siempre**, sin que
tú ni yo tengamos que hacer nada más después de este montaje inicial (una vez).
No necesitas terminal, ni instalar nada en tu ordenador, ni saber programar.

## Qué vas a hacer (dos partes, ~10 minutos en total)

### PARTE A — Crear el robot en GitHub (gratis)

1. Ve a **https://github.com** y crea una cuenta gratuita (si no tienes).
2. Arriba a la derecha, pulsa el **+** → **"New repository"**.
   - Nombre: `parabolica-datos` (o el que quieras)
   - Marca **"Public"**
   - Pulsa **"Create repository"**
3. En la página del repositorio recién creado, pulsa **"Add file" → "Upload files"**.
4. Arrastra **TODOS** los archivos y carpetas que te he preparado en esta carpeta
   (`.github`, `scripts`, `data`, `package.json`) — mantén la misma estructura
   de carpetas al subirlos.
5. Pulsa **"Commit changes"** abajo.

### PARTE B — Darle las llaves de Spotify al robot (gratis)

1. Si aún no tienes tu Client ID / Client Secret de Spotify:
   - Ve a **https://developer.spotify.com/dashboard** → inicia sesión →
     **"Create app"** → nombre y descripción cualquiera, Redirect URI
     `http://localhost:3000` → guarda.
   - Entra en la app → **"Settings"** → copia **Client ID** y
     **"View client secret"**.
2. En tu repositorio de GitHub, ve a **"Settings"** (pestaña del repo, no la
   de tu cuenta) → en el menú de la izquierda, **"Secrets and variables" →
   "Actions"**.
3. Pulsa **"New repository secret"**:
   - Name: `SPOTIFY_CLIENT_ID` → Value: pega tu Client ID → **Add secret**
4. Repite con:
   - Name: `SPOTIFY_CLIENT_SECRET` → Value: pega tu Client Secret → **Add secret**

### PARTE C — Encender el robot

1. Ve a la pestaña **"Actions"** de tu repositorio.
2. Si GitHub pregunta si quieres habilitar los workflows, pulsa
   **"I understand my workflows, go ahead and enable them"**.
3. A la izquierda, pulsa **"Actualizar datos del panel"** → botón
   **"Run workflow"** → **"Run workflow"** (para probarlo ya, sin esperar).
4. Espera 1-2 minutos y refresca la página: deberías ver una ejecución en
   verde ✓. A partir de aquí, se repetirá solo cada hora, siempre.

### PARTE D — Conectar tu panel

1. Copia la URL de tu repositorio, tiene esta forma:
   `https://github.com/TU-USUARIO/parabolica-datos`
2. Abre el panel (`panel-laparabolica.html`) → pestaña **"Fuentes de datos"**
   → pega ahí `TU-USUARIO/parabolica-datos` → **"Guardar y probar"**.

¡Ya está! El panel leerá desde ahora `data/parrilla.json` y `data/musica.json`
de tu repositorio, que el robot mantiene frescos solo, cada hora, sin que
tengas que volver a tocar nada.

## Si algo no encaja

- Si el robot falla (❌ en rojo en "Actions"), pulsa sobre esa ejecución para
  ver el mensaje de error — casi siempre es un secreto de Spotify mal copiado.
- Si tvguia.es cambia su diseño con el tiempo, el `fetch-data.js` podría dejar
  de encontrar los programas — dímelo y te lo actualizo.
