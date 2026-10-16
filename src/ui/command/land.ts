/**
 * A coarse map of the world's land, for the dotted globe and the flat map.
 *
 * One entry per 5° band of latitude (centre of the band as the key), each a
 * list of [west, east] longitude spans. Hand-drawn at that resolution — enough
 * for continents to read at a glance as dots, which is all a hologram needs —
 * and a few hundred bytes instead of a map library.
 */
const BANDS: Record<number, [number, number][]> = {
  82.5: [[-90, -65], [-60, -25]],
  77.5: [[-110, -75], [-70, -20], [10, 25], [95, 105]],
  72.5: [[-125, -75], [-55, -22], [52, 60], [70, 140]],
  67.5: [[-165, -140], [-140, -65], [-52, -32], [-24, -14], [14, 30], [30, 180]],
  62.5: [[-165, -140], [-140, -75], [-70, -60], [-50, -42], [5, 30], [30, 180]],
  57.5: [[-160, -135], [-130, -60], [-6, -2], [6, 18], [22, 162]],
  52.5: [[-128, -56], [-10, 2], [4, 142], [156, 160]],
  47.5: [[-125, -53], [-4, 142]],
  42.5: [[-124, -70], [-9, 45], [45, 132], [140, 145]],
  37.5: [[-122, -76], [-9, -1], [12, 26], [26, 128], [132, 141]],
  32.5: [[-117, -80], [-9, 35], [35, 122], [130, 132]],
  27.5: [[-114, -97], [-82, -80], [-13, 35], [35, 57], [57, 121]],
  22.5: [[-106, -97], [-84, -75], [-16, 37], [39, 59], [68, 90], [92, 114], [120, 122]],
  17.5: [[-102, -88], [-16, 38], [42, 52], [73, 84], [94, 110], [120, 124]],
  12.5: [[-90, -83], [-17, 44], [74, 80], [98, 109], [122, 126]],
  7.5: [[-80, -60], [-13, 48], [80, 82], [99, 104], [122, 126]],
  2.5: [[-80, -50], [9, 42], [96, 118]],
  [-2.5]: [[-80, -40], [10, 41], [100, 140], [132, 150]],
  [-7.5]: [[-79, -35], [12, 40], [106, 115], [140, 148]],
  [-12.5]: [[-77, -38], [13, 41], [47, 50], [130, 137], [142, 144]],
  [-17.5]: [[-71, -39], [12, 38], [44, 50], [122, 146]],
  [-22.5]: [[-70, -41], [14, 35], [43, 48], [114, 150]],
  [-27.5]: [[-71, -48], [15, 32], [114, 153]],
  [-32.5]: [[-72, -52], [18, 28], [116, 152]],
  [-37.5]: [[-73, -57], [140, 150], [174, 178]],
  [-42.5]: [[-74, -63], [145, 148], [170, 174]],
  [-47.5]: [[-75, -66], [167, 169]],
  [-52.5]: [[-75, -68]],
  [-62.5]: [[-62, -56]],
  [-67.5]: [[-75, -60], [40, 170]],
  [-72.5]: [[-180, 180]],
  [-77.5]: [[-180, 180]],
  [-82.5]: [[-180, 180]],
  [-87.5]: [[-180, 180]],
}

/** A little wobble on every coastline, so 5° steps read as shore, not stairs. */
const wobble = (lat: number, lon: number) =>
  Math.sin(lat * 0.9 + lon * 0.35) * 1.6 + Math.sin(lat * 2.3 - lon * 0.7) * 0.9

export function isLand(lat: number, lon: number): boolean {
  const band = Math.floor(lat / 5) * 5 + 2.5
  const spans = BANDS[band]
  if (!spans) return false
  const w = wobble(lat, lon)
  return spans.some(([a, b]) => lon >= a - w && lon <= b + w)
}

/** Evenly spread [lat, lon] points on land, `step` degrees apart. */
export function landPoints(step: number): [number, number][] {
  const out: [number, number][] = []
  for (let lat = -88; lat <= 88; lat += step) {
    const lonStep = step / Math.max(0.2, Math.cos((lat * Math.PI) / 180))
    for (let lon = -180; lon < 180; lon += lonStep) {
      if (isLand(lat, lon)) out.push([lat, lon])
    }
  }
  return out
}
