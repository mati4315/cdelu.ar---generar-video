const cp = require('child_process');
const ffmpeg = require('ffmpeg-static');

try {
  // create dummy image
  cp.execSync(`"${ffmpeg}" -y -f lavfi -i color=c=blue:s=360x640:d=1 -vframes 1 test_img.png`, {stdio: 'inherit'});
  
  // zoompan using `in`
  cp.execSync(`"${ffmpeg}" -y -loop 1 -t 5 -i test_img.png -vf "zoompan=z='1.0+0.5*in':x='(iw-iw/zoom)*(in/150)':d=1:fps=30" output_loop.mp4`, {stdio: 'inherit'});
  console.log("SUCCESS");
} catch (e) {
  console.error("ERROR", e.message);
}
