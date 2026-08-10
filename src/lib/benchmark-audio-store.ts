import { supabase } from "./supabase";

const DATABASE = "voice-benchmark-assets";
const STORE = "audio";

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export async function saveBenchmarkAudio(key: string, file: Blob) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(file, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  return `indexeddb://${key}`;
}

export async function loadBenchmarkAudio(
  reference?: string,
): Promise<ArrayBuffer | null> {
  if (!reference) return null;
  if (!reference.startsWith("indexeddb://")) {
    const response = await fetch(reference);
    return response.arrayBuffer();
  }
  const key = reference.slice("indexeddb://".length);
  const database = await openDatabase();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = database
      .transaction(STORE, "readonly")
      .objectStore(STORE)
      .get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return blob ? blob.arrayBuffer() : null;
}

export async function loadBenchmarkAudioBlob(
  reference?: string,
): Promise<Blob | null> {
  if (!reference) return null;
  if (!reference.startsWith("indexeddb://")) {
    const response = await fetch(reference);
    return response.blob();
  }
  const key = reference.slice("indexeddb://".length);
  const database = await openDatabase();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = database
      .transaction(STORE, "readonly")
      .objectStore(STORE)
      .get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return blob || null;
}

export async function publishBenchmarkAudio(
  reference: string,
  objectPath: string,
) {
  const blob = await loadBenchmarkAudioBlob(reference);
  if (!blob) return reference;
  const { error } = await supabase.storage
    .from("voice-benchmark-audio")
    .upload(objectPath, blob, {
      contentType: blob.type || "audio/webm",
      upsert: true,
    });
  if (error) throw error;
  return supabase.storage.from("voice-benchmark-audio").getPublicUrl(objectPath)
    .data.publicUrl;
}

export async function playBenchmarkAudio(reference?: string) {
  const buffer = await loadBenchmarkAudio(reference);
  if (!buffer) return;
  const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  const audio = new Audio(url);
  audio.onended = () => URL.revokeObjectURL(url);
  await audio.play();
}

export async function saveBenchmarkOutputAudio(runId: string, blob: Blob) {
  const reference = await saveBenchmarkAudio(`output:${runId}`, blob);
  window.localStorage.setItem(`voice-benchmark-output:${runId}`, reference);
  return reference;
}

export function getBenchmarkOutputAudio(runId: string) {
  return (
    window.localStorage.getItem(`voice-benchmark-output:${runId}`) || undefined
  );
}

export async function saveBenchmarkPcm16Output(
  runId: string,
  chunks: string[],
  sampleRate = 24000,
) {
  const byteChunks = chunks.map((chunk) => {
    const decoded = atob(chunk);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1)
      bytes[index] = decoded.charCodeAt(index);
    return bytes;
  });
  const pcmLength = byteChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const wav = new Uint8Array(44 + pcmLength);
  const view = new DataView(wav.buffer);
  const write = (offset: number, value: string) =>
    [...value].forEach((character, index) =>
      view.setUint8(offset + index, character.charCodeAt(0)),
    );
  write(0, "RIFF");
  view.setUint32(4, 36 + pcmLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcmLength, true);
  let offset = 44;
  byteChunks.forEach((chunk) => {
    wav.set(chunk, offset);
    offset += chunk.length;
  });
  return saveBenchmarkOutputAudio(
    runId,
    new Blob([wav], { type: "audio/wav" }),
  );
}
