/**
 * Shared Chromium MV3 browser compatibility helper for Google Chrome, Microsoft Edge,
 * Brave Browser, and Opera. Never embeds API keys or cloud endpoints.
 */

export type SupportedChromiumBrowser = 'chrome' | 'edge' | 'brave' | 'opera' | 'chromium-generic';

export interface BrowserCompatProfile {
  browser: SupportedChromiumBrowser;
  label: string;
  extensionStoreNote: string;
}

export function detectChromiumBrowser(userAgent = globalThis.navigator?.userAgent || ''): BrowserCompatProfile {
  if (/Edg\//i.test(userAgent)) {
    return {
      browser: 'edge',
      label: 'Microsoft Edge',
      extensionStoreNote: 'Shared Chromium MV3 extension compatible with Edge Add-ons and edge://extensions.',
    };
  }
  if (/OPR\//i.test(userAgent)) {
    return {
      browser: 'opera',
      label: 'Opera',
      extensionStoreNote: 'Shared Chromium MV3 extension via opera://extensions and Opera Add-ons.',
    };
  }
  const nav = globalThis.navigator as { brave?: { isBrave?: () => Promise<boolean> } } | undefined;
  if (nav?.brave) {
    return {
      browser: 'brave',
      label: 'Brave Browser',
      extensionStoreNote: 'Shared Chromium MV3 extension compatible with brave://extensions and Chrome Web Store.',
    };
  }
  if (/Chrome\//i.test(userAgent)) {
    return {
      browser: 'chrome',
      label: 'Google Chrome',
      extensionStoreNote: 'Shared Chromium MV3 extension compatible with Chrome Web Store and chrome://extensions.',
    };
  }
  return {
    browser: 'chromium-generic',
    label: 'Chromium Browser',
    extensionStoreNote: 'Shared Manifest V3 Chromium extension.',
  };
}
