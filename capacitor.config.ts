import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sabzone.app',
  appName: 'SabZone',
  webDir: 'android-web',
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#05010F',
    },
  },
};

export default config;
