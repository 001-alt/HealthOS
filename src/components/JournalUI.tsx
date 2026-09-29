import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function useSaveAction() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  };
  return { busy, error, run };
}

export function JournalModal({ title, onClose, busy, children }: React.PropsWithChildren<{ title: string; onClose: () => void; busy?: boolean }>) {
  return <Modal visible animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <SafeAreaView style={j.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={j.safe} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={j.header}><Text style={j.heading}>{title}</Text><Button title="关闭" onPress={onClose} disabled={busy} secondary /></View>
        <ScrollView contentContainerStyle={j.content} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

export function Button({ title, onPress, disabled, secondary = false }: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={[j.button, secondary && j.secondary, disabled && j.disabled]}><Text style={[j.buttonText, secondary && j.secondaryText]}>{title}</Text></Pressable>;
}

export function Input({ label, value, onChangeText, numeric, placeholder, multiline, maxLength = 100, editable = true }: {
  label: string; value: string; onChangeText: (value: string) => void; numeric?: boolean; placeholder?: string; multiline?: boolean; maxLength?: number; editable?: boolean;
}) {
  return <View style={j.field}><Text style={j.label}>{label}</Text><TextInput accessibilityLabel={label} style={[j.input, multiline && j.multiline]} value={value} onChangeText={onChangeText} keyboardType={numeric ? 'decimal-pad' : 'default'} placeholder={placeholder} placeholderTextColor="#8a9f99" multiline={multiline} maxLength={maxLength} editable={editable} /></View>;
}

export function ErrorText({ error }: { error?: string }) { return error ? <Text accessibilityRole="alert" style={j.error}>{error}</Text> : null; }

export const j = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f7fbf9' },
  content: { padding: 20, paddingBottom: 48, gap: 14 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 12 },
  heading: { fontSize: 23, fontWeight: '800', color: '#123c3d', flexShrink: 1 },
  title: { fontSize: 17, fontWeight: '700', color: '#123c3d' },
  text: { fontSize: 14, color: '#365e56', lineHeight: 22 },
  muted: { fontSize: 13, color: '#6c8980', lineHeight: 21 },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 18, gap: 10, borderWidth: 1, borderColor: '#e3efe9' },
  hero: { backgroundColor: '#e7f6f0', borderRadius: 18, padding: 18, gap: 10 },
  big: { fontSize: 28, fontWeight: '800', color: '#087e6b' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1 },
  badge: { color: '#087e6b', fontSize: 12, fontWeight: '700', lineHeight: 20 },
  button: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 14, backgroundColor: '#087e6b', paddingHorizontal: 16, paddingVertical: 10 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14, textAlign: 'center' },
  secondary: { backgroundColor: '#edf6f1', borderWidth: 1, borderColor: '#cfe5db' },
  secondaryText: { color: '#087e6b' },
  disabled: { opacity: 0.45 },
  field: { gap: 6 },
  label: { color: '#52786b', fontSize: 13, marginTop: 4 },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: '#cfe2d9', paddingHorizontal: 12, paddingVertical: 10, color: '#123c3d', backgroundColor: '#fbfefd', fontSize: 16 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  error: { color: '#b44334', backgroundColor: '#fff0e9', padding: 12, borderRadius: 12, fontSize: 14, lineHeight: 22 },
  divider: { borderTopWidth: 1, borderTopColor: '#e4eee9', paddingTop: 12, gap: 8 },
  check: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: '#cee2d9', borderRadius: 12 },
  checked: { backgroundColor: '#e3f6ed', borderColor: '#5cb292' },
  progress: { height: 7, borderRadius: 4, backgroundColor: '#d8e9e1', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#13a381' },
});
