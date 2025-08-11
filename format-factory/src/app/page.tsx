"use client";

import { useCallback, useMemo, useRef, useState } from "react";

const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "tiff", "bmp", "avif", "ico"] as const;
const PDF_EXTS = ["pdf"] as const;
const DOC_EXTS = ["doc", "docx", "ppt", "pptx", "xls", "xlsx", "odt", "ods", "odp", "rtf", "txt", "md", "html", "epub"] as const;
const AUDIO_EXTS = ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"] as const;
const VIDEO_EXTS = ["mp4", "mkv", "webm", "mov", "avi", "m4v", "gif"] as const;

const ALL_TARGETS = Array.from(new Set([
  ...IMAGE_EXTS,
  ...PDF_EXTS,
  ...DOC_EXTS,
  ...AUDIO_EXTS,
  ...VIDEO_EXTS,
]));

export default function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [to, setTo] = useState<string>("pdf");
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const incoming = Array.from(e.dataTransfer.files || []);
    if (incoming.length) setFiles((prev) => [...prev, ...incoming]);
  }, []);

  const onBrowse = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(e.target.files || []);
    if (incoming.length) setFiles((prev) => [...prev, ...incoming]);
  }, []);

  const removeFile = useCallback((name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  const supportedText = useMemo(() => {
    return "Images, PDFs, Office docs, text/markdown, audio, video";
  }, []);

  const handleConvert = useCallback(async () => {
    if (!files.length) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("to", to);
      for (const f of files) form.append("files", f, f.name);
      const res = await fetch("/api/convert", { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || `Failed with ${res.status}`);
      }
      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition");
      let filename = `converted.${to}`;
      if (contentDisposition) {
        const match = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
        if (match) filename = decodeURIComponent(match[1]);
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      let message = "Conversion failed";
      if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
        message = (e as { message: string }).message;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [files, to]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-neutral-950 dark:to-black">
      <header className="px-6 sm:px-10 py-6 border-b border-black/5 dark:border-white/10 backdrop-blur">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500" />
            <div className="text-xl font-semibold tracking-tight">Format Factory</div>
          </div>
          <div className="hidden sm:flex items-center gap-6 text-sm text-neutral-600 dark:text-neutral-300">
            <span>Secure uploads</span>
            <span>Fast conversions</span>
            <span>Many formats</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 sm:px-10 py-10">
        <div className="grid md:grid-cols-5 gap-8 items-start">
          <section className="md:col-span-3">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center transition-colors ${dragOver ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-500/10" : "border-neutral-200 dark:border-neutral-800"}`}
            >
              <div className="mx-auto max-w-md">
                <div className="text-2xl sm:text-3xl font-semibold tracking-tight">Drop your files here</div>
                <div className="mt-2 text-neutral-600 dark:text-neutral-400">{supportedText}</div>
                <div className="mt-6 flex items-center justify-center gap-3">
                  <button
                    onClick={() => inputRef.current?.click()}
                    className="px-4 py-2 rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-black hover:opacity-90"
                  >
                    Browse files
                  </button>
                  <input ref={inputRef} type="file" multiple className="hidden" onChange={onBrowse} />
                </div>
              </div>
            </div>

            {files.length > 0 && (
              <div className="mt-6 rounded-xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-900 bg-white/60 dark:bg-white/5 backdrop-blur">
                {files.map((f) => (
                  <div key={f.name} className="flex items-center justify-between p-4 text-sm">
                    <div className="truncate">
                      <span className="font-medium">{f.name}</span>
                      <span className="ml-2 text-neutral-500">{(f.size / (1024 * 1024)).toFixed(2)} MB</span>
                    </div>
                    <button onClick={() => removeFile(f.name)} className="px-2 py-1 text-neutral-600 hover:text-red-600">Remove</button>
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300 text-sm">{error}</div>
            )}
          </section>

          <aside className="md:col-span-2 space-y-6">
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-6 bg-white/60 dark:bg-white/5 backdrop-blur">
              <div className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">Target format</div>
              <div className="mt-3">
                <select
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 outline-none"
                >
                  {ALL_TARGETS.map((t) => (
                    <option key={t} value={t}>
                      {t.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-6 bg-white/60 dark:bg-white/5 backdrop-blur">
              <div className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">Tips</div>
              <ul className="mt-3 space-y-2 text-sm text-neutral-600 dark:text-neutral-400">
                <li>Image ↔ Image (JPG, PNG, WEBP, AVIF, GIF, TIFF, BMP)</li>
                <li>Image → PDF</li>
                <li>PDF → JPG/PNG per page</li>
                <li>Docs (DOCX, PPTX, XLSX, RTF, MD, HTML) ↔ PDF/DOCX/RTF/TXT/HTML/EPUB</li>
                <li>Audio/Video ↔ MP3, WAV, AAC/M4A, OGG/OPUS, MP4, WEBM, MKV, MOV, GIF</li>
              </ul>
            </div>

            <button
              onClick={handleConvert}
              disabled={loading || files.length === 0}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-fuchsia-600 text-white font-medium disabled:opacity-60"
            >
              {loading ? "Converting..." : `Convert to ${to.toUpperCase()}`}
            </button>
          </aside>
        </div>
      </main>

      <footer className="py-8 text-center text-sm text-neutral-500">
        Made with Next.js + Tailwind. No files are stored permanently.
      </footer>
    </div>
  );
}
