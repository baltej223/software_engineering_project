import Text from '@/components/FontText';
import Colors from '@/constants/Colors';
import { signInWithGoogle } from '@/services/firebase';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function LoginScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleSignIn = async () => {
    setBusy(true);
    setError('');
    try {
      await signInWithGoogle();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Please try again.';
      if (!message.toLowerCase().includes('cancel')) setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.logo}>
          <MaterialCommunityIcons name="message-text" size={42} color={Colors.primary.base} />
        </View>
        <Text weight="bold" style={styles.title}>Welcome to AAC</Text>
        <Text style={styles.subtitle}>Sign in to continue to your communication tools.</Text>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={handleGoogleSignIn}
          disabled={busy}
          activeOpacity={0.8}
        >
          {busy ? <ActivityIndicator color={Colors.neutral[900]} /> : (
            <>
              <MaterialCommunityIcons name="google" size={22} color="#4285F4" />
              <Text weight="semibold" style={styles.buttonText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <Text style={styles.footnote}>
          Your account is secured by Firebase Authentication.
          {Platform.OS !== 'web' ? ' A development build is required for Google sign-in.' : ''}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background.primary, justifyContent: 'center' },
  content: { width: '100%', maxWidth: 420, alignSelf: 'center', padding: 28, alignItems: 'center' },
  logo: { width: 84, height: 84, borderRadius: 28, backgroundColor: Colors.primary.soft, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  title: { color: Colors.neutral[900], fontSize: 32, textAlign: 'center' },
  subtitle: { color: Colors.neutral[600], fontSize: 16, textAlign: 'center', lineHeight: 24, marginTop: 10, marginBottom: 32 },
  button: { minHeight: 56, width: '100%', backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: Colors.neutral[300], flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 16 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: Colors.neutral[900], fontSize: 16 },
  error: { color: '#B42318', textAlign: 'center', marginTop: 16 },
  footnote: { color: Colors.neutral[500], textAlign: 'center', lineHeight: 20, fontSize: 12, marginTop: 24 },
});
