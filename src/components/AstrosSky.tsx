"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

// ASTROS SKY — a living deep-space star map for Hermes Astros.
// The canvas is TRANSPARENT: the nebula backdrop is painted by the host div as a
// full-bleed CSS cover (no black bars at any aspect ratio). On top: parallax
// starfield, drifting aurora glows, clickable topic stars in a constellation —
// and HERMES HIMSELF as a living actor: he glides through the deep field, and
// every so often swoops across the whole sky in a blaze with a sparkle trail.

export interface SkyTopic { topic: string; heat: number; category: string }

const CAT_COLOR: Record<string, number> = {
  Models: 0x4deeff, Agents: 0x50f2a8, Tools: 0xb18cff, SEO: 0xc8f25a, Drama: 0xff6d8a, Money: 0xffd86b,
};

function starTexture(core = "#ffffff"): THREE.Texture {
  const S = 128;
  const cv = document.createElement("canvas"); cv.width = cv.height = S;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, core); g.addColorStop(0.18, core); g.addColorStop(0.4, "rgba(160,190,255,.35)"); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = "lighter";
  const f = ctx.createLinearGradient(0, S / 2, S, S / 2);
  f.addColorStop(0, "rgba(255,255,255,0)"); f.addColorStop(0.5, "rgba(255,255,255,.75)"); f.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = f; ctx.fillRect(0, S / 2 - 1.6, S, 3.2);
  const f2 = ctx.createLinearGradient(S / 2, 0, S / 2, S);
  f2.addColorStop(0, "rgba(255,255,255,0)"); f2.addColorStop(0.5, "rgba(255,255,255,.65)"); f2.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = f2; ctx.fillRect(S / 2 - 1.6, 0, 3.2, S);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture(rgb: string): THREE.Texture {
  const S = 256;
  const cv = document.createElement("canvas"); cv.width = cv.height = S;
  const ctx = cv.getContext("2d")!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, `rgba(${rgb},.55)`); g.addColorStop(0.5, `rgba(${rgb},.16)`); g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default function AstrosSky({ topics, sweeping, activeIndex, onSelect }: {
  topics: SkyTopic[]; sweeping: boolean; activeIndex: number | null; onSelect: (i: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ sweeping, activeIndex });
  useEffect(() => { stateRef.current = { sweeping, activeIndex }; }, [sweeping, activeIndex]);
  const topicsKey = topics.map((t) => t.topic + t.heat).join("|");

  useEffect(() => {
    const host = hostRef.current; if (!host) return;
    let W = host.clientWidth, H = host.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0); // fully transparent — nebula is CSS cover on the host
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(58, W / H, 0.1, 400);
    camera.position.set(0, 0, 46);

    // ---- HERMES — the living constellation figure
    // The icon's background is dark-blue (not pure black), so a raw additive plane
    // shows a square edge over the nebula. Mask it: radial vignette to transparent
    // + subtract the background floor so only the golden figure + stars remain.
    const heroMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const heroImg = new Image();
    heroImg.onload = () => {
      const S = 512;
      const cv = document.createElement("canvas"); cv.width = cv.height = S;
      const ctx = cv.getContext("2d")!;
      ctx.drawImage(heroImg, 0, 0, S, S);
      // darken the floor: pull everything toward black so the bg vanishes under additive
      const d = ctx.getImageData(0, 0, S, S);
      const a = d.data;
      for (let i = 0; i < a.length; i += 4) {
        a[i] = Math.max(0, a[i] - 34); a[i + 1] = Math.max(0, a[i + 1] - 34); a[i + 2] = Math.max(0, a[i + 2] - 40);
      }
      ctx.putImageData(d, 0, 0);
      // radial vignette → edges fully transparent, no square
      ctx.globalCompositeOperation = "destination-in";
      const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S * 0.5);
      g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.72, "rgba(255,255,255,.85)"); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
      heroMat.map = t; heroMat.needsUpdate = true;
    };
    heroImg.src = "/astros/face.png";
    const hero = new THREE.Mesh(new THREE.PlaneGeometry(52, 52), heroMat);
    hero.position.set(26, 2, -60);
    scene.add(hero);
    const heroGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("255,216,107"), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
    heroGlow.scale.setScalar(70); heroGlow.position.copy(hero.position);
    scene.add(heroGlow);

    // hero swoop state: he periodically blazes across the sky leaving a sparkle trail
    const swoop = { active: false, t: 0, dur: 5.2, from: new THREE.Vector3(), to: new THREE.Vector3(), next: 7 + Math.random() * 6 };
    const trailTex = starTexture("#ffe9b0");
    const trail: { m: THREE.Sprite; life: number }[] = [];
    function spawnTrail(p: THREE.Vector3) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: trailTex, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 0));
      m.scale.setScalar(1 + Math.random() * 2.2);
      scene.add(m);
      trail.push({ m, life: 1.4 });
    }

    // ---- parallax starfield (3 depth layers)
    const starTex = starTexture();
    const layers: THREE.Points[] = [];
    const layerSpec = [
      { n: 900, spread: 260, z: [-110, -60], size: 1.1, op: 0.5 },
      { n: 500, spread: 190, z: [-60, -25], size: 1.8, op: 0.7 },
      { n: 220, spread: 140, z: [-25, -4], size: 2.6, op: 0.9 },
    ];
    for (const L of layerSpec) {
      const pos = new Float32Array(L.n * 3);
      for (let i = 0; i < L.n; i++) {
        pos[i * 3] = (Math.random() - 0.5) * L.spread;
        pos[i * 3 + 1] = (Math.random() - 0.5) * (L.spread * 0.55);
        pos[i * 3 + 2] = L.z[0] + Math.random() * (L.z[1] - L.z[0]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ map: starTex, size: L.size, transparent: true, opacity: L.op, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xcfe2ff });
      const pts = new THREE.Points(geo, mat);
      scene.add(pts); layers.push(pts);
    }

    // ---- drifting aurora glow sprites (soft colour wash over the CSS nebula)
    const glows: THREE.Sprite[] = [];
    for (const [rgb, x, y, s] of [["77,238,255", -46, 12, 70], ["255,77,216", 42, -10, 64], ["167,139,250", -8, -16, 80]] as [string, number, number, number][]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(rgb), transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.position.set(x, y, -55); sp.scale.setScalar(s);
      scene.add(sp); glows.push(sp);
    }

    // ---- topic stars: a constellation arc
    const group = new THREE.Group(); scene.add(group);
    const starSprites: THREE.Sprite[] = [];
    const ringSprites: THREE.Sprite[] = [];
    const n = topics.length;
    const positions: THREE.Vector3[] = topics.map((t, i) => {
      const fx = n > 1 ? i / (n - 1) : 0.5;
      const x = -30 + fx * 60;
      const y = Math.sin(fx * Math.PI * 1.15 + 0.4) * 9 + ((i % 2) ? -3.4 : 3.4);
      return new THREE.Vector3(x, y, -6 - (i % 3) * 3);
    });
    const texCache: Record<string, THREE.Texture> = {};
    topics.forEach((t, i) => {
      const col = CAT_COLOR[t.category] ?? 0xb18cff;
      const hex = "#" + col.toString(16).padStart(6, "0");
      texCache[hex] = texCache[hex] || starTexture(hex);
      const size = 3.2 + (t.heat / 100) * 3.4;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texCache[hex], transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      sp.position.copy(positions[i]); sp.scale.setScalar(size);
      sp.userData = { index: i, baseSize: size };
      group.add(sp); starSprites.push(sp);
      const rgb = `${(col >> 16) & 255},${(col >> 8) & 255},${col & 255}`;
      const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(rgb), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.position.copy(positions[i]); ring.scale.setScalar(size * 2.6);
      group.add(ring); ringSprites.push(ring);
    });
    if (positions.length > 1) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints(positions);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x9fb6ff, transparent: true, opacity: 0.28 }));
      group.add(line);
    }

    // ---- shooting stars
    const shots: { m: THREE.Sprite; v: THREE.Vector3; life: number }[] = [];
    const shotTex = starTexture("#dffcff");
    function spawnShot() {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: shotTex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.position.set(-60 + Math.random() * 40, 20 + Math.random() * 8, -30 - Math.random() * 30);
      m.scale.setScalar(1.6 + Math.random() * 1.4);
      scene.add(m);
      shots.push({ m, v: new THREE.Vector3(18 + Math.random() * 10, -7 - Math.random() * 4, 0), life: 2.4 });
    }

    // ---- scan wave
    const wave = new THREE.Mesh(
      new THREE.RingGeometry(0.98, 1, 96),
      new THREE.MeshBasicMaterial({ color: 0x4deeff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
    );
    wave.position.set(0, 0, -8);
    scene.add(wave);

    // ---- interactivity
    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2(-2, -2);
    let hover = -1;
    const px = { x: 0, y: 0 };
    function onMove(e: MouseEvent) {
      const r = host!.getBoundingClientRect();
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      px.x = mouse.x; px.y = mouse.y;
    }
    function onClick() { if (hover >= 0) onSelect(hover); }
    host.addEventListener("mousemove", onMove);
    host.addEventListener("click", onClick);

    function onResize() {
      W = host!.clientWidth; H = host!.clientHeight;
      camera.aspect = W / H; camera.updateProjectionMatrix();
      renderer.setSize(W, H);
    }
    const ro = new ResizeObserver(onResize); ro.observe(host);

    let raf = 0; let tPrev = performance.now(); let shotTimer = 1.6; let waveR = 1;
    const clock = { t: 0 };
    function tick() {
      raf = requestAnimationFrame(tick);
      const now = performance.now(); const dt = Math.min(0.05, (now - tPrev) / 1000); tPrev = now;
      const { sweeping: sw, activeIndex: act } = stateRef.current;
      clock.t += dt * (sw ? 2.1 : 1);

      camera.position.x += ((px.x * 3.2) - camera.position.x) * 0.04;
      camera.position.y += ((px.y * 1.8 + Math.sin(clock.t * 0.35) * 0.5) - camera.position.y) * 0.04;
      camera.lookAt(0, 0, -20);

      layers.forEach((L, k) => { L.rotation.z += dt * 0.004 * (k + 1) * (sw ? 3 : 1); });
      glows.forEach((g, k) => {
        g.position.x += Math.sin(clock.t * 0.14 + k * 2.4) * dt * 1.1;
        g.position.y += Math.cos(clock.t * 0.11 + k * 1.7) * dt * 0.7;
        (g.material as THREE.SpriteMaterial).opacity = 0.2 + Math.sin(clock.t * 0.5 + k) * 0.08;
      });

      // ---- HERMES: glide, flash, and periodically SWOOP across the whole sky
      if (!swoop.active) {
        swoop.next -= dt;
        // idle glide: a slow figure-8 drift in the deep field
        hero.position.x = 26 + Math.sin(clock.t * 0.16) * 7;
        hero.position.y = 2 + Math.sin(clock.t * 0.23) * 4;
        hero.rotation.z = Math.sin(clock.t * 0.2) * 0.06;
        heroMat.opacity = 0.42 + Math.sin(clock.t * 0.7) * 0.1 + (sw ? 0.15 : 0);
        // random pre-swoop flash
        if (Math.sin(clock.t * 0.9) > 0.996) heroMat.opacity = 0.85;
        if (swoop.next <= 0) {
          swoop.active = true; swoop.t = 0;
          const dir = Math.random() > 0.5 ? 1 : -1;
          swoop.from.set(-dir * 75, -8 + Math.random() * 20, -46);
          swoop.to.set(dir * 75, -8 + Math.random() * 20, -46);
          hero.position.copy(swoop.from);
        }
      } else {
        swoop.t += dt;
        const f = Math.min(1, swoop.t / swoop.dur);
        const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2; // easeInOut
        hero.position.lerpVectors(swoop.from, swoop.to, e);
        hero.position.y += Math.sin(f * Math.PI) * 9; // arc over the constellation
        hero.rotation.z = (swoop.to.x > swoop.from.x ? -1 : 1) * Math.sin(f * Math.PI) * 0.14;
        heroMat.opacity = 0.35 + Math.sin(f * Math.PI) * 0.6; // blaze at the apex
        if (Math.random() < 0.7) spawnTrail(hero.position);
        if (f >= 1) { swoop.active = false; swoop.next = 12 + Math.random() * 10; }
      }
      heroGlow.position.copy(hero.position);
      (heroGlow.material as THREE.SpriteMaterial).opacity = heroMat.opacity * 0.55;
      heroGlow.scale.setScalar(64 + Math.sin(clock.t * 0.8) * 6);

      // hero sparkle trail decay
      for (let i = trail.length - 1; i >= 0; i--) {
        const s = trail[i];
        s.life -= dt;
        (s.m.material as THREE.SpriteMaterial).opacity = Math.max(0, s.life / 1.4) * 0.85;
        s.m.position.y -= dt * 1.5;
        if (s.life <= 0) { scene.remove(s.m); s.m.material.dispose(); trail.splice(i, 1); }
      }

      // topic star pulse + hover/active
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObjects(starSprites, false);
      hover = hits.length ? (hits[0].object.userData.index as number) : -1;
      host!.style.cursor = hover >= 0 ? "pointer" : "default";
      starSprites.forEach((sp, i) => {
        const base = sp.userData.baseSize as number;
        const pulse = 1 + Math.sin(clock.t * 1.6 + i * 1.3) * 0.08;
        const target = base * pulse * (i === hover ? 1.45 : 1) * (i === act ? 1.35 : 1);
        sp.scale.setScalar(sp.scale.x + (target - sp.scale.x) * 0.15);
        ringSprites[i].scale.setScalar(sp.scale.x * (2.4 + Math.sin(clock.t * 1.1 + i) * 0.3));
        (ringSprites[i].material as THREE.SpriteMaterial).opacity = (i === act ? 0.85 : 0.42) + Math.sin(clock.t * 1.6 + i) * 0.1;
      });

      // shooting stars
      shotTimer -= dt;
      if (shotTimer <= 0) { spawnShot(); shotTimer = sw ? 0.8 + Math.random() * 1.2 : 2.5 + Math.random() * 4; }
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.life -= dt; s.m.position.addScaledVector(s.v, dt);
        (s.m.material as THREE.SpriteMaterial).opacity = Math.max(0, s.life / 2.4) * 0.9;
        if (s.life <= 0) { scene.remove(s.m); s.m.material.dispose(); shots.splice(i, 1); }
      }

      // scan wave
      const wm = wave.material as THREE.MeshBasicMaterial;
      if (sw) {
        waveR += dt * 26; if (waveR > 70) waveR = 1;
        wave.scale.setScalar(waveR);
        wm.opacity = Math.max(0, 0.5 * (1 - waveR / 70));
      } else if (wm.opacity > 0) { wm.opacity = Math.max(0, wm.opacity - dt); }

      renderer.render(scene, camera);
    }
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener("mousemove", onMove);
      host.removeEventListener("click", onClick);
      renderer.dispose();
      scene.traverse((o) => {
        const anyO = o as unknown as { geometry?: { dispose(): void }; material?: THREE.Material | THREE.Material[] };
        anyO.geometry?.dispose?.();
        const m = anyO.material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose()); else m?.dispose?.();
      });
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicsKey]);

  return <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />;
}
