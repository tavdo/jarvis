import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Drive } from './Scene'
import { LIFT, LOCK_GROW, ringRadius } from './layout'

/**
 * The 3D layer around the reactor: three gyro rings and a lattice in the core.
 *
 * The reactor itself is a flat disc drawn in a shader, and it stays that way —
 * a polar shader is the right tool for an eroded, glowing ring. What a disc
 * cannot do is have a far side. These can: each ring is a real circle in space,
 * tilted almost edge-on and precessing like a gyroscope, and every one of them
 * dims as it swings behind the core and brightens as it comes round in front.
 * A light runs round each ring and does the same, so the eye can follow it
 * through the depth. That front-to-back fade is the entire 3D effect; without
 * it, tilted rings read as scratches on the glass.
 *
 * Like Orbits, nothing here is React state: it is built once and moved by
 * mutation in useFrame, reading the shared Drive.
 */

const ringVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vFront;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec4 centre = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec3 off = world.xyz - centre.xyz;
    // 1 on the side nearest the camera, 0 on the far side.
    vFront = clamp(off.z / max(length(off), 1e-4) * 0.5 + 0.5, 0.0, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const ringFragment = /* glsl */ `
  uniform vec3  uColor;
  uniform float uAlpha;
  uniform float uDash;
  uniform float uHead;
  uniform float uLevel;
  varying vec2 vUv;
  varying float vFront;
  void main() {
    float u = vUv.x;
    float f = fract(u * uDash);
    float dash = uDash > 0.0 ? smoothstep(0.30, 0.38, f) * (1.0 - smoothstep(0.62, 0.70, f)) : 1.0;
    // The travelling light and its fading wake.
    float behind = fract(uHead - u);
    float comet = exp(-behind * 16.0) + exp(-behind * 90.0) * 1.5;
    float depth = mix(0.12, 1.0, vFront * vFront);
    float a = uAlpha * depth * (dash * (0.55 + uLevel * 0.6) + comet * 1.4);
    gl_FragColor = vec4(mix(uColor, vec3(1.0), clamp(comet * 0.3, 0.0, 0.6)), a);
  }
`

const latticeVertex = /* glsl */ `
  uniform float uSize;
  varying float vFront;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec4 centre = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec3 off = mv.xyz - centre.xyz;
    vFront = clamp(off.z / max(length(off), 1e-4) * 0.5 + 0.5, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.6 + vFront * 0.8);
  }
`

const latticeFragment = /* glsl */ `
  uniform vec3  uColor;
  uniform float uAlpha;
  uniform float uPoints;
  varying float vFront;
  void main() {
    float shape = 1.0;
    if (uPoints > 0.5) {
      float r = length(gl_PointCoord - 0.5);
      if (r > 0.5) discard;
      shape = 1.0 - smoothstep(0.1, 0.5, r);
    }
    gl_FragColor = vec4(uColor, uAlpha * shape * mix(0.1, 1.0, vFront));
  }
`

type RingSpec = {
  /** Radius as a multiple of the reactor ring's. */
  r: number
  /** Tube thickness, in the same units. */
  tube: number
  /** How far from facing the camera, in degrees: 90 is edge-on. */
  lean: number
  /** A fixed roll about the view axis, so the three never line up. */
  roll: number
  /** Precession rate, radians per second at normal spin. Signed. */
  precess: number
  /** Dashes per turn; 0 for a solid ring. */
  dash: number
  alpha: number
  /** Turns per second of the travelling light. Signed. */
  run: number
  /** Starting angle, so they do not all begin together. */
  start: number
}

const RINGS: RingSpec[] = [
  { r: 1.2, tube: 0.0075, lean: 72, roll: 0, precess: 0.16, dash: 0, alpha: 0.8, run: 0.07, start: 0 },
  { r: 1.34, tube: 0.006, lean: 66, roll: 24, precess: -0.11, dash: 110, alpha: 0.75, run: -0.05, start: 2.1 },
  { r: 1.48, tube: 0.0055, lean: 79, roll: -17, precess: 0.07, dash: 0, alpha: 0.55, run: 0.035, start: 4.2 },
]

/** The core lattice's radius, as a multiple of the ring's — inside the textured disc. */
const LATTICE_R = 0.34

type Ring = {
  spec: RingSpec
  /** Carries the precession about the vertical axis. */
  spinner: THREE.Group
  mesh: THREE.Mesh<THREE.TorusGeometry, THREE.ShaderMaterial>
  /** The bright node riding the head of the travelling light. */
  node: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  angle: number
  head: number
}

const DEG = Math.PI / 180

export function Depth({ drive }: { drive: Drive }) {
  const built = useMemo(() => {
    const root = new THREE.Group()
    const nodeGeometry = new THREE.SphereGeometry(1, 12, 12)

    const rings: Ring[] = RINGS.map((spec) => {
      const tilt = new THREE.Group()
      tilt.rotation.z = spec.roll * DEG
      const spinner = new THREE.Group()
      spinner.rotation.y = spec.start
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color() },
          uAlpha: { value: 0 },
          uDash: { value: spec.dash },
          uHead: { value: 0 },
          uLevel: { value: 0 },
        },
        vertexShader: ringVertex,
        fragmentShader: ringFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(new THREE.TorusGeometry(spec.r, spec.tube, 6, 360), material)
      mesh.rotation.x = spec.lean * DEG
      mesh.frustumCulled = false
      const node = new THREE.Mesh(
        nodeGeometry,
        new THREE.MeshBasicMaterial({
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      )
      node.scale.setScalar(0.018)
      node.frustumCulled = false
      mesh.add(node)
      spinner.add(mesh)
      tilt.add(spinner)
      root.add(tilt)
      return { spec, spinner, mesh, node, angle: spec.start, head: spec.start / (Math.PI * 2) }
    })

    const latticeMaterial = (points: boolean) =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color() },
          uAlpha: { value: 0 },
          uSize: { value: 3.2 },
          uPoints: { value: points ? 1 : 0 },
        },
        vertexShader: latticeVertex,
        fragmentShader: latticeFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    const solid = new THREE.IcosahedronGeometry(1, 1)
    const lattice = new THREE.Group()
    const lines = new THREE.LineSegments(new THREE.WireframeGeometry(solid), latticeMaterial(false))
    const nodes = new THREE.Points(solid, latticeMaterial(true))
    lines.frustumCulled = false
    nodes.frustumCulled = false
    lattice.add(lines, nodes)
    root.add(lattice)

    return { root, rings, lattice, lines, nodes, nodeGeometry }
  }, [])

  useEffect(() => {
    const { root, rings, lines, nodes, nodeGeometry } = built
    return () => {
      for (const ring of rings) {
        ring.mesh.geometry.dispose()
        ring.mesh.material.dispose()
        ring.node.material.dispose()
      }
      nodeGeometry.dispose()
      lines.geometry.dispose()
      ;(lines.material as THREE.Material).dispose()
      nodes.geometry.dispose()
      ;(nodes.material as THREE.Material).dispose()
      root.clear()
    }
  }, [built])

  const tmp = useMemo(() => ({ node: new THREE.Vector3(), centre: new THREE.Vector3(), reveal: 0 }), [])

  useFrame((state, dt) => {
    const { root, rings, lattice, lines, nodes } = built
    const r = drive.reactor

    // Assembles with the reactor on power-up rather than hanging in the dark
    // before it, and fades out with the 3D setting.
    tmp.reveal += (Math.min(1, Math.max(0, (drive.open - 0.3) / 0.9)) - tmp.reveal) * Math.min(1, dt * 1.4)
    const show = tmp.reveal * drive.depth * r.intensity
    root.visible = r.visible && show > 0.003
    if (!root.visible) return

    root.position.set(0, state.viewport.height * LIFT * (1 - drive.lock), 0)
    root.scale.setScalar(ringRadius(state.viewport) * r.scale * (1 + drive.lock * LOCK_GROW))
    // Leans further than the disc does, so the rings visibly turn in space.
    root.rotation.set(-drive.look.y * 0.3, drive.look.x * 0.42, 0)

    // Faster while he works, like the reactor's own rings.
    const pace = (0.45 + drive.spin * 0.35) * r.spin
    const level = drive.level
    root.getWorldPosition(tmp.centre)

    for (const ring of rings) {
      const s = ring.spec
      ring.angle += dt * s.precess * pace
      ring.head = (ring.head + dt * s.run * pace + 1) % 1
      ring.spinner.rotation.y = ring.angle

      const u = ring.mesh.material.uniforms
      ;(u.uColor.value as THREE.Color).copy(r.color)
      u.uAlpha.value = s.alpha * show
      u.uHead.value = ring.head
      u.uLevel.value = level

      const a = ring.head * Math.PI * 2
      ring.node.position.set(Math.cos(a) * s.r, Math.sin(a) * s.r, 0)
      ring.node.getWorldPosition(tmp.node)
      const off = tmp.node.sub(tmp.centre)
      const front = Math.min(1, Math.max(0, off.z / Math.max(off.length(), 1e-4) * 0.5 + 0.5))
      ring.node.material.color.copy(r.color).lerp(WHITE, 0.45)
      ring.node.material.opacity = show * (0.2 + front * 0.8)
      ring.node.scale.setScalar(0.014 + front * 0.01 + level * 0.008)
    }

    lattice.rotation.y += dt * 0.22 * pace
    lattice.rotation.x += dt * 0.09 * pace
    lattice.scale.setScalar(LATTICE_R * (1 + level * 0.14))
    for (const m of [lines.material, nodes.material] as THREE.ShaderMaterial[]) {
      ;(m.uniforms.uColor.value as THREE.Color).copy(r.color)
      m.uniforms.uSize.value = 3.2 * Math.min(2, state.viewport.dpr)
    }
    ;(lines.material as THREE.ShaderMaterial).uniforms.uAlpha.value = (0.22 + level * 0.3) * show
    ;(nodes.material as THREE.ShaderMaterial).uniforms.uAlpha.value = (0.55 + level * 0.4) * show
  })

  return <primitive object={built.root} />
}

const WHITE = new THREE.Color('#ffffff')
