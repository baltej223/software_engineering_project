import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin, isSuccessResponse } from '@react-native-google-signin/google-signin';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import {
  getAuth,
  GoogleAuthProvider,
  initializeAuth,
  signInWithCredential,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: 'AIzaSyC2a2c-VwfUKs293YIeyxOu_1dHZxcXlQg',
  authDomain: 'atlas-35f26.firebaseapp.com',
  projectId: 'atlas-35f26',
  storageBucket: 'atlas-35f26.firebasestorage.app',
  messagingSenderId: '999130273497',
  appId: '1:999130273497:web:d99753844f5dbccdc350c8',
  measurementId: 'G-X18E3M9V28',
};

const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Firebase's default persistence is browser storage. Native apps need the
// React Native persistence adapter to keep the session across launches.
export const auth =
  Platform.OS === 'web'
    ? getAuth(firebaseApp)
    : (() => {
        try {
          return initializeAuth(firebaseApp, {
            // The React Native Firebase Auth entry exports this adapter; the
            // browser entry does not, so keep the platform-only API dynamic.
            persistence: (FirebaseAuth as any).getReactNativePersistence(AsyncStorage),
          });
        } catch {
          return getAuth(firebaseApp);
        }
      })();

const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

if (Platform.OS !== 'web' && webClientId) {
  GoogleSignin.configure({ webClientId });
}

export async function signInWithGoogle() {
  if (Platform.OS === 'web') {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
    return;
  }

  if (!webClientId) {
    throw new Error('Google sign-in is not configured. Add EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.');
  }

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) return;

  const idToken = response.data.idToken;
  if (!idToken) throw new Error('Google did not return an ID token. Check your OAuth client setup.');

  const credential = GoogleAuthProvider.credential(idToken);
  await signInWithCredential(auth, credential);
}

export async function signOut() {
  await firebaseSignOut(auth);
  if (Platform.OS !== 'web') {
    await GoogleSignin.signOut().catch(() => undefined);
  }
}
