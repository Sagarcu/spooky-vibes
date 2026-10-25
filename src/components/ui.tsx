import type { ComponentProps, ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Button, Icon, IconButton, Portal, Surface, Text, TextInput, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { palette, radius, spacing } from '../theme';

export function Panel({ children, tonal = false, style }: { children: ReactNode; tonal?: boolean; style?: StyleProp<ViewStyle> }) {
  return <Surface elevation={0} style={[ui.panel, tonal && ui.tonal, style]}>{children}</Surface>;
}

export function Caption({ children }: { children: ReactNode }) {
  return <Text variant="bodyMedium" style={ui.muted}>{children}</Text>;
}

export function Field(props: ComponentProps<typeof TextInput>) {
  return <TextInput mode="outlined" accessibilityLabel={typeof props.label === 'string' ? props.label : undefined} {...props} style={[ui.field, props.style]} />;
}

export function Action(props: ComponentProps<typeof Button>) {
  return <Button mode="contained" {...props} contentStyle={[ui.touch, props.contentStyle]} labelStyle={[ui.actionLabel, props.labelStyle]} />;
}

export function EmptyState({ icon, title, description, action, onPress }: {
  icon: string; title: string; description?: string; action?: string; onPress?: () => void;
}) {
  return <Panel style={ui.empty}>
    <Icon source={icon} size={40} color={palette.primary} />
    <Text variant="headlineSmall" accessibilityRole="header">{title}</Text>
    {description && <Caption>{description}</Caption>}
    {action && <Action onPress={onPress}>{action}</Action>}
  </Panel>;
}

export function Sheet({ visible, title, onDismiss, children, scrollEnabled = true, footer }: {
  visible: boolean; title: string; onDismiss: () => void; children: ReactNode; scrollEnabled?: boolean; footer?: ReactNode;
}) {
  const { animation } = useTheme();
  return <Modal visible={visible} transparent animationType={animation.scale === 0 ? 'none' : 'slide'} onRequestClose={onDismiss}>
    <Portal.Host>
    <SafeAreaView style={ui.scrim} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={ui.sheetPosition} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={ui.sheet} accessibilityViewIsModal>
          <View style={ui.handle} />
          <View style={ui.between}>
            <Text variant="headlineSmall" accessibilityRole="header" style={ui.flex}>{title}</Text>
            <IconButton icon="close" accessibilityLabel={`Close ${title}`} onPress={onDismiss} />
          </View>
          <ScrollView scrollEnabled={scrollEnabled} keyboardShouldPersistTaps="handled" contentContainerStyle={ui.sheetContent}>
            {children}
          </ScrollView>
          {footer && <View style={ui.sheetFooter}>{footer}</View>}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </Portal.Host>
  </Modal>;
}

export const ui = StyleSheet.create({
  panel: { borderRadius: radius.lg, backgroundColor: palette.surface, padding: spacing.xl, gap: spacing.lg },
  tonal: { backgroundColor: palette.raised },
  muted: { color: palette.muted },
  field: { backgroundColor: palette.surface },
  touch: { minHeight: 48 },
  actionLabel: { flexShrink: 1, textAlign: 'center', marginVertical: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  flex: { flex: 1 },
  stack: { gap: spacing.lg },
  gap: { marginTop: spacing.xl },
  empty: { alignItems: 'flex-start', marginTop: spacing.lg },
  scrim: { flex: 1, backgroundColor: palette.scrim },
  sheetPosition: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: spacing.xl, paddingTop: spacing.md, maxHeight: '95%', width: '100%', maxWidth: 600 },
  handle: { width: 32, height: 4, borderRadius: 2, backgroundColor: palette.outline, alignSelf: 'center', marginBottom: spacing.sm },
  sheetContent: { gap: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  sheetFooter: { paddingVertical: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderTopColor: palette.high },
});
