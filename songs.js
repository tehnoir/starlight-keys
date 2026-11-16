// Song charts. All melodies are traditional / public domain.
//
// Format: space-separated tokens "NOTE[:beats]".
//   NOTE  = letter + optional #/b + octave (C4 = middle C), or R for a rest
//   beats = length in beats (default 1)
// rpb = tile rows per beat (how tall a one-beat tile is; 1 = one screen row)
// Any note that ends up 2+ rows tall becomes a "hold" tile.
window.SONGS = [
  {
    id: 'hotcross', title: 'Hot Cross Buns', emoji: '🥐', hue: 30, level: 1, bpm: 84, rpb: 1,
    notes: `E4 D4 C4:2 E4 D4 C4:2
            C4:.5 C4:.5 C4:.5 C4:.5 D4:.5 D4:.5 D4:.5 D4:.5
            E4 D4 C4:2`,
  },
  {
    id: 'mary', title: 'Mary Had a Little Lamb', emoji: '🐑', hue: 200, level: 1, bpm: 96, rpb: 1,
    notes: `E4 D4 C4 D4 E4 E4 E4:2 D4 D4 D4:2 E4 G4 G4:2
            E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:3`,
  },
  {
    id: 'twinkle', title: 'Twinkle Twinkle Little Star', emoji: '⭐', hue: 48, level: 1, bpm: 96, rpb: 1,
    notes: `C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2
            G4 G4 F4 F4 E4 E4 D4:2 G4 G4 F4 F4 E4 E4 D4:2
            C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2`,
  },
  {
    id: 'rowrow', title: 'Row, Row, Row Your Boat', emoji: '🚣', hue: 180, level: 2, bpm: 180, rpb: 0.5,
    notes: `C4:3 C4:3 C4:2 D4:1 E4:3 E4:2 D4:1 E4:2 F4:1 G4:6
            C5 C5 C5 G4 G4 G4 E4 E4 E4 C4 C4 C4
            G4:2 F4:1 E4:2 D4:1 C4:6`,
  },
  {
    id: 'london', title: 'London Bridge', emoji: '🌉', hue: 270, level: 2, bpm: 108, rpb: 1,
    notes: `G4:1.5 A4:.5 G4 F4 E4 F4 G4:2 D4 E4 F4:2 E4 F4 G4:2
            G4:1.5 A4:.5 G4 F4 E4 F4 G4:2 D4:2 G4:2 E4 C4:3`,
  },
  {
    id: 'macdonald', title: 'Old MacDonald', emoji: '🐮', hue: 100, level: 2, bpm: 112, rpb: 1,
    notes: `G4 G4 G4 D4 E4 E4 D4:2 B4 B4 A4 A4 G4:3 D4
            G4 G4 G4 D4 E4 E4 D4:2 B4 B4 A4 A4 G4:3
            D4:.5 D4:.5 G4 G4 G4:2 D4:.5 D4:.5 G4 G4 G4:2
            G4:.5 G4:.5 G4 G4:.5 G4:.5 G4 G4:.5 G4:.5 G4:.5 G4:.5 G4 G4
            G4 G4 G4 D4 E4 E4 D4:2 B4 B4 A4 A4 G4:3`,
  },
  {
    id: 'birthday', title: 'Happy Birthday', emoji: '🎂', hue: 330, level: 2, bpm: 100, rpb: 1,
    notes: `G3:.5 G3:.5 A3 G3 C4 B3:2 G3:.5 G3:.5 A3 G3 D4 C4:2
            G3:.5 G3:.5 G4 E4 C4 B3 A3:2 F4:.5 F4:.5 E4 C4 D4 C4:3`,
  },
  {
    id: 'jingle', title: 'Jingle Bells', emoji: '🔔', hue: 0, level: 3, bpm: 120, rpb: 1,
    notes: `E4 E4 E4:2 E4 E4 E4:2 E4 G4 C4:1.5 D4:.5 E4:4
            F4 F4 F4:1.5 F4:.5 F4 E4 E4 E4:.5 E4:.5 E4 D4 D4 E4 D4:2 G4:2
            E4 E4 E4:2 E4 E4 E4:2 E4 G4 C4:1.5 D4:.5 E4:4
            F4 F4 F4:1.5 F4:.5 F4 E4 E4 E4:.5 E4:.5 G4 G4 F4 D4 C4:4`,
  },
  {
    id: 'ode', title: 'Ode to Joy', emoji: '🎻', hue: 150, level: 3, bpm: 112, rpb: 1,
    notes: `E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:.5 D4:2
            E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:1.5 C4:.5 C4:2
            D4 D4 E4 C4 D4 E4:.5 F4:.5 E4 C4 D4 E4:.5 F4:.5 E4 D4 C4 D4 G3:2
            E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:1.5 C4:.5 C4:2`,
  },
  {
    id: 'elise', title: 'Für Elise', emoji: '🎹', hue: 290, level: 3, bpm: 170, rpb: 1,
    notes: `E5 D#5 E5 D#5 E5 B4 D5 C5 A4:2 C4 E4 A4 B4:2 E4 G#4 B4 C5:2
            E4 E5 D#5 E5 D#5 E5 B4 D5 C5 A4:2 C4 E4 A4 B4:2 E4 C5 B4 A4:4`,
  },
];
