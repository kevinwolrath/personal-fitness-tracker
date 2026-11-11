import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

/** Write JSON to a file and open the native share sheet (save to Files, AirDrop, email…). */
export async function shareJson(fileName: string, json: string): Promise<void> {
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 });
  await Sharing.shareAsync(uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: fileName });
}
