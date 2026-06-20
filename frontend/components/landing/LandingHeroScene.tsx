"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useDecorativeMotionEnabled } from "@/lib/use-decorative-motion";

type SceneObject = THREE.Mesh | THREE.LineSegments | THREE.Points;

function disposeObject(object: SceneObject) {
  object.geometry.dispose();
  const material = object.material;
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
  } else {
    material.dispose();
  }
}

export function LandingHeroScene() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [webGLAvailable, setWebGLAvailable] = useState(true);
  const [sceneReady, setSceneReady] = useState(false);
  const motionEnabled = useDecorativeMotionEnabled({
    disableOnCoarsePointer: false,
    disableOnSmallScreen: false,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === "undefined") return;

    if (!window.WebGLRenderingContext) {
      setWebGLAvailable(false);
      setSceneReady(true);
      return;
    }

    let frameId = 0;
    let disposed = false;
    const startedAt = performance.now();
    const pointer = new THREE.Vector2(0, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    const group = new THREE.Group();
    const renderables: SceneObject[] = [];

    camera.position.set(0, 0.15, 8.2);
    group.position.set(0, 0.28, 0);
    scene.add(group);

    const contextAttributes: WebGLContextAttributes = {
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: process.env.NODE_ENV !== "production",
    };
    const webGLContext =
      canvas.getContext("webgl2", contextAttributes) ||
      canvas.getContext("webgl", contextAttributes);

    if (!webGLContext) {
      setWebGLAvailable(false);
      setSceneReady(true);
      return;
    }

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas,
      context: webGLContext as WebGLRenderingContext,
      powerPreference: "high-performance",
      preserveDrawingBuffer: process.env.NODE_ENV !== "production",
    });

    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.15, 2),
      new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        wireframe: true,
        transparent: true,
        opacity: 0.72,
      }),
    );
    core.rotation.set(0.25, 0.1, 0.05);
    group.add(core);
    renderables.push(core);

    const shell = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.DodecahedronGeometry(2.05, 1)),
      new THREE.LineBasicMaterial({
        color: 0x7c5cff,
        transparent: true,
        opacity: 0.34,
      }),
    );
    group.add(shell);
    renderables.push(shell);

    const orbitMaterials = [
      { color: 0x00ffff, opacity: 0.34, rotation: [0.78, 0.1, 0.36] },
      { color: 0x23d18b, opacity: 0.24, rotation: [1.3, 0.46, 0.02] },
      { color: 0xffb800, opacity: 0.2, rotation: [0.2, 1.08, 0.84] },
    ] as const;

    orbitMaterials.forEach((orbit, index) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2.55 + index * 0.42, 0.008, 8, 160),
        new THREE.MeshBasicMaterial({
          color: orbit.color,
          transparent: true,
          opacity: orbit.opacity,
        }),
      );
      ring.rotation.set(orbit.rotation[0], orbit.rotation[1], orbit.rotation[2]);
      group.add(ring);
      renderables.push(ring);
    });

    const nodePositions: number[] = [];
    const connectionPositions: number[] = [];
    const nodeCount = 72;
    for (let i = 0; i < nodeCount; i += 1) {
      const radius = 2.15 + ((i % 6) * 0.18);
      const phi = Math.acos(-1 + (2 * i) / nodeCount);
      const theta = Math.sqrt(nodeCount * Math.PI) * phi;
      const x = radius * Math.cos(theta) * Math.sin(phi);
      const y = radius * Math.sin(theta) * Math.sin(phi) * 0.78;
      const z = radius * Math.cos(phi) * 0.78;
      nodePositions.push(x, y, z);

      if (i % 3 === 0 && i + 3 < nodeCount) {
        connectionPositions.push(x, y, z);
        connectionPositions.push(
          radius * Math.cos(theta + 0.52) * Math.sin(phi + 0.08),
          radius * Math.sin(theta + 0.52) * Math.sin(phi + 0.08) * 0.78,
          radius * Math.cos(phi + 0.08) * 0.78,
        );
      }
    }

    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute("position", new THREE.Float32BufferAttribute(nodePositions, 3));
    const points = new THREE.Points(
      pointsGeometry,
      new THREE.PointsMaterial({
        color: 0xb9ffff,
        size: 0.035,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.82,
      }),
    );
    group.add(points);
    renderables.push(points);

    const connectionsGeometry = new THREE.BufferGeometry();
    connectionsGeometry.setAttribute("position", new THREE.Float32BufferAttribute(connectionPositions, 3));
    const connections = new THREE.LineSegments(
      connectionsGeometry,
      new THREE.LineBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.16,
      }),
    );
    group.add(connections);
    renderables.push(connections);

    const panels = [
      { x: -3.2, y: 0.82, z: -0.6, color: 0x23d18b },
      { x: 3.1, y: -0.9, z: -0.8, color: 0xffb800 },
      { x: -2.65, y: -1.62, z: 0.2, color: 0x7c5cff },
    ];

    panels.forEach((panel) => {
      const card = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1.3, 0.62, 0.04)),
        new THREE.LineBasicMaterial({
          color: panel.color,
          transparent: true,
          opacity: 0.34,
        }),
      );
      card.position.set(panel.x, panel.y, panel.z);
      card.rotation.set(-0.06, panel.x > 0 ? -0.32 : 0.32, 0.03);
      group.add(card);
      renderables.push(card);
    });

    const resize = () => {
      if (disposed) return;
      const parent = canvas.parentElement;
      const width = parent?.clientWidth || window.innerWidth;
      const height = parent?.clientHeight || Math.min(window.innerHeight, 720);
      const pixelRatio = window.innerWidth < 768 ? 1 : Math.min(window.devicePixelRatio, 1.75);
      const isSmallScreen = width < 640;
      group.position.y = isSmallScreen ? 0.34 : 0.28;
      group.scale.setScalar(isSmallScreen ? 0.9 : 1);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };

    const handlePointerMove = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
    };

    const render = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      group.rotation.y = elapsed * 0.12 + pointer.x * 0.18;
      group.rotation.x = -0.12 + pointer.y * 0.08;
      core.rotation.x = elapsed * 0.19;
      core.rotation.y = elapsed * 0.26;
      shell.rotation.y = -elapsed * 0.08;
      points.rotation.y = elapsed * 0.05;
      connections.rotation.y = elapsed * 0.05;
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(render);
    };

    resize();
    setSceneReady(true);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });

    if (motionEnabled) {
      frameId = window.requestAnimationFrame(render);
    } else {
      renderer.render(scene, camera);
    }

    return () => {
      disposed = true;
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      if (frameId) window.cancelAnimationFrame(frameId);
      renderables.forEach(disposeObject);
      renderer.dispose();
    };
  }, [motionEnabled]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {!sceneReady ? (
        <div className="absolute inset-x-[10%] top-[6%] h-[38rem] rounded-full bg-[radial-gradient(circle,rgba(0,255,255,0.16),transparent_64%)] opacity-55 blur-3xl" />
      ) : null}
      {!webGLAvailable ? (
        <div className="absolute left-1/2 top-[16%] h-[30rem] w-[min(72vw,48rem)] -translate-x-1/2 rounded-[4rem] border border-cyan-300/15 bg-[linear-gradient(135deg,rgba(0,255,255,0.16),rgba(124,92,255,0.1),transparent)] opacity-65 shadow-[0_0_120px_rgba(0,255,255,0.16)]" />
      ) : (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full opacity-70 mix-blend-screen sm:opacity-80"
          data-omnix-hero-canvas="true"
        />
      )}
      <div className="absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(ellipse_at_50%_20%,rgba(0,255,255,0.12),transparent_60%)]" />
      <div className="absolute inset-x-0 bottom-0 h-[58%] bg-[linear-gradient(180deg,rgba(6,16,32,0)_0%,rgba(6,16,32,0.46)_42%,rgba(6,16,32,0.9)_100%)]" />
      <div className="absolute inset-x-0 top-[42%] h-[28rem] bg-[radial-gradient(ellipse_at_50%_50%,rgba(6,16,32,0.36),transparent_72%)]" />
    </div>
  );
}
