import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

/** Keep a durable copy of an imported screenshot so provenance can point at it. Returns its URI. */
export async function retainAsset(sourceUri: string, importId: string, assetId: string, ext: string): Promise<string | null> {
  if (!FileSystem.documentDirectory) return null;
  const dir = `${FileSystem.documentDirectory}imports/${importId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const to = `${dir}${assetId}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to });
  return to;
}

/** Write JSON to a file and open the native share sheet (save to Files, AirDrop, email…). */
export async function shareJson(fileName: string, json: string): Promise<void> {
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: fileName });
}
