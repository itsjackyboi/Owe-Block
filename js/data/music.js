// Chiptune tracks as data. Each track: bpm and four channels of 16th-note steps (looped).
// Tokens: a note name (C4, F#3), '.' for a rest, '-' to hold the previous note. Noise channel: K kick, S snare, h hat.
const rep = (s, n) => Array(n).fill(s).join(' ');

export const MUSIC = {
  // title: bright, rolling, a little cheeky
  title: {
    bpm: 124, duty1: 0.25, duty2: 0.125,
    lead: [
      'E5 . G5 . A5 . G5 . E5 . D5 . C5 . . .', 'D5 . F5 . G5 . F5 . D5 . C5 . B4 . . .',
      'E5 . G5 . A5 . C6 . B5 . A5 . G5 . E5 .', 'A5 . G5 . E5 . D5 . C5 . . . . . . .',
    ].join(' '),
    harm: [rep('C4 E4 G4 E4', 4), rep('B3 D4 G4 D4', 4), rep('A3 C4 E4 C4', 4), rep('F3 A3 C4 A3', 2) + ' ' + rep('G3 B3 D4 B3', 2)].join(' '),
    bass: [
      'C3 . C3 . G2 . G2 . C3 . C3 . G2 . A2 .', 'B2 . B2 . G2 . G2 . B2 . B2 . D3 . G2 .',
      'A2 . A2 . E3 . E3 . A2 . A2 . E3 . C3 .', 'F2 . F2 . C3 . C3 . G2 . G2 . G2 . B2 .',
    ].join(' '),
    drums: rep('K . h . S . h . K . h K S . h h', 4),
  },
  // mines: low, tense, a slow minor ostinato
  mines: {
    bpm: 96, duty1: 0.125, duty2: 0.25,
    lead: [
      'E4 . . . . . D4 . C4 . . . A3 . . .', 'E4 . . . G4 . F4 . E4 . . . . . . .',
      'A4 . . . G4 . . . E4 . . . D4 . . .', 'C4 . D4 . E4 . . . . . . . . . . .',
    ].join(' '),
    harm: [rep('A3 . C4 . E4 . C4 .', 2), rep('G3 . B3 . D4 . B3 .', 2), rep('F3 . A3 . C4 . A3 .', 2), rep('E3 . G3 . B3 . G3 .', 2)].join(' '),
    bass: [
      'A2 . . A2 . . A2 . A2 . . A2 . . E2 .', 'G2 . . G2 . . G2 . G2 . . G2 . . D2 .',
      'F2 . . F2 . . F2 . F2 . . F2 . . C2 .', 'E2 . . E2 . . E2 . E2 . . B1 . . E2 .',
    ].join(' '),
    drums: rep('K . . . . . h . S . . . K . h .', 4),
  },
  // rooftops: fast, bouncy, major with a swagger
  rooftops: {
    bpm: 142, duty1: 0.5, duty2: 0.25,
    lead: [
      'G4 . B4 . D5 . B4 . G4 . A4 . B4 . . .', 'C5 . E5 . G5 . E5 . C5 . D5 . E5 . . .',
      'D5 . F#5 . A5 . F#5 . D5 . E5 . F#5 . . .', 'G5 . E5 . D5 . B4 . A4 . . . G4 . . .',
    ].join(' '),
    harm: [rep('G3 B3 D4 B3', 4), rep('C4 E4 G4 E4', 4), rep('D4 F#4 A4 F#4', 4), rep('G3 B3 D4 B3', 2) + ' ' + rep('D4 F#4 A4 F#4', 2)].join(' '),
    bass: [
      'G2 . G2 D3 G2 . G2 D3 G2 . G2 D3 B2 . D3 .', 'C3 . C3 G3 C3 . C3 G3 C3 . C3 G3 E3 . G3 .',
      'D3 . D3 A3 D3 . D3 A3 D3 . D3 A3 F#3 . A3 .', 'G2 . G2 D3 G2 . G2 D3 D3 . D3 A2 D3 . D3 .',
    ].join(' '),
    drums: rep('K h S h K h S K K h S h K K S S', 4),
  },
  // pipe pit: driving, industrial, a repeating machine riff
  pipepit: {
    bpm: 132, duty1: 0.125, duty2: 0.5,
    lead: [
      'D4 . D4 . F4 . D4 . G4 . D4 . A4 . G4 .', 'D4 . D4 . F4 . D4 . A#4 . A4 . G4 . F4 .',
      'D4 . D4 . F4 . D4 . G4 . D4 . A4 . C5 .', 'A#4 . A4 . G4 . F4 . D4 . . . . . . .',
    ].join(' '),
    harm: [rep('D3 . . D3 . . D3 .', 2), rep('D3 . . D3 . . D3 .', 2), rep('D3 . . D3 . . D3 .', 2), rep('A#2 . . A#2 . . A#2 .', 2)].join(' '),
    bass: [rep('D2 D2 . D2 . D2 D2 .', 2), rep('D2 D2 . D2 . D2 D2 .', 2), rep('D2 D2 . D2 . D2 D2 .', 2), rep('A#1 A#1 . A#1 . A#1 A#1 .', 1) + ' ' + rep('A1 A1 . A1 . A1 A1 .', 1)].join(' '),
    drums: rep('K . h h S . h K K . h h S . h S', 4),
  },
};
