// Voice a film's narration with Azure Speech, one clip per scene. Adapted from the Healthcare Skillup
// course-film narrator (same owner).
//
//   node work/film/narrate-film.cjs <storyboard.json>          dry run: what would be voiced; sends nothing
//   node work/film/narrate-film.cjs <storyboard.json> --go     synthesizes (Azure bills per character)
//
// Writes work/film/audio/<film-id>/<scene-id>.mp3 and <scene-id>.json (character timings in the shape
// render-film.cjs --audio reads). Scenes that already have both files are skipped, so a re-run never
// pays twice; the clips are committed for the same reason.
//
// The voice comes from the storyboard's "voice" block ({voice, rate}); its language (en-US, so-SO...)
// is the voice name's prefix. A new film's script and voice need the owner's approval before --go.
// Needs SPEECH_SDK (path to microsoft-cognitiveservices-speech-sdk) and AZURE_SPEECH_KEY and
// AZURE_SPEECH_REGION in the environment, or in the file named by ENV_FILE. The key is never printed.
const fs = require('fs');
const path = require('path');

function env(name) {
  if (process.env[name]) return process.env[name];
  const file = process.env.ENV_FILE;
  const match = file && fs.readFileSync(file, 'utf8').match(new RegExp('^' + name + '=(.+)$', 'm'));
  if (!match) throw new Error(`${name} is not set (environment or ENV_FILE).`);
  return match[1].trim().replace(/^["']|["']$/g, '');
}
const xml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function synth(sdk, text, voice, rate, outMp3) {
  const config = sdk.SpeechConfig.fromSubscription(env('AZURE_SPEECH_KEY'), env('AZURE_SPEECH_REGION'));
  config.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio24Khz160KBitRateMonoMp3;
  config.setProperty(sdk.PropertyId.SpeechServiceResponse_RequestWordBoundary, 'true');
  config.setProperty(sdk.PropertyId.SpeechServiceResponse_RequestPunctuationBoundary, 'false');
  const synthesizer = new sdk.SpeechSynthesizer(config, null);
  const words = [];
  synthesizer.wordBoundary = (_, e) => { if (e.boundaryType === sdk.SpeechSynthesisBoundaryType.Word) words.push({t: e.audioOffset / 1e7, d: e.duration / 1e7, at: e.textOffset, len: e.wordLength}); };
  const lang = voice.split('-').slice(0, 2).join('-');
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}"><prosody rate="${rate || '0%'}">${xml(text)}</prosody></voice></speak>`;
  const lead = ssml.indexOf(xml(text)); // textOffset counts from the start of the SSML
  return new Promise((resolve, reject) => synthesizer.speakSsmlAsync(ssml, result => {
    synthesizer.close();
    if (result.reason !== sdk.ResultReason.SynthesizingAudioCompleted) return reject(new Error('Azure: ' + result.errorDetails));
    fs.writeFileSync(outMp3, Buffer.from(result.audioData));
    resolve({words: words.map(w => ({...w, at: w.at - lead})), seconds: result.audioDuration / 1e7});
  }, e => { synthesizer.close(); reject(new Error(String(e))); }));
}

// Character timings: characters inside a word span that word's time; those between words take the
// end of the previous word.
function charTimes(text, words) {
  const start = new Array(text.length).fill(null), end = new Array(text.length).fill(null);
  let from = 0;
  for (const w of words) {
    const word = xml(text).substr(w.at, w.len).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const i = text.indexOf(word, from);
    if (i < 0) continue;
    for (let k = 0; k < word.length; k++) { start[i + k] = w.t + w.d * k / word.length; end[i + k] = w.t + w.d * (k + 1) / word.length; }
    from = i + word.length;
  }
  let last = 0;
  for (let k = 0; k < text.length; k++) { if (start[k] == null) { start[k] = last; end[k] = last; } else last = end[k]; }
  return {characters: text.split(''), character_start_times_seconds: start, character_end_times_seconds: end};
}

(async () => {
  const args = process.argv.slice(2);
  if (!args[0] || args[0].startsWith('-')) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(0, 15).join('\n')); return; }
  const sbPath = path.resolve(args[0]), go = args.includes('--go');
  const sb = JSON.parse(fs.readFileSync(sbPath, 'utf8'));
  if (!sb.voice?.voice) throw new Error('The storyboard has no voice.');
  const out = path.join(path.dirname(sbPath), 'audio', sb.id);
  const todo = sb.scenes.filter(s => !(fs.existsSync(path.join(out, s.id + '.mp3')) && fs.existsSync(path.join(out, s.id + '.json'))));
  console.log(`${sb.title}: ${sb.scenes.length} scenes, ${todo.length} to voice, ${todo.reduce((n, s) => n + s.narration.length, 0)} characters, voice ${sb.voice.voice}, rate ${sb.voice.rate || '0%'}`);
  if (!go) { console.log('Dry run: nothing was sent. Re-run with --go to synthesize.'); return; }
  const sdk = require(process.env.SPEECH_SDK || 'microsoft-cognitiveservices-speech-sdk');
  fs.mkdirSync(out, {recursive: true});
  for (const scene of todo) {
    const result = await synth(sdk, scene.narration, sb.voice.voice, sb.voice.rate, path.join(out, scene.id + '.mp3'));
    const timing = charTimes(scene.narration, result.words);
    fs.writeFileSync(path.join(out, scene.id + '.json'), JSON.stringify(timing));
    const matched = timing.character_start_times_seconds.filter((x, i) => /\w/.test(scene.narration[i]) && x > 0).length;
    console.log(`  ${scene.id.padEnd(10)} ${result.seconds.toFixed(1)}s, ${result.words.length} words timed`);
    if (!matched) throw new Error('No word timings for ' + scene.id);
  }
})().catch(e => { console.log('FAILED: ' + e.message); process.exitCode = 1; });
