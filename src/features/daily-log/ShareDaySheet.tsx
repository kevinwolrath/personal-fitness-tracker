import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { shareText, type ShareResult } from '../../platform/shareText';
import { Button } from '../../ui/Button';
import { ModalHeader } from '../../ui/ModalHeader';
import { Sheet } from '../../ui/Sheet';
import { createThemedStyles, radius, space, useTheme } from '../../ui/theme';

/**
 * "Share this day" preview (#76): the exact text, then Share. The text shown is the text shared (one string from
 * `dailySummary`), because weight and fitness records are sensitive. Cancel shares nothing.
 */
export function ShareDaySheet({ text, onClose, onResult, share = shareText }: {
  text: string;
  onClose: () => void;
  /** After a share attempt: the screen reports it (e.g. "Copied"). */
  onResult: (r: ShareResult) => void;
  /** The platform share; injectable for tests. */
  share?: (message: string, title: string) => Promise<ShareResult>;
}) {
  const { type } = useTheme();
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const includesWeight = /^Weight: /m.test(text);
  return (
    <Sheet visible onClose={onClose} label="Share this day" fill>
      <ModalHeader title="Share this day" dismiss={{ label: 'Cancel', a11yLabel: 'Cancel sharing', onPress: onClose }} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content} testID="share-sheet">
        <Text style={type.detail}>
          {includesWeight ? 'This is exactly what will be shared. It includes your weight.' : 'This is exactly what will be shared.'}
        </Text>
        <View style={styles.box}>
          <Text style={styles.text} selectable testID="share-preview">
            {text}
          </Text>
        </View>
        <Button
          title={busy ? 'Opening…' : 'Share'}
          disabled={busy}
          testID="share-confirm"
          onPress={async () => {
            setBusy(true);
            const r = await share(text, 'Share this day');
            setBusy(false);
            onResult(r);
          }}
        />
        <Text style={type.detail}>Choose an app (for example ChatGPT or Claude). Nothing is sent until you pick one.</Text>
      </ScrollView>
    </Sheet>
  );
}

const useStyles = createThemedStyles(({ colors }) => ({
  flex: { flex: 1 },
  content: { gap: space.md, paddingBottom: space.xl },
  box: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: space.md, backgroundColor: colors.bg },
  text: { fontSize: 14, lineHeight: 20, color: colors.ink, fontFamily: 'monospace' },
}));
