const cp = require('child_process');
const path = require('path');

const cwd = path.join(__dirname);
const customPipeline = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:10,eq=brightness=-0.35:saturation=1.1,zoompan=z='1.0+0.0018*in':x='(iw-iw/zoom)*(in/150)':y='ih/2-(ih/zoom/2)+sin(in/30)*15':d=1:s=1080x1920:fps=30,format=yuv420p[bg];
[0:v]scale=1080:1400:force_original_aspect_ratio=increase,crop=1080:1400,zoompan=z='1.0+0.003*in':x='(iw-iw/zoom)*(in/120)':y='ih/2-(ih/zoom/2)+sin(in/25)*25':d=1:s=1080x1400:fps=30,unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=1.2:chroma_msize_x=5:chroma_msize_y=5:chroma_amount=0.0,format=rgba[fg];
[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1[base]`;

const env = { ...process.env };
env.RESOLUTION = '360x640';
env.CUSTOM_VIDEO_PIPELINE = customPipeline.replace(/\n/g, '');

try {
  console.log("Running generar-video...");
  cp.execSync('node "generar-video.js" --skip-tts', { env, cwd, stdio: 'inherit' });
  console.log("SUCCESS!");
} catch(e) {
  console.error("FAIL", e.message);
}
