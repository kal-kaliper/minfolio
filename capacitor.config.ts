import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.folio.app',
  appName: 'Minfolio',
  webDir: 'dist',
  android: {
    // Allow the WebView to read bundled assets; content lives in dist/.
    allowMixedContent: false,
  },
  plugins: {
    Keyboard: {
      resizeOnFullScreen: true,
    },
  },
}

export default config
