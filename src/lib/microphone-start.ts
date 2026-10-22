/** Browser permission and audio-resume requests can remain pending indefinitely. */
export async function startMicrophone(start: () => Promise<void>, stop: () => void, timeoutMs = 10000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      start(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          stop();
          reject(new Error('Microphone did not start. Allow microphone access in your browser, then click Unmute again.'));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
