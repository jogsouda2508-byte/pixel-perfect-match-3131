SabZone splash flash fix - HOW TO APPLY
1. Copy everything in this zip into your project root (Replace).
2. Run:  npm i @capacitor/splash-screen
3. npm run build -> copy output to android-web/ -> npx cap sync android
4. UNINSTALL the old app, then run again from Android Studio.

Changed files:
  android/app/src/main/res/values/colors.xml   (restored colorPrimary/Dark/Accent that were missing)
  android/app/src/main/res/values/styles.xml   (window background purple after splash, no white)
  capacitor.config.ts                          (purple WebView bg, native splash waits)
  src/components/brand-splash.tsx              (hides native splash once animated one is mounted)
  src/routes/__root.tsx                        (purple html/body before CSS loads)
