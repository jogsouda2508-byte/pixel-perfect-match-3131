import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yasminSusheel.guccichat',
  appName: 'SabZone',
  webDir: 'android-web',
  // Same purple as the splash, so the WebView never flashes white while the app loads.
  backgroundColor: '#7C3AED',
  android: {
    backgroundColor: '#7C3AED',
  },
};

export default config;
