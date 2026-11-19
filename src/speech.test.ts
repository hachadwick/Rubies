import { describe, expect, it } from 'vitest';
import { speakable, voiceGender, voiceLabel } from './speech';

describe('voices', () => {
  it.each([
    ['Microsoft Zira - English (United States)', 'female'],
    ['Microsoft David - English (United States)', 'male'],
    ['Microsoft Mark - English (United States)', 'male'],
    ['Microsoft Aria Online (Natural) - English (United States)', 'female'],
    ['Microsoft Guy Online (Natural) - English (United States)', 'male'],
    ['Google UK English Female', 'female'],
    ['Google UK English Male', 'male'],
    ['Google US English', 'female'],
    ['Samantha', 'female'],
    ['Daniel', 'male'],
    ['Bells', 'other'],
  ])('%s is %s', (name, g) => expect(voiceGender({ name })).toBe(g));

  it('shortens voice names', () => {
    expect(voiceLabel({ name: 'Microsoft Zira - English (United States)', lang: 'en-US' })).toBe('Zira · US');
    expect(voiceLabel({ name: 'Google UK English Male', lang: 'en-GB' })).toBe('UK English Male');
    expect(voiceLabel({ name: 'Microsoft Guy Online (Natural) - English (United States)', lang: 'en-US' })).toBe('Guy (natural) · US');
  });
});

describe('speakable', () => {
  it('reads references the way people say them', () => {
    expect(speakable('as Jesus said (John 3:16-18).')).toBe('as Jesus said (John 3, verses 16 to 18).');
    expect(speakable('see Luke 15:17 and Gen 1:1–2:3')).toBe('see Luke 15, verse 17 and Gen 1, verse 1, to chapter 2, verse 3');
  });
});
