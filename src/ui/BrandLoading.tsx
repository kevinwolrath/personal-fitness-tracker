import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { APP_NAME, BRAND_BACKGROUND, BRAND_HIGHLIGHT } from '../brand';

/** Startup only: approved source artwork, no artificial delay or extra navigation controls. */
export function BrandLoading() {
  return <View style={styles.root} testID="brand-loading">
    <Image source={require('../../assets/branding/generated/splash-heroes.png')} resizeMode="contain" style={styles.art} accessibilityLabel={`${APP_NAME} approved three-hero artwork`} />
    <ActivityIndicator color={BRAND_HIGHLIGHT} accessibilityLabel="Loading your plan" />
    <Text style={styles.text} accessibilityLiveRegion="polite">Loading your plan…</Text>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex:1, alignItems:'center',justifyContent:'center',backgroundColor:BRAND_BACKGROUND,padding:24,gap:16 },
  art: { width:'100%',maxWidth:320,aspectRatio:1 },
  text: { color:BRAND_HIGHLIGHT,fontSize:16 },
});
