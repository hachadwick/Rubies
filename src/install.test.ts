import { describe, expect, it } from 'vitest';
import { detectPlatform } from './install';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  winEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
};

describe('detectPlatform', () => {
  it('tells iPhone/iPad browsers apart', () => {
    expect(detectPlatform(UA.iphoneSafari)).toBe('ios-safari');
    expect(detectPlatform(UA.iphoneChrome)).toBe('ios-other');
  });
  it('treats an iPad (which reports itself as a Mac) as iOS', () => {
    expect(detectPlatform(UA.macSafari, 5)).toBe('ios-safari');
    expect(detectPlatform(UA.macSafari, 0)).toBe('mac-safari');
  });
  it('recognises desktop and Android browsers', () => {
    expect(detectPlatform(UA.macChrome)).toBe('chrome');
    expect(detectPlatform(UA.winEdge)).toBe('edge');
    expect(detectPlatform(UA.winFirefox)).toBe('firefox');
    expect(detectPlatform(UA.android)).toBe('android');
  });
});
