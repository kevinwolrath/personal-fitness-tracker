import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

export type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Native confirmation: the system alert (iOS UIAlertController, Android AlertDialog).
 * Shown each time `visible` turns true. Android back or tapping outside counts as Cancel.
 * See ConfirmDialog.web.tsx for the in-frame web dialog.
 */
export function ConfirmDialog({ visible, title, message, confirmLabel, cancelLabel = 'Cancel', onConfirm, onCancel }: ConfirmDialogProps) {
  const handlers = useRef({ onConfirm, onCancel });
  handlers.current = { onConfirm, onCancel };
  useEffect(() => {
    if (!visible) return;
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => handlers.current.onCancel() },
        { text: confirmLabel, onPress: () => handlers.current.onConfirm() },
      ],
      { cancelable: true, onDismiss: () => handlers.current.onCancel() },
    );
  }, [visible, title, message, confirmLabel, cancelLabel]);
  return null;
}
