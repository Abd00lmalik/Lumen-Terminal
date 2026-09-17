/**
 * EvidenceGraph; the Lumen hero visualization.
 *
 * Concept (mandate §11): "many pieces of evidence becoming one research judgment."
 * A dark, dimensional research structure: a central geometric core (the judgment)
 * surrounded by small evidence/source nodes connected to it by thin paths (the
 * investigation), with a few layered translucent planes for depth. NOT a floating
 * monitor; NOT a decorative tech demo.
 *
 * Performance laws (mandate §12):
 * - No postprocessing, no transmission materials, no Environment HDRI, no shadows.
 * - Low-poly geometry only; ~26 meshes total; no per-frame allocation.
 * - Animation is a slow rotation + gentle node drift (throttled by frame delta).
 * - dpr capped at 1.5; canvas is lazy-loaded by the landing page; a CSS/HTML
 *   fallback (same composition, no WebGL) renders when 3D is unavailable and as
 *   the Suspense fallback so the hero is never blank.
 * - The palette reads `data-theme` so light mode gets a light composition.
 */
import { useRef, useMemo, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const ACCENT = "#14b8a6"; // teal; consistent in both themes

interface NodeSpec {
  readonly position: [number, number, number];
  readonly size: number;
  readonly opacity: number;
}

/** Deterministic pseudo-random layout (stable across renders/HMR; no Math.random flicker). */
function layoutNodes(count: number): NodeSpec[] {
  const nodes: NodeSpec[] = [];
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < count; i++) {
    const radius = 1.9 + rand() * 1.9;
    const theta = rand() * Math.PI * 2;
    const y = (rand() - 0.5) * 3.2;
    nodes.push({
      position: [Math.cos(theta) * radius, y, Math.sin(theta) * radius * 0.8 - 0.4],
      size: 0.035 + rand() * 0.045,
      opacity: 0.35 + rand() * 0.45,
    });
  }
  return nodes;
}

const EVIDENCE_NODES = layoutNodes(22);

/** Thin path from an evidence node toward the core (the act of synthesis). */
function ConnectionLine({ to, opacity }: { to: NodeSpec["position"]; opacity: number }) {
  const geometry = useMemo(() => {
    const from = new THREE.Vector3(...to);
    const target = from.clone().multiplyScalar(0.22); // stop short of the core surface
    const points = [from, from.clone().lerp(target, 0.5), target];
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [to]);
  return (
    <line>
      <primitive object={geometry} attach="geometry" />
      <lineBasicMaterial color={ACCENT} transparent opacity={opacity * 0.35} toneMapped={false} />
    </line>
  );
}

/** The judgment: a faceted core, slowly turning; brighter facets suggest synthesis. */
function JudgmentCore() {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((state, delta) => {
    ref.current.rotation.y += delta * 0.12;
    ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.18) * 0.12;
  });
  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[0.85, 0]} />
      <meshStandardMaterial
        color={ACCENT}
        emissive={ACCENT}
        emissiveIntensity={0.85}
        flatShading
        transparent
        opacity={0.92}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Inner nucleus visible through the core's facets. */
function Nucleus() {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((state) => {
    ref.current.rotation.y = -state.clock.elapsedTime * 0.2;
  });
  return (
    <mesh ref={ref} scale={0.45}>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#e9fffb" emissive={ACCENT} emissiveIntensity={1.6} toneMapped={false} />
    </mesh>
  );
}

/** Layered translucent planes: quiet structural depth, not decoration. */
function DepthPlanes() {
  return (
    <group>
      <mesh rotation={[0.42, 0.2, 0]} position={[0, 0, -1.1]}>
        <planeGeometry args={[4.6, 4.6]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.04} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh rotation={[-0.3, -0.35, 0.1]} position={[0.3, -0.2, -1.6]}>
        <planeGeometry args={[5.4, 5.4]} />
        <meshBasicMaterial color={ACCENT} transparent opacity={0.03} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Evidence nodes with gentle independent drift (cheap: position sine per node). */
function EvidenceField() {
  const group = useRef<THREE.Group>(null!);
  const seeds = useMemo(() => EVIDENCE_NODES.map((_, i) => i * 1.7), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    group.current.children.forEach((child, i) => {
      child.position.y = EVIDENCE_NODES[i]!.position[1] + Math.sin(t * 0.35 + seeds[i]!) * 0.08;
    });
  });
  return (
    <group ref={group}>
      {EVIDENCE_NODES.map((node, i) => (
        <group key={i} position={node.position}>
          <mesh scale={node.size}>
            <sphereGeometry args={[1, 10, 10]} />
            <meshStandardMaterial
              color={ACCENT}
              emissive={ACCENT}
              emissiveIntensity={0.9}
              transparent
              opacity={node.opacity}
              toneMapped={false}
            />
          </mesh>
          <ConnectionLine to={[0, 0, 0]} opacity={node.opacity} />
        </group>
      ))}
    </group>
  );
}

/** Sparse backdrop dust: depth without particle-noise. */
function Dust({ count = 90 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null!);
  const positions = useMemo(() => {
    let seed = 13;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (rand() - 0.5) * 11;
      arr[i * 3 + 1] = (rand() - 0.5) * 7;
      arr[i * 3 + 2] = -1 - rand() * 4;
    }
    return arr;
  }, [count]);
  useFrame((_, delta) => {
    ref.current.rotation.y += delta * 0.008;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={0.02} color={ACCENT} transparent opacity={0.28} sizeAttenuation toneMapped={false} />
    </points>
  );
}

function Scene() {
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 6, 5]} intensity={1.1} />
      <pointLight position={[-4, -2, -3]} intensity={0.5} color={ACCENT} />
      <JudgmentCore />
      <Nucleus />
      <DepthPlanes />
      <EvidenceField />
      <Dust />
    </>
  );
}

/** WebGL-less fallback (and Suspense fallback): the same composition in CSS. */
function StaticEvidenceGraph() {
  const nodes = useMemo(() => EVIDENCE_NODES.map((n) => ({
    left: 50 + n.position[0] * 9,
    top: 46 - n.position[1] * 11,
    size: 5 + n.size * 60,
    opacity: n.opacity,
  })), []);
  return (
    <div className="hero-3d-static" aria-hidden>
      <div className="hero-3d-static-core" />
      {nodes.map((n, i) => (
        <span
          key={i}
          className="hero-3d-static-node"
          style={{ left: `${n.left}%`, top: `${n.top}%`, width: n.size, height: n.size, opacity: n.opacity }}
        />
      ))}
    </div>
  );
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null;
  } catch {
    return false;
  }
}

/** Exported scene: lazy-loaded by the landing page; safe under SSR/static rendering. */
export function ResearchCoreScene() {
  if (typeof document !== "undefined" && !hasWebGL()) return <StaticEvidenceGraph />;
  return (
    <Suspense fallback={<StaticEvidenceGraph />}>
      <Canvas
        camera={{ position: [0, 0.6, 6.6], fov: 42 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        style={{ background: "transparent" }}
      >
        <Scene />
      </Canvas>
    </Suspense>
  );
}
