# Google sign-in setup

The app uses Firebase Authentication for accounts and Google as the sign-in provider.

1. The Firebase web app configuration for project `atlas-35f26` is set in `services/firebase.ts`.
2. In **Authentication → Sign-in method**, enable **Google**.
3. Create or use the OAuth 2.0 **Web application** client ID for this project and set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in `.env`.
4. For Android and iOS, register the app in Firebase, add the Android SHA-1 fingerprints for each build signing key, and download `google-services.json` and `GoogleService-Info.plist`. Add their paths to the `android.googleServicesFile` and `ios.googleServicesFile` fields in `app.json` before building.
5. Rebuild the native app after adding the Firebase files and configuration. Google sign-in uses native code and does not run in Expo Go; use an EAS or local development build.

The native Google sign-in plugin is already enabled in `app.json`. For production Android builds, add both the development/upload key and Google Play App Signing SHA-1 fingerprints in Firebase. Keep `.env` out of source control; these Firebase client settings identify the app, while authorization must still be enforced by Firebase security rules for any Firebase data you add.

Do not put the Google OAuth client secret in the app or any `EXPO_PUBLIC_` variable. The app uses the client ID only.
