FULLY INSIDE ANDROID (no Render) - HOW TO APPLY

PART A - Supabase dashboard (do this first)
  Authentication > URL Configuration
   Site URL        ->  sabzone://auth-callback        (REMOVE the onrender.com address)
   Redirect URLs   ->  sabzone://auth-callback
                       sabzone://reset-password
                       (delete the onrender.com ones; keep http://localhost:3000/** only if you test on PC)
  Save.
  Also: Authentication > Providers > Google must stay enabled (nothing else to change).

PART B - code
  1. Copy files into project root (Replace)  - includes the earlier Google fix
  2. npm install
  3. npm run build -> copy output to android-web/ -> npx cap sync android
  4. UNINSTALL old app, run again.

New file: src/lib/auth-redirect.ts
Changed : src/lib/auth.tsx, src/routes/forgot-password.tsx, src/routes/settings.tsx,
          android/app/src/main/AndroidManifest.xml, package.json
