# Page to Voice

Turn a PDF or pasted text into speech, entirely in the browser. Your documents are never uploaded to a server. Plain HTML, CSS and JavaScript, with a few CDN libraries and no build step.

**Live demo:** `https://<your-username>.github.io/pdf-to-audio/` (after enabling GitHub Pages)

## Features
- **PDF and text input:** drag and drop a file or paste text, with a page-range selector for long PDFs
- **Editable text:** clean up the extracted text before listening
- **Two voice engines**
  - *Browser voice* uses the Web Speech API. It is instant, has pause and stop, and offers speed and pitch controls.
  - *Neural voice* uses Piper TTS (via `@diffusionstudio/vits-web`, with models fetched from Hugging Face). It sounds more natural and produces a **downloadable MP3**, encoded in the browser with `lamejs`.
- Text is split into sentence-sized chunks, which avoids browser cut-offs on long passages and gives real progress feedback
- Word count and estimated listening time

## Notes and limits
- The Web Speech API cannot be recorded by web pages, so MP3 export is only available with the neural voice.
- The neural voice downloads a model of tens of MB on first use, then caches it.
- Scanned PDFs have no selectable text and need OCR before they can be read.
- Voice availability for browser voices depends on your operating system.

## Run locally
```bash
git clone https://github.com/<your-username>/pdf-to-audio.git
cd pdf-to-audio
python3 -m http.server 8000   # open http://localhost:8000
```
Serve over `http://localhost` or HTTPS. Opening `index.html` directly from disk will block the neural voice engine.

## Deploy on GitHub Pages
Push to `main`, then set Settings, Pages, Source to **GitHub Actions**. The workflow in `.github/workflows/pages.yml` publishes the site.

## Structure
```
index.html        page shell
css/style.css     styling
js/main.js        PDF extraction, chunking, Web Speech, Piper, WAV and MP3 encoding
```

## Libraries
pdf.js (text extraction), lamejs (MP3 encoding), vits-web (Piper in the browser).

## Roadmap
- Highlight the sentence being read
- Chapter detection and per-chapter MP3 files
- OCR for scanned PDFs
- More languages and voices

## License
MIT. See [LICENSE](LICENSE).
