import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ScrollView } from './ScrollView';
import { shareText, type ShareResult } from '../platform/shareText';
import { Button } from './Button';
import { ModalHeader } from './ModalHeader';
import { Sheet } from './Sheet';
import { createThemedStyles, radius, space, useTheme } from './theme';

export type SharePreviewProps = {
  /** Sheet title, also the share-sheet title (e.g. "Share this day"). */
  title: string;
  /** The exact text: what is shown is what is shared or copied (one string, never rebuilt). */
  text: string;
  /** One line above the preview, e.g. "This is exactly what will be shared. It includes your weight." */
  intro: string;
  /** Screen-reader label of Cancel, e.g. "Cancel sharing". */
  cancelLabel: string;
  onClose: () => void;
  /** After a share or copy attempt: the screen reports it (e.g. "Copied"). */
  onResult: (r: ShareResult) => void;
  /** The platform share; injectable for tests. */
  share?: (message: string, title: string) => Promise<ShareResult>;
  /** A secondary "Copy" fallback (#119): puts the same text on the clipboard. Absent: no Copy button. */
  copy?: (message: string) => Promise<void>;
};

/**
 * Preview-then-share sheet (#76, #119): the exact text, then Share (the system share sheet, no hard-coded target)
 * and optionally Copy. Sensitive text is only handed over on an explicit tap; Cancel shares nothing.
 */
export function SharePreviewSheet({ title, text, intro, cancelLabel, onClose, onResult, share = shareText, copy }: SharePreviewProps) {
  const { type } = useTheme();
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  return (
    <Sheet visible onClose={onClose} label={title} fill>
      <ModalHeader title={title} dismiss={{ label: 'Cancel', a11yLabel: cancelLabel, onPress: onClose }} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content} testID="share-sheet">
        <Text style={type.detail}>{intro}</Text>
        <View style={styles.box}>
          <Text style={styles.text} selectable testID="share-preview">
            {text}
          </Text>
        </View>
      </ScrollView>
      {/* Actions stay in view however long the text is (#119: the configuration payload is long). */}
      <View style={styles.footer}>
        <Button
          title={busy ? 'Opening…' : 'Share'}
          disabled={busy}
          testID="share-confirm"
          onPress={async () => {
            setBusy(true);
            const r = await share(text, title);
            setBusy(false);
            onResult(r);
          }}
        />
        {copy && (
          <Button
            title="Copy instead"
            variant="secondary"
            disabled={busy}
            testID="share-copy"
            onPress={async () => {
              try {
                await copy(text);
                onResult('copied');
              } catch {
                onResult('unavailable');
              }
            }}
          />
        )}
        <Text style={type.detail}>Choose an app (for example ChatGPT or Claude). Nothing is sent until you pick one.</Text>
      </View>
    </Sheet>
  );
}

const useStyles = createThemedStyles(({ colors }) => ({
  flex: { flex: 1 },
  content: { gap: space.md, paddingBottom: space.md },
  footer: { gap: space.sm, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  box: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: space.md, backgroundColor: colors.bg },
  text: { fontSize: 14, lineHeight: 20, color: colors.ink, fontFamily: 'monospace' },
}));
