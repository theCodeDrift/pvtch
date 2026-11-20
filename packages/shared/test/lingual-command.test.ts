import { describe, expect, it } from 'vitest';

import {
  isValidTranslateCommand,
  parseTranslateCommand,
} from '../src/lingual-command';

describe('isValidTranslateCommand', () => {
  it.each(['!tr', '!Translate', '!t_2', ' !tr '])('accepts %j', (command) => {
    expect(isValidTranslateCommand(command)).toBe(true);
  });

  it.each(['tr', '!', '!t r', '!tr!', `!${'a'.repeat(25)}`])(
    'rejects %j',
    (command) => {
      expect(isValidTranslateCommand(command)).toBe(false);
    }
  );
});

describe('parseTranslateCommand', () => {
  it('reads a language name and the text', () => {
    expect(
      parseTranslateCommand('!tr spanish good morning chat', '!tr')
    ).toEqual({ language: 'spanish', text: 'good morning chat' });
  });

  it('reads an ISO code and ignores case and extra spaces', () => {
    expect(parseTranslateCommand('  !TR  ES   hello  ', '!tr')).toEqual({
      language: 'spanish',
      text: 'hello',
    });
  });

  it('uses the configured command', () => {
    expect(parseTranslateCommand('!tr de hi', '!translate')).toBeUndefined();
    expect(parseTranslateCommand('!translate de hi', '!translate')).toEqual({
      language: 'german',
      text: 'hi',
    });
  });

  it('ignores other commands and a command that only starts the same', () => {
    expect(parseTranslateCommand('!lurk', '!tr')).toBeUndefined();
    expect(parseTranslateCommand('!trivia de hi', '!tr')).toBeUndefined();
  });

  it('needs a supported language and some text', () => {
    expect(parseTranslateCommand('!tr klingon hello', '!tr')).toBeUndefined();
    expect(parseTranslateCommand('!tr spanish', '!tr')).toBeUndefined();
    expect(parseTranslateCommand('!tr', '!tr')).toBeUndefined();
  });
});
