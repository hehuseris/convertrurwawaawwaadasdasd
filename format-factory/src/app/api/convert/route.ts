import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { fileTypeFromFile } from "file-type";
import { spawn } from "child_process";
import { Readable } from "stream";
import { createReadStream } from "fs";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function runCommand(command: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

function isImageExt(ext: string) {
  return [
    "jpg",
    "jpeg",
    "png",
    "webp",
    "gif",
    "tiff",
    "bmp",
    "avif",
    "svg",
    "ico",
    "heic",
  ].includes(ext);
}

function isPdf(ext: string) {
  return ext === "pdf";
}

function isOfficeDoc(ext: string) {
  return [
    "doc",
    "docx",
    "ppt",
    "pptx",
    "xls",
    "xlsx",
    "odt",
    "ods",
    "odp",
    "rtf",
  ].includes(ext);
}

function isTextual(ext: string) {
  return ["txt", "md", "markdown", "html", "htm", "epub"].includes(ext);
}

function isAudio(ext: string) {
  return ["mp3", "wav", "flac", "ogg", "m4a", "aac", "wma", "opus"].includes(ext);
}

function isVideo(ext: string) {
  return ["mp4", "mkv", "webm", "mov", "avi", "m4v", "flv", "gif"].includes(ext);
}

async function convertImageWithSharp(inputPath: string, outputPath: string, toExt: string) {
  const base = sharp(inputPath, { limitInputPixels: false });
  switch (toExt) {
    case "jpg":
    case "jpeg":
      await base.jpeg({ quality: 90 }).toFile(outputPath);
      break;
    case "png":
      await base.png({ compressionLevel: 9 }).toFile(outputPath);
      break;
    case "webp":
      await base.webp({ quality: 90 }).toFile(outputPath);
      break;
    case "avif":
      await base.avif({ quality: 70 }).toFile(outputPath);
      break;
    case "gif":
      await base.toFormat("gif").toFile(outputPath);
      break;
    case "tiff":
      await base.tiff({ compression: "lzw" }).toFile(outputPath);
      break;
    case "bmp": {
      // Use ImageMagick for BMP output
      await runCommand("magick", [inputPath, outputPath]);
      break;
    }
    case "ico": {
      // Generate multi-size ICO for best compatibility
      await runCommand("magick", [
        inputPath,
        "-resize",
        "256x256",
        "-define",
        "icon:auto-resize=256,128,64,48,32,16",
        outputPath,
      ]);
      break;
    }
    case "pdf": {
      // Use ImageMagick to wrap image into a PDF page
      await runCommand("magick", [inputPath, outputPath]);
      break;
    }
    default:
      throw new Error(`Unsupported image target format: ${toExt}`);
  }
}

async function convertPdfToImages(inputPath: string, outputDir: string, toExt: "png" | "jpg" | "jpeg") {
  const fmt = toExt === "png" ? "png" : "jpeg";
  const prefix = path.join(outputDir, "page");
  await runCommand("pdftoppm", ["-r", "150", `-${fmt}`, inputPath, prefix]);
  // pdftoppm creates files like prefix-1.png
  // Normalize names to page-001.ext
  const files = await fs.readdir(outputDir);
  const pageFiles = files
    .filter((f) => f.startsWith("page-") && f.endsWith(`.${fmt}`))
    .sort((a, b) => {
      const an = parseInt(a.split("-")[1]);
      const bn = parseInt(b.split("-")[1]);
      return an - bn;
    });
  return pageFiles.map((f) => path.join(outputDir, f));
}

async function convertWithLibreOffice(inputPath: string, outputDir: string, toExt: string) {
  // --convert-to expects filter names for some formats, but passing file ext generally works
  await runCommand("libreoffice", ["--headless", "--convert-to", toExt, "--outdir", outputDir, inputPath]);
  // Find produced file
  const baseName = path.parse(inputPath).name;
  const produced = (await fs.readdir(outputDir)).find((f) => f.startsWith(baseName) && f.toLowerCase().endsWith(`.${toExt}`));
  if (!produced) throw new Error("LibreOffice conversion failed");
  return path.join(outputDir, produced);
}

async function convertWithPandoc(inputPath: string, outputPath: string) {
  await runCommand("pandoc", [inputPath, "-o", outputPath]);
}

async function convertWithFfmpeg(inputPath: string, outputPath: string, isVideoOut: boolean) {
  const args: string[] = ["-y", "-i", inputPath];
  if (isVideoOut) {
    // Reasonable default video transcode
    const ext = path.extname(outputPath).slice(1).toLowerCase();
    if (ext === "webm") {
      args.push("-c:v", "libvpx-vp9", "-crf", "28", "-b:v", "0", "-c:a", "libopus");
    } else if (ext === "mp4" || ext === "m4v" || ext === "mov") {
      args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k");
    } else if (ext === "mkv") {
      args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "192k");
    } else if (ext === "gif") {
      // video to gif
      args.push("-vf", "fps=10,scale=640:-1:flags=lanczos", "-loop", "0");
    }
  } else {
    // Audio-only
    args.push("-vn");
    const ext = path.extname(outputPath).slice(1).toLowerCase();
    if (ext === "mp3") args.push("-c:a", "libmp3lame", "-b:a", "192k");
    else if (ext === "m4a" || ext === "aac") args.push("-c:a", "aac", "-b:a", "192k");
    else if (ext === "ogg" || ext === "opus") args.push("-c:a", "libopus", "-b:a", "128k");
    else if (ext === "flac") args.push("-c:a", "flac");
    else if (ext === "wav") args.push("-c:a", "pcm_s16le");
  }
  args.push(outputPath);
  await runCommand("ffmpeg", args);
}

async function zipDirectory(inputDir: string, zipPath: string) {
  await runCommand("zip", ["-r", zipPath, "."], inputDir);
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const to = (form.get("to") as string | null)?.trim().toLowerCase();
    const files = form.getAll("files").filter(Boolean) as File[];

    if (!to) {
      return new Response(JSON.stringify({ error: "Missing 'to' format" }), { status: 400 });
    }
    if (!files.length) {
      return new Response(JSON.stringify({ error: "No files uploaded" }), { status: 400 });
    }

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "format-factory-"));
    const inputDir = path.join(workDir, "in");
    const outputDir = path.join(workDir, "out");
    await ensureDir(inputDir);
    await ensureDir(outputDir);

    const savedInputs: string[] = [];

    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const name = file.name || `upload-${Date.now()}`;
      const inputPath = path.join(inputDir, name);
      await fs.writeFile(inputPath, buffer);
      savedInputs.push(inputPath);
    }

    const producedOutputs: string[] = [];

    for (const inputPath of savedInputs) {
      const inputParsed = path.parse(inputPath);
      const detected = await fileTypeFromFile(inputPath);
      const inputExt = (detected?.ext || inputParsed.ext.replace(".", "")).toLowerCase();

      // Decide conversion path
      if (isImageExt(inputExt) && isImageExt(to)) {
        const outPath = path.join(outputDir, `${inputParsed.name}.${to}`);
        await convertImageWithSharp(inputPath, outPath, to);
        producedOutputs.push(outPath);
      } else if (isImageExt(inputExt) && to === "pdf") {
        const outPath = path.join(outputDir, `${inputParsed.name}.pdf`);
        await convertImageWithSharp(inputPath, outPath, "pdf");
        producedOutputs.push(outPath);
      } else if (isPdf(inputExt) && ["png", "jpg", "jpeg"].includes(to)) {
        const perPage = await convertPdfToImages(inputPath, outputDir, to as "png" | "jpg" | "jpeg");
        producedOutputs.push(...perPage);
      } else if (isPdf(inputExt) && to === "docx") {
        // Try LibreOffice first; fallback to pandoc
        try {
          const out = await convertWithLibreOffice(inputPath, outputDir, "docx");
          producedOutputs.push(out);
        } catch {
          const outPath = path.join(outputDir, `${inputParsed.name}.docx`);
          await convertWithPandoc(inputPath, outPath);
          producedOutputs.push(outPath);
        }
      } else if ((isOfficeDoc(inputExt) || isTextual(inputExt)) && ["pdf", "docx", "odt", "rtf", "txt", "html"].includes(to)) {
        if (inputExt === "md" || to === "md" || inputExt === "markdown") {
          const outPath = path.join(outputDir, `${inputParsed.name}.${to}`);
          await convertWithPandoc(inputPath, outPath);
          producedOutputs.push(outPath);
        } else {
          const out = await convertWithLibreOffice(inputPath, outputDir, to);
          producedOutputs.push(out);
        }
      } else if ((isTextual(inputExt) || isOfficeDoc(inputExt)) && to === "epub") {
        const outPath = path.join(outputDir, `${inputParsed.name}.epub`);
        await convertWithPandoc(inputPath, outPath);
        producedOutputs.push(outPath);
      } else if ((isAudio(inputExt) || isVideo(inputExt)) && isAudio(to)) {
        const outPath = path.join(outputDir, `${inputParsed.name}.${to}`);
        await convertWithFfmpeg(inputPath, outPath, false);
        producedOutputs.push(outPath);
      } else if ((isAudio(inputExt) || isVideo(inputExt)) && isVideo(to)) {
        const outPath = path.join(outputDir, `${inputParsed.name}.${to}`);
        await convertWithFfmpeg(inputPath, outPath, true);
        producedOutputs.push(outPath);
      } else if (isPdf(inputExt) && to === "pdf") {
        // passthrough
        const outPath = path.join(outputDir, `${inputParsed.name}.pdf`);
        await fs.copyFile(inputPath, outPath);
        producedOutputs.push(outPath);
      } else if (inputExt === to) {
        // passthrough same format
        const outPath = path.join(outputDir, `${inputParsed.base}`);
        await fs.copyFile(inputPath, outPath);
        producedOutputs.push(outPath);
      } else {
        throw new Error(`Unsupported conversion: ${inputExt} -> ${to}`);
      }
    }

    let responseBody: BodyInit;
    let filename: string;
    let contentType = "application/octet-stream";

    if (producedOutputs.length === 1) {
      const single = producedOutputs[0];
      filename = path.basename(single);
      const stream = Readable.toWeb(createReadStream(single)) as unknown as ReadableStream;
      responseBody = stream;
      const ext = path.extname(single).slice(1).toLowerCase();
      if (["jpg", "jpeg", "png", "gif", "webp", "avif", "tiff", "bmp", "ico"].includes(ext)) {
        contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;
      } else if (ext === "pdf") {
        contentType = "application/pdf";
      } else if (["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"].includes(ext)) {
        contentType = ext === "m4a" || ext === "aac" ? "audio/aac" : `audio/${ext}`;
      } else if (["mp4", "mkv", "webm", "mov", "avi", "m4v"].includes(ext)) {
        contentType = `video/${ext === "mkv" ? "x-matroska" : ext}`;
      } else if (["docx"].includes(ext)) {
        contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      } else if (["txt", "md", "html", "epub", "rtf"].includes(ext)) {
        contentType = ext === "html" ? "text/html" : ext === "md" ? "text/markdown" : "application/octet-stream";
      }
      return new Response(responseBody, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        },
      });
    } else {
      // Zip multiple outputs
      const zipPath = path.join(workDir, "result.zip");
      await zipDirectory(outputDir, zipPath);
      filename = "converted.zip";
      const stream = Readable.toWeb(createReadStream(zipPath)) as unknown as ReadableStream;
      responseBody = stream;
      return new Response(responseBody, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        },
      });
    }
  } catch (err: unknown) {
    let message = "Conversion failed";
    if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
      message = (err as { message: string }).message;
    }
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}