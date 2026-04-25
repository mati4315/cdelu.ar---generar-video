# Cdelu Orquestador de Videos en Lote

Sistema automatizado de creación de videos en serie. Conecta con WordPress para extraer información de posts y genera automáticamente videos cortos (ideales para Shorts, Reels, o TikTok) con locución (TTS), subtítulos dinámicos, transiciones y audios combinados utilizando FFmpeg.

## 🚀 Características Principales

- **Generación en Lotes:** Ejecuta de a múltiples videos con pausas de enfriamiento configurables entre cada uno para evitar saturación del sistema.
- **Doble Panel UI Web (*Glassmorphism*):** 
  - *Panel Principal:* Monitoreo de procesos en vivo, logs de terminal y ajustes rápidos (volumen general TTS/música y modo de prueba).
  - *Panel Avanzado:* Ajustes finos visuales, administración de perfiles FFmpeg personalizados (Pipelines), calibración de márgenes en los subtítulos, desenfoques y configuración del flujo de introducción.
- **Dinamismo "Al Azar":** Capacidad para inyectar transiciones iniciales de forma aleatoria, además de seleccionar animaciones visuales diferentes para asegurar variedad masiva en tu contenido autogenerado.
- **Sistema TTS Inteligente:** Generación automática de locución con Python. Incorpora sincronización automática que acelera sutilmente el audio para encajar en el límite máximo de duración (`maxDurationSec`). Incluye un modo **"Test (Usar último audio)"** que agiliza la calibración y el testing gráfico usando grabaciones en caché.
- **Gestión de Marcas:** Implementación elegante y automática de marca de agua en la esquina inferior derecha con un 60% de transparencia, perfectamente sincronizada con la aparición de los primeros subtítulos.

## 🛠️ Tecnologías y Requisitos

- **Node.js**: Controladores estáticos (`generar-video.js`) y orquestador/API REST del panel (`lanzadores/server.js`).
- **FFmpeg**: Motor core de renderizado responsable de escalar las capas, inyectar subtítulos hardcodeados (`subtitles`) y uniones por `xfade` (transition overlap).
- **Python 3.x**: Empleado nativamente para la generación limpia de voz en la carpeta `tts_engine`.
- **WordPress REST API**: Como fuente de verdad (Source of truth) a través de peticiones HTTP.

## 📂 Archivos y Directorios Importantes

- `lanzadores/` - Aquí yace el servidor NodeJS (`server.js`) y las vistas HTML que controlan toda la herramienta (`index.html`, `advanced.html`). Configuración persistida sobre `config.json`.
- `logo/` - Carpeta que contiene `logo.png`. FFmpeg lo rescata tanto para secuencias introductorias completas, como para la estampa de marca de agua durante todo el clip.
- `musica-stock/` - Librería de mp3/wavs. El orquestador extrae porciones musicales al azar por cada vídeo evitando repeticiones.
- `tmp-assets/` - Activos temporales como los audios recién convertidos `-tts.wav` y los chunks intermedios de los subtítulos.
- `generar-video.js` - El script matriz que ejecuta y une toda la magia combinando todos los perfiles visuales en FFmpeg Args.

## 💻 Uso e Instrucciones

1. **Iniciar el panel Web:** Ejecuta de ser posible el archivo `lanzar_panel.bat` (o manualmente ingresando a `node lanzadores/server.js` sobre la terminal).
2. Dirigite a **`http://localhost:3005`**.
3. **Configura el Flujo:**
   - Siéntete libre para explorar y cambiar el panel avanzado e inyectar pipelines. Puedes colocar la configuración de animación o el intro en modo "Al Azar".
   - Al marcar **Omitir TTS**, se habilitará a sus entrañas una segunda opción que permite probar cambios visuales utilizando la última locución existente en `C:\Texto a voz\salidas` sin agotar tiempos o cuotas de servidor.
4. Confirma la cantidad y presiona **⚡ Empezar Lote**.

## ⚙️ Sobre Personalizaciones de FFmpeg (`filter_complex`)

El código asimila dinámicamente configuraciones en capa.
- `[bg]` actúa sobre la plantilla borrosa (blur) de fondo, mientras que `[fg]` es controlada por los márgenes de animación del pipeline (`zoompan`, `pan_top_to_bottom`, entre otros).
- `overlay=W-w-30:H-h-{dynamic}`, aplica la máscara transparente asíncrona de tu marca al final de todo este embate. 
- Puedes sobreescribir partes personalizadas reescribiendo la cadena en el textarea del panel avanzado, el backend integrará tus variables sobre `format=yuv420p[base]`.
