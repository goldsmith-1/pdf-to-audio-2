'use strict';
/* Page to Voice: PDF/text to speech. Browser voices via Web Speech API; neural voices via Piper (vits-web); MP3 via lamejs. */
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const $ = id => document.getElementById(id);
const VITS_URL = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/+esm';
let pdfDoc = null, chunks = [], idx = 0, stopped = true, cancelPiper = false, mp3Blob = null, wavUrl = null;

const status = (t, v) => { $('status').textContent = t || ''; const b = $('bar'); b.hidden = v === undefined; if (v !== undefined) b.value = v; };
const mode = () => document.querySelector('input[name=mode]:checked').value;
const countWords = () => { const n = ($('text').value.match(/\S+/g) || []).length; $('count').textContent = `${n.toLocaleString()} words, about ${Math.max(1, Math.round(n / 150))} min of audio`; };

/* ---------- loading text ---------- */
async function extractPdf() {
  const a = Math.max(1, +$('p1').value || 1), b = Math.min(pdfDoc.numPages, +$('p2').value || pdfDoc.numPages), pages = [];
  for (let i = a; i <= b; i++) {
    status(`Reading page ${i} of ${b}`, (i - a) / (b - a + 1));
    const c = await (await pdfDoc.getPage(i)).getTextContent();
    pages.push(c.items.map(t => t.str).join(' ').replace(/(\w)- (\w)/g, '$1$2').replace(/\s+/g, ' ').trim());
  }
  $('text').value = pages.filter(Boolean).join('\n\n'); status(''); countWords();
  if (!$('text').value) status('No selectable text found. This PDF may be a scan, which needs OCR first.');
}
async function loadFile(file) {
  if (!file) return;
  try {
    if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) {
      pdfDoc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      $('p1').max = $('p2').max = pdfDoc.numPages; $('p1').value = 1; $('p2').value = pdfDoc.numPages; $('range').hidden = false;
      await extractPdf();
    } else { $('range').hidden = true; $('text').value = await file.text(); countWords(); }
  } catch (e) { status('Could not read that file: ' + e.message); }
}
$('file').onchange = e => loadFile(e.target.files[0]);
$('reload').onclick = () => pdfDoc && extractPdf();
$('text').oninput = countWords;
const drop = $('drop');
['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => loadFile(e.dataTransfer.files[0]));

/* ---------- chunking (short pieces avoid browser cut-offs and keep progress visible) ---------- */
function split(text, max = 250) {
  const out = []; let cur = '';
  for (const s of text.replace(/\n{2,}/g, ' ¶ ').match(/[^.!?¶]+[.!?]*\s*|¶/g) || []) {
    if (s === '¶') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.flatMap(c => c.length > max * 2 ? c.match(new RegExp(`.{1,${max}}(\\s|$)`, 'g')) : [c]);
}

/* ---------- browser voices ---------- */
function loadVoices() {
  const v = speechSynthesis.getVoices().sort((a, b) => a.lang.localeCompare(b.lang));
  $('bvoice').innerHTML = v.map((x, i) => `<option value="${i}">${x.name} (${x.lang})</option>`).join('') || '<option>No browser voices available</option>';
  const en = v.findIndex(x => /^en/i.test(x.lang) && x.default); $('bvoice').value = en >= 0 ? en : Math.max(0, v.findIndex(x => /^en/i.test(x.lang)));
}
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function speakNext() {
  if (stopped) return;
  if (idx >= chunks.length) { setBusy(false); status('Finished.'); return; }
  const u = new SpeechSynthesisUtterance(chunks[idx]);
  u.voice = speechSynthesis.getVoices().sort((a, b) => a.lang.localeCompare(b.lang))[+$('bvoice').value] || null;
  u.rate = +$('rate').value; u.pitch = +$('pitch').value;
  u.onend = () => { idx++; speakNext(); };
  u.onerror = e => { if (e.error !== 'canceled' && e.error !== 'interrupted') { idx++; speakNext(); } };
  status(`Reading part ${idx + 1} of ${chunks.length}`, idx / chunks.length);
  speechSynthesis.speak(u);
}

/* ---------- Piper neural voice + MP3 ---------- */
function wavBlob(pcm, rate) {
  const buf = new DataView(new ArrayBuffer(44 + pcm.length * 2)), w = (o, s) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); buf.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt '); buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
  buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true); buf.setUint16(34, 16, true); w(36, 'data'); buf.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, i) => buf.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, s * 32767)), true));
  return new Blob([buf], { type: 'audio/wav' });
}
async function toMp3(pcm, rate) {
  const enc = new lamejs.Mp3Encoder(1, rate, 96), data = Int16Array.from(pcm, s => Math.max(-32768, Math.min(32767, s * 32767))), out = [];
  for (let i = 0; i < data.length; i += 1152) {
    const b = enc.encodeBuffer(data.subarray(i, i + 1152)); if (b.length) out.push(new Uint8Array(b));
    if ((i / 1152) % 400 === 0) { status('Encoding MP3', i / data.length); await new Promise(r => setTimeout(r)); }
  }
  out.push(new Uint8Array(enc.flush())); return new Blob(out, { type: 'audio/mpeg' });
}
async function runPiper() {
  cancelPiper = false; mp3Blob = null; $('dl').disabled = true; $('player').hidden = true;
  status('Loading the neural voice engine...', 0);
  const tts = await import(VITS_URL), id = $('pvoice').value;
  await tts.download(id, p => status(`Downloading voice model ${Math.round(p.loaded * 100 / p.total)}%`, p.loaded / p.total));
  const ac = new AudioContext(), parts = []; let rate = 22050;
  for (let i = 0; i < chunks.length; i++) {
    if (cancelPiper) { status('Stopped.'); return; }
    status(`Generating speech ${i + 1} of ${chunks.length}`, i / chunks.length);
    const audio = await ac.decodeAudioData(await (await tts.predict({ text: chunks[i], voiceId: id })).arrayBuffer());
    rate = audio.sampleRate; parts.push(audio.getChannelData(0), new Float32Array(Math.round(rate * 0.25)));
  }
  const pcm = new Float32Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; parts.forEach(p => { pcm.set(p, o); o += p.length; });
  if (wavUrl) URL.revokeObjectURL(wavUrl);
  wavUrl = URL.createObjectURL(wavBlob(pcm, rate)); $('player').src = wavUrl; $('player').hidden = false; $('player').play().catch(() => {});
  mp3Blob = await toMp3(pcm, rate); $('dl').disabled = false; status('Ready. Press play above or download the MP3.');
}

/* ---------- controls ---------- */
function setBusy(b) { $('go').disabled = b; $('stop').disabled = !b; $('pause').disabled = !b || mode() !== 'browser'; $('pause').textContent = 'Pause'; }
$('go').onclick = async () => {
  chunks = split($('text').value);
  if (!chunks.length) { status('Add some text first.'); return; }
  setBusy(true);
  if (mode() === 'browser') {
    if (!('speechSynthesis' in window)) { status('This browser has no speech synthesis. Try the neural voice.'); setBusy(false); return; }
    speechSynthesis.cancel(); stopped = false; idx = 0; speakNext();
  } else {
    try { await runPiper(); } catch (e) { status('Neural voice failed: ' + e.message + '. Check your connection or use the browser voice.'); }
    setBusy(false);
  }
};
$('pause').onclick = () => { if (speechSynthesis.paused) { speechSynthesis.resume(); $('pause').textContent = 'Pause'; } else { speechSynthesis.pause(); $('pause').textContent = 'Resume'; } };
$('stop').onclick = () => { stopped = true; cancelPiper = true; speechSynthesis.cancel(); setBusy(false); status('Stopped.'); };
$('dl').onclick = () => { if (!mp3Blob) return; const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(mp3Blob), download: 'page-to-voice.mp3' }); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
document.querySelectorAll('input[name=mode]').forEach(r => r.onchange = () => {
  const b = mode() === 'browser'; $('browserOpts').hidden = !b; $('piperOpts').hidden = b; $('dl').hidden = b; $('go').textContent = b ? 'Listen' : 'Generate audio';
  $('player').hidden = b || !$('player').src; status('');
});
addEventListener('beforeunload', () => speechSynthesis.cancel());
countWords();
