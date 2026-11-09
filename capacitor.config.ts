import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yasminSusheel.guccichat',
  appName: 'SabZone',
  webDir: 'android-web',
  backgroundColor: '#7C3AED',
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#7C3AED',
    },
  },
};

export default config;
