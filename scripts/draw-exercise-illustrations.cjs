// Draws the app-owned exercise illustrations (contract 09) as simple side-view figures and writes
// assets/exercises/<asset-id>.svg. Poses are joint coordinates, so every drawing shares one style.
// Re-run after editing a pose:  node scripts/draw-exercise-illustrations.cjs && npm run build:exercise-assets
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const W = 320;
const H = 240;
const GROUND = 222;
// The figure uses currentColor so the app's ink token colours it; equipment uses fixed tones.
const EQUIP = '#2F5D50';
const FRAME = '#A39E92';
const PAD = '#D9D5CC';

const line = (a, b, w = 11, color = 'currentColor') =>
  `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
const rect = (x, y, w, h, fill, r = 4) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
const circle = (c, r, fill) => `<circle cx="${c[0]}" cy="${c[1]}" r="${r}" fill="${fill}"/>`;

/** p: { head, shoulder, elbow, wrist, hip, knee, ankle, toe } */
function figure(p) {
  return [
    line(p.hip, p.knee),
    line(p.knee, p.ankle),
    line(p.ankle, p.toe, 9),
    line(p.shoulder, p.hip, 13),
    line([p.shoulder[0], p.shoulder[1]], [p.head[0], p.head[1] + 12], 9),
    circle(p.head, 15, 'currentColor'),
    line(p.shoulder, p.elbow, 10),
    line(p.elbow, p.wrist, 9),
  ].join('');
}

const ground = `<line x1="16" y1="${GROUND}" x2="${W - 16}" y2="${GROUND}" stroke="${PAD}" stroke-width="4" stroke-linecap="round"/>`;
const kettlebell = (c) =>
  `<path d="M${c[0] - 7} ${c[1] - 10} a7 7 0 0 1 14 0" fill="none" stroke="${EQUIP}" stroke-width="4"/>` + circle([c[0], c[1] + 3], 11, EQUIP);
const dumbbellVertical = (c) => rect(c[0] - 3, c[1] - 13, 6, 26, EQUIP, 2) + rect(c[0] - 7, c[1] - 16, 14, 7, EQUIP, 2) + rect(c[0] - 7, c[1] + 9, 14, 7, EQUIP, 2);
const handle = (c) => rect(c[0] - 6, c[1] - 6, 12, 12, EQUIP, 3);

// Fortis-style multi-gym elements (generic: upright, seat, back pad).
const upright = (x) => rect(x, 24, 12, GROUND - 24, FRAME, 3);
const seat = (x, y, w) => rect(x, y, w, 10, PAD, 4) + rect(x + w / 2 - 4, y + 10, 8, GROUND - y - 10, FRAME, 2);
const backPad = (x, y, h) => rect(x, y, 12, h, PAD, 5);

const poses = {
  'kettlebell-squat-1': () => {
    const p = { head: [150, 40], shoulder: [150, 68], elbow: [160, 104], wrist: [170, 90], hip: [150, 132], knee: [153, 176], ankle: [150, 218], toe: [168, 218] };
    return figure(p) + kettlebell([178, 92]);
  },
  'kettlebell-squat-2': () => {
    const p = { head: [148, 84], shoulder: [142, 112], elbow: [160, 146], wrist: [168, 128], hip: [116, 166], knee: [162, 170], ankle: [150, 218], toe: [168, 218] };
    return figure(p) + kettlebell([176, 130]);
  },
  'chest-press-1': () => {
    const p = { head: [118, 60], shoulder: [118, 88], elbow: [108, 120], wrist: [146, 100], hip: [126, 152], knee: [176, 150], ankle: [182, 214], toe: [198, 216] };
    return upright(262) + backPad(96, 64, 92) + seat(100, 152, 80) + line([262, 74], [154, 100], 6, FRAME) + figure(p) + handle([150, 100]);
  },
  'chest-press-2': () => {
    const p = { head: [118, 60], shoulder: [118, 88], elbow: [160, 96], wrist: [200, 98], hip: [126, 152], knee: [176, 150], ankle: [182, 214], toe: [198, 216] };
    return upright(262) + backPad(96, 64, 92) + seat(100, 152, 80) + line([262, 74], [208, 98], 6, FRAME) + figure(p) + handle([204, 98]);
  },
  'lat-pulldown-1': () => {
    const p = { head: [150, 76], shoulder: [146, 104], elbow: [154, 70], wrist: [160, 38], hip: [134, 160], knee: [190, 156], ankle: [196, 214], toe: [212, 216] };
    return upright(262) + rect(150, 14, 124, 8, FRAME, 3) + line([166, 22], [166, 34], 3, FRAME) + seat(106, 160, 64) + rect(176, 136, 34, 12, PAD, 5) + figure(p) + rect(140, 32, 52, 7, EQUIP, 3);
  },
  'lat-pulldown-2': () => {
    const p = { head: [150, 76], shoulder: [146, 104], elbow: [136, 136], wrist: [162, 112], hip: [134, 160], knee: [190, 156], ankle: [196, 214], toe: [212, 216] };
    return upright(262) + rect(150, 14, 124, 8, FRAME, 3) + line([166, 22], [166, 106], 3, FRAME) + seat(106, 160, 64) + rect(176, 136, 34, 12, PAD, 5) + figure(p) + rect(140, 106, 52, 7, EQUIP, 3);
  },
  'cable-row-1': () => {
    const p = { head: [126, 92], shoulder: [124, 120], elbow: [160, 136], wrist: [196, 146], hip: [118, 182], knee: [172, 164], ankle: [226, 184], toe: [232, 166] };
    return upright(270) + rect(236, 150, 10, 60, FRAME, 3) + seat(72, 184, 80) + line([200, 146], [270, 196], 3, FRAME) + figure(p) + handle([200, 146]);
  },
  'cable-row-2': () => {
    const p = { head: [122, 92], shoulder: [122, 120], elbow: [96, 144], wrist: [138, 152], hip: [118, 182], knee: [172, 164], ankle: [226, 184], toe: [232, 166] };
    return upright(270) + rect(236, 150, 10, 60, FRAME, 3) + seat(72, 184, 80) + line([142, 152], [270, 196], 3, FRAME) + figure(p) + handle([142, 152]);
  },
  'hammer-curl-1': () => {
    // Arm drawn slightly forward of the torso so it stays visible in side view.
    const p = { head: [150, 40], shoulder: [152, 70], elbow: [166, 106], wrist: [170, 144], hip: [150, 132], knee: [152, 176], ankle: [150, 218], toe: [168, 218] };
    return figure(p) + dumbbellVertical([172, 150]);
  },
  'hammer-curl-2': () => {
    const p = { head: [150, 40], shoulder: [152, 70], elbow: [166, 106], wrist: [188, 76], hip: [150, 132], knee: [152, 176], ankle: [150, 218], toe: [168, 218] };
    return figure(p) + dumbbellVertical([192, 72]);
  },
};

for (const [id, draw] of Object.entries(poses)) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">` +
    `<title>${id}</title>${ground}${draw()}</svg>\n`;
  writeFileSync(join(__dirname, '..', 'assets', 'exercises', `${id}.svg`), svg);
}
console.log(`Wrote ${Object.keys(poses).length} illustrations to assets/exercises/`);
