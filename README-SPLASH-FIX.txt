SabZone splash fix v2 - HOW TO APPLY
1. Copy everything into your project root (Replace).
2. npm run build -> copy output to android-web/ -> npx cap sync android
3. UNINSTALL the old app, run again.

What changed vs v1:
  - Purple status bar / nav bar / home header REMOVED (styles.xml, capacitor.config.ts,
    src/routes/__root.tsx and src/routes/index.tsx back to normal - no global purple).
  - Splash background is now LIGHT purple (#A78BFA) in colors.xml, capacitor.config.ts, styles.css.
  - Logo, floating animation and SabZone name are unchanged.
