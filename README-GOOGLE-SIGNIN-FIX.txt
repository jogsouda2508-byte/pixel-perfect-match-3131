GOOGLE SIGN-UP FIX - HOW TO APPLY

PART A - Supabase dashboard (REQUIRED, this is the main cause of "page not found")
  Supabase > Authentication > URL Configuration
   1. Site URL  ->  https://pixel-perfect-match-3131.onrender.com   (NOT http://localhost:3000)
   2. Redirect URLs -> add all of these:
        https://pixel-perfect-match-3131.onrender.com/**
        http://localhost:3000/**          (only for testing on your PC)
        sabzone://auth-callback
  Save.

PART B - code
   1. Copy this zip's files into your project root (Replace).
   2. npm install            (adds @capacitor/browser)
   3. npm run build -> copy output to android-web/ -> npx cap sync android
   4. Uninstall old app, run again.

Changed files: src/lib/auth.tsx, android/app/src/main/AndroidManifest.xml, package.json
