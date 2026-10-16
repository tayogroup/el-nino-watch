// Render an El Nino Watch health film from a storyboard (work/film/<id>.json) with work/film/film.html.
// Adapted from the Healthcare Skillup course-film renderer (same owner).
//
//   node work/film/render-film.cjs <storyboard.json> --stills
//       Three still frames per scene (PNG) to check the drawings. Free.
//   node work/film/render-film.cjs <storyboard.json> --preview
//       Silent film with the captions burned in; scene lengths ESTIMATED from word count. Free.
//   node work/film/render-film.cjs <storyboard.json> --audio <dir> --translation <other.json> --lang <code>
//       Captions only: <film-id>.<code>.vtt in the other storyboard's language, each scene's sentences
//       spread over that scene's speech (timed by scene, not word by word). No frames are rendered.
//   node work/film/render-film.cjs <storyboard.json> --audio <dir>
//       Narrated film. <dir> holds <scene-id>.mp3 and <scene-id>.json (character timings) from the
//       narration tool. Scene lengths come from the real audio, captions from the real timings, and the
//       captions go into a .vtt beside the film instead of being burned in.
//
// Output goes to --out <dir> (default: outputs/film/, which git ignores).
// Needs: PW (path to the playwright package), ffmpeg on PATH (or FFMPEG), and Chrome (or CHROME).
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const {pathToFileURL} = require('url');
const {chromium} = require(process.env.PW || 'playwright');

const argv = process.argv.slice(2);
const sbPath = path.resolve(argv[0] || '');
const stills = argv.includes('--stills'), preview = argv.includes('--preview');
const audioDir = argv.includes('--audio') ? path.resolve(argv[argv.indexOf('--audio') + 1]) : null;
const translation = argv.includes('--translation') ? JSON.parse(fs.readFileSync(path.resolve(argv[argv.indexOf('--translation') + 1]), 'utf8')) : null;
const lang = argv.includes('--lang') ? argv[argv.indexOf('--lang') + 1] : null;
if (!fs.existsSync(sbPath) || (!stills && !preview && !audioDir)) { console.log('Usage: render-film.cjs <storyboard.json> --stills | --preview | --audio <dir> [--out <dir>]'); process.exit(2); }
const outDir = path.resolve(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : path.join(__dirname, '..', '..', 'outputs', 'film'));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sb = JSON.parse(fs.readFileSync(sbPath, 'utf8'));
const LEAD = 0.6, GAP = 0.9; // silence before the first line, and between scenes

// Caption lines: split at sentence ends, then at commas, each at most 84 characters.
function chunks(text) {
  const out = [];
  text.match(/[^.!?]+[.!?]+["']?\s*/g).forEach(sentence => {
    sentence = sentence.trim();
    if (sentence.length <= 84) { out.push(sentence); return; }
    let current = '';
    sentence.split(/(?<=,|:)\s+/).forEach(part => {
      if ((current + ' ' + part).trim().length > 84 && current) { out.push(current.trim()); current = part; } else current = (current + ' ' + part).trim();
    });
    if (current) out.push(current.trim());
  });
  return out;
}
const audioSeconds = file => parseFloat(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());

const timings = [], captions = [];
let clock = 0;
sb.scenes.forEach((scene, i) => {
  const lead = i === 0 ? LEAD : 0;
  let speech, aligned = null;
  if (audioDir) {
    speech = audioSeconds(path.join(audioDir, scene.id + '.mp3'));
    aligned = JSON.parse(fs.readFileSync(path.join(audioDir, scene.id + '.json'), 'utf8'));
  } else speech = scene.narration.split(/\s+/).length / 2.6; // about 156 words a minute
  const start = clock, speechStart = clock + lead, end = speechStart + speech + GAP;
  timings.push({start, end, speechStart, speech});
  const parts = chunks(scene.narration);
  if (aligned) {
    const full = aligned.characters.join('');
    let from = 0;
    parts.forEach(text => {
      const at = full.indexOf(text.slice(0, 12), from);
      const a = at >= 0 ? at : from, b = Math.min(full.length - 1, a + text.length - 1);
      captions.push({start: speechStart + aligned.character_start_times_seconds[a], end: speechStart + aligned.character_end_times_seconds[b] + 0.15, text});
      from = b + 1;
    });
  } else {
    const total = parts.reduce((n, text) => n + text.length, 0);
    let c0 = speechStart;
    parts.forEach(text => { const d = speech * text.length / total; captions.push({start: c0, end: c0 + d, text}); c0 += d; });
  }
  clock = end;
});
const duration = clock;
// What the voice reads and what the captions show can differ ("O R S" is read letter by letter, shown as ORS).
for (const c of captions) for (const [from, to] of sb.captionReplace || []) c.text = c.text.split(from).join(to);
captions.forEach((c, i) => { if (captions[i + 1] && c.end > captions[i + 1].start) c.end = captions[i + 1].start; });
const vttTime = x => `${String(Math.floor(x / 3600)).padStart(2, '0')}:${String(Math.floor(x % 3600 / 60)).padStart(2, '0')}:${(x % 60).toFixed(3).padStart(6, '0')}`;

if (translation) {
  if (!audioDir || !/^[a-z]{2}$/.test(lang || '')) { console.log('--translation needs --audio <dir> and --lang <two-letter code>.'); process.exit(2); }
  if (translation.scenes.length !== sb.scenes.length || translation.scenes.some((x, i) => x.id !== sb.scenes[i].id)) { console.log('The translation does not have the same scenes.'); process.exit(1); }
  const lines = [];
  translation.scenes.forEach((scene, i) => {
    const parts = chunks(scene.narration), total = parts.reduce((n, text) => n + text.length, 0);
    let c0 = timings[i].speechStart;
    parts.forEach(text => { const d = timings[i].speech * text.length / total; lines.push({start: c0, end: c0 + d, text}); c0 += d; });
  });
  for (const c of lines) for (const [from, to] of translation.captionReplace || []) c.text = c.text.split(from).join(to);
  fs.mkdirSync(outDir, {recursive: true});
  const file = path.join(outDir, `${sb.id}.${lang}.vtt`);
  fs.writeFileSync(file, 'WEBVTT\n\n' + lines.map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`).join('\n'));
  console.log(JSON.stringify({captions: file, lines: lines.length}));
  process.exit(0);
}

(async () => {
  fs.mkdirSync(outDir, {recursive: true});
  const browser = await chromium.launch({executablePath: CHROME, args: ['--allow-file-access-from-files']});
  const page = await browser.newPage({viewport: {width: sb.width, height: sb.height}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(__dirname, 'film.html')).href);
  await page.evaluate(film => window.loadFilm(film), {storyboard: sb, timings, captions: audioDir ? [] : captions, duration});
  if (stills) {
    for (const [i, scene] of sb.scenes.entries()) for (const at of [0.2, 0.5, 0.85]) {
      const t = timings[i].start + (timings[i].end - timings[i].start) * at;
      await page.evaluate(x => window.renderAt(x), t);
      await page.screenshot({path: path.join(outDir, `${sb.id}-${String(i + 1).padStart(2, '0')}-${scene.id}-${Math.round(at * 100)}.png`)});
    }
    await browser.close();
    if (errors.length) { console.log('PAGE ERRORS: ' + errors.join(' | ')); process.exit(1); }
    console.log(JSON.stringify({stills: sb.scenes.length * 3, out: outDir, seconds: +duration.toFixed(1)}));
    return;
  }
  const frames = path.join(outDir, '.frames-' + sb.id);
  fs.rmSync(frames, {recursive: true, force: true}); fs.mkdirSync(frames, {recursive: true});
  const n = Math.ceil(duration * sb.fps), t0 = Date.now();
  for (let k = 0; k < n; k++) {
    await page.evaluate(x => window.renderAt(x), k / sb.fps);
    await page.screenshot({path: path.join(frames, String(k).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 90});
    if (k % 600 === 0) console.log(`frame ${k}/${n} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  await page.evaluate(x => window.renderAt(x), Math.min(duration - .1, timings[0].end * .5));
  await page.screenshot({path: path.join(outDir, sb.id + '.jpg'), type: 'jpeg', quality: 86});
  await browser.close();
  if (errors.length) { console.log('PAGE ERRORS: ' + errors.join(' | ')); process.exit(1); }
  const out = path.join(outDir, sb.id + (audioDir ? '' : '-preview') + '.mp4');
  const args = ['-y', '-v', 'error', '-framerate', String(sb.fps), '-i', path.join(frames, '%05d.jpg')];
  if (audioDir) {
    const filters = [], labels = [];
    sb.scenes.forEach((scene, i) => {
      args.push('-i', path.join(audioDir, scene.id + '.mp3'));
      const ms = Math.round((timings[i].start + (i === 0 ? LEAD : 0)) * 1000);
      filters.push(`[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`); labels.push(`[a${i}]`);
    });
    filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0,apad[aout]`);
    args.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '128k', '-shortest');
  }
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'medium', '-movflags', '+faststart', out);
  execFileSync(FFMPEG, args, {stdio: 'inherit'});
  fs.writeFileSync(path.join(outDir, sb.id + '.vtt'), 'WEBVTT\n\n' + captions.map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`).join('\n'));
  fs.rmSync(frames, {recursive: true, force: true});
  console.log(JSON.stringify({out, seconds: +duration.toFixed(1), frames: n, megabytes: +(fs.statSync(out).size / 1e6).toFixed(1), scenes: timings.map((x, i) => `${sb.scenes[i].id} ${(x.end - x.start).toFixed(1)}s`), narrated: !!audioDir}));
})().catch(e => { console.log('FATAL ' + e.stack); process.exit(1); });
