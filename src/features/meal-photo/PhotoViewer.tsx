import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { MealPhoto } from '../../nutrition/contract';
import { photoSource } from '../../platform/mealPhotos';
import { space, touch } from '../../ui/theme';

/** Full-screen view of one photo, with Delete. */
export function PhotoViewer({ photo, missing, onClose, onDelete }: { photo: MealPhoto | null; missing: boolean; onClose: () => void; onDelete?: () => void }) {
  
  const src = photo && !missing ? photoSource(photo.uri) : null;
  return (
    <Modal visible={!!photo} animationType="fade" onRequestClose={onClose} transparent={false}>
      <SafeAreaView style={styles.viewer} edges={['top', 'bottom', 'left', 'right']} testID="meal-photo-viewer">
        <View style={styles.viewerBar}>
          <Pressable onPress={onClose} style={styles.viewerButton} accessibilityRole="button" accessibilityLabel="Close photo"><Text style={styles.viewerText}>Close</Text></Pressable>
          {onDelete && <Pressable onPress={onDelete} style={styles.viewerButton} accessibilityRole="button" accessibilityLabel="Delete this photo" testID="meal-viewer-delete"><Text style={styles.viewerText}>Delete</Text></Pressable>}
        </View>
        {src ? <Image source={{ uri: src }} style={styles.viewerImage} resizeMode="contain" accessibilityLabel="Meal photo" /> : <Text style={[styles.viewerText, styles.pad]}>This photo is missing from the phone’s storage. Delete it from the meal, or add a new one.</Text>}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: space.xl, paddingTop: space.md },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.lg },
  viewerButton: { minHeight: touch, minWidth: touch, justifyContent: 'center' },
  viewerText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  viewerImage: { flex: 1, width: '100%' },
});
