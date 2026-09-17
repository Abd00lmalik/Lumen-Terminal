/**
 * ResearchCore; Interactive 3D hero visualization.
 * A translucent crystalline research core with orbital rings, floating particles,
 * and data nodes. Built with React Three Fiber + drei + postprocessing.
 */
import { useRef, useMemo, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, MeshTransmissionMaterial, Environment } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

/* ---------- outer beveled cube ---------- */
function OuterCore() {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((_, delta) => {
    ref.current.rotation.y += delta * 0.08;
    ref.current.rotation.x += delta * 0.03;
  });
  return (
    <mesh ref={ref} scale={2.0}>
      <boxGeometry args={[1, 1, 1, 4, 4, 4]} />
      <MeshTransmissionMaterial
        backside
        samples={6}
        thickness={0.4}
        chromaticAberration={0.06}
        anisotropy={0.1}
        distortion={0.1}
        distortionScale={0.2}
        temporalDistortion={0.05}
        color="#01d4c8"
        transmission={0.95}
        roughness={0.05}
        ior={1.5}
        toneMapped={true}
      />
    </mesh>
  );
}

/* ---------- middle rotated glass ---------- */
function MiddleCore() {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((_, delta) => {
    ref.current.rotation.y -= delta * 0.12;
    ref.current.rotation.z += delta * 0.05;
  });
  return (
    <mesh ref={ref} scale={1.35} rotation={[0.3, 0.5, 0.2]}>
      <boxGeometry args={[1, 1, 1, 3, 3, 3]} />
      <MeshTransmissionMaterial
        backside
        samples={4}
        thickness={0.3}
        chromaticAberration={0.04}
        transmission={0.9}
        roughness={0.1}
        color="#0ff5e6"
        ior={1.4}
        toneMapped={true}
      />
    </mesh>
  );
}

/* ---------- inner luminous core ---------- */
function InnerCore() {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    ref.current.scale.setScalar(0.55 + Math.sin(t * 1.2) * 0.05);
  });
  return (
    <mesh ref={ref}>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial
        color="#01d4c8"
        emissive="#01d4c8"
        emissiveIntensity={2.5}
        transparent
        opacity={0.9}
        toneMapped={false}
      />
    </mesh>
  );
}

/* ---------- orbital rings ---------- */
function OrbitalRing({ radius, speed, tilt, color }: {
  radius: number;
  speed: number;
  tilt: [number, number, number];
  color: string;
}) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((_, delta) => {
    ref.current.rotation.z += delta * speed;
  });
  return (
    <mesh ref={ref} rotation={tilt}>
      <torusGeometry args={[radius, 0.008, 16, 128]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.6}
        transparent
        opacity={0.35}
        toneMapped={false}
      />
    </mesh>
  );
}

/* ---------- floating particles ---------- */
function Particles({ count = 200 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null!);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 3 + Math.random() * 5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i * 3 + 2] = r * Math.cos(phi);
    }
    return arr;
  }, [count]);

  useFrame((state) => {
    ref.current.rotation.y = state.clock.elapsedTime * 0.015;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.025}
        color="#01d4c8"
        transparent
        opacity={0.5}
        sizeAttenuation
        toneMapped={false}
      />
    </points>
  );
}

/* ---------- orbiting nodes ---------- */
function OrbitNode({ orbitRadius, speed, offset, color, size = 0.06 }: {
  orbitRadius: number;
  speed: number;
  offset: number;
  color: string;
  size?: number;
}) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((state) => {
    const t = state.clock.elapsedTime * speed + offset;
    ref.current.position.x = Math.cos(t) * orbitRadius;
    ref.current.position.z = Math.sin(t) * orbitRadius;
    ref.current.position.y = Math.sin(t * 0.5) * 0.3;
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[size, 16, 16]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={1.5}
        toneMapped={false}
      />
    </mesh>
  );
}

/* ---------- ground reflection plane ---------- */
function GroundPlane() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.8, 0]}>
      <planeGeometry args={[20, 20]} />
      <meshStandardMaterial
        color="#050607"
        transparent
        opacity={0.6}
        roughness={0.9}
      />
    </mesh>
  );
}

/* ---------- scene composition ---------- */
function Scene() {
  return (
    <>
      <ambientLight intensity={0.15} />
      <directionalLight position={[5, 5, 5]} intensity={0.4} color="#e8ecef" />
      <pointLight position={[-3, 2, -3]} intensity={0.3} color="#4c8dff" />
      <pointLight position={[3, -2, 3]} intensity={0.2} color="#c86bdb" />
      <spotLight
        position={[0, 6, 0]}
        angle={0.5}
        penumbra={1}
        intensity={0.6}
        color="#01d4c8"
        castShadow={false}
      />

      <Float speed={0.8} rotationIntensity={0.15} floatIntensity={0.3}>
        <group>
          <OuterCore />
          <MiddleCore />
          <InnerCore />
        </group>
      </Float>

      <OrbitalRing radius={3.0} speed={0.15} tilt={[1.2, 0, 0.3]} color="#01d4c8" />
      <OrbitalRing radius={3.5} speed={-0.1} tilt={[0.8, 0.4, 0]} color="#01d4c8" />
      <OrbitalRing radius={4.0} speed={0.08} tilt={[0.3, 1.0, 0.5]} color="#4c8dff" />
      <OrbitalRing radius={2.6} speed={-0.2} tilt={[1.5, 0.2, 0.1]} color="#01d4c8" />

      <OrbitNode orbitRadius={3.2} speed={0.4} offset={0} color="#01d4c8" />
      <OrbitNode orbitRadius={3.6} speed={0.3} offset={2} color="#4c8dff" size={0.05} />
      <OrbitNode orbitRadius={4.1} speed={0.25} offset={4} color="#c86bdb" size={0.04} />
      <OrbitNode orbitRadius={2.8} speed={0.5} offset={1} color="#e8a33d" size={0.045} />
      <OrbitNode orbitRadius={3.8} speed={0.35} offset={3} color="#01d4c8" size={0.055} />

      <Particles count={180} />
      <GroundPlane />

      <Environment preset="night" />
      <EffectComposer>
        <Bloom
          luminanceThreshold={0.6}
          luminanceSmoothing={0.4}
          intensity={0.5}
          mipmapBlur
        />
      </EffectComposer>
    </>
  );
}

/* ---------- WebGL fallback ---------- */
function WebGLFallback() {
  return (
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "radial-gradient(ellipse at center, rgba(1, 212, 200, 0.06) 0%, transparent 60%)",
      borderRadius: "16px",
    }}>
      <div style={{
        width: 160,
        height: 160,
        border: "1px solid rgba(1, 212, 200, 0.2)",
        borderRadius: "20px",
        background: "rgba(1, 212, 200, 0.03)",
        boxShadow: "0 0 60px rgba(1, 212, 200, 0.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform: "rotate(45deg)",
      }}>
        <div style={{
          width: 60,
          height: 60,
          borderRadius: "12px",
          background: "rgba(1, 212, 200, 0.15)",
          boxShadow: "0 0 30px rgba(1, 212, 200, 0.2)",
        }} />
      </div>
    </div>
  );
}

/* ---------- exported component ---------- */
export function ResearchCoreScene() {
  return (
    <Suspense fallback={<WebGLFallback />}>
      <Canvas
        camera={{ position: [0, 1.5, 7], fov: 45 }}
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.2,
        }}
        style={{ background: "transparent" }}
      >
        <Scene />
      </Canvas>
    </Suspense>
  );
}
