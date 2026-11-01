/** Web cannot keep files between sessions; provenance keeps the file name only. */
export async function retainAsset(): Promise<string | null> {
  return null;
}

/** Download as a file. */
export async function shareJson(fileName: string, json: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
