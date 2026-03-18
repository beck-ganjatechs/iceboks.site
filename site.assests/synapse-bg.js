// Synaptic Neuron Fatigue Web — shared background for all pages
// Hexagonal neural network with signal propagation and fatigue mechanics
// Covers 100% of viewport, fixed position, subtle opacity
(function() {
  const canvas = document.getElementById('synapse-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, cx, cy, mx = -9999, my = -9999, t = 0;

  const nodes = [];
  const edges = [];
  const signals = [];

  function resize() {
    W = canvas.width = innerWidth;
    H = canvas.height = innerHeight;
    cx = W / 2;
    cy = H / 2;
    buildNetwork();
  }

  function buildNetwork() {
    nodes.length = 0;
    edges.length = 0;
    signals.length = 0;

    const spacing = Math.min(W, H) * 0.07;

    // Center node
    nodes.push({ x: cx, y: cy, energy: 0.2, fatigue: 0, cooldown: 0, ring: 0 });

    // Hexagonal rings — enough to cover full viewport
    const maxRing = Math.ceil(Math.max(W, H) / spacing / 1.5) + 1;
    for (let ring = 1; ring <= maxRing; ring++) {
      const r = ring * spacing;
      const count = ring * 6;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        const nx = cx + r * Math.cos(angle);
        const ny = cy + r * Math.sin(angle);
        // Include nodes slightly outside viewport for edge connections
        if (nx > -spacing && nx < W + spacing && ny > -spacing && ny < H + spacing) {
          nodes.push({ x: nx, y: ny, energy: 0.15, fatigue: 0, cooldown: 0, ring: ring });
        }
      }
    }

    // Build edges: connect nearby nodes
    const maxDist = spacing * 1.3;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
        if (d < maxDist) {
          edges.push({ a: i, b: j, pulse: 0 });
        }
      }
    }
  }

  resize();
  addEventListener('resize', resize);
  addEventListener('mousemove', function(e) { mx = e.clientX; my = e.clientY; });

  function fireNode(idx) {
    const node = nodes[idx];
    if (node.cooldown > 0) return;
    node.energy = 1;
    node.fatigue += 0.2;
    if (node.fatigue >= 1) {
      node.cooldown = 180;
      node.fatigue = 1;
    }
    for (const e of edges) {
      let neighbor = -1;
      if (e.a === idx) neighbor = e.b;
      else if (e.b === idx) neighbor = e.a;
      if (neighbor >= 0) {
        signals.push({
          from: idx, to: neighbor, edge: e,
          progress: 0, speed: 0.025 + Math.random() * 0.015
        });
        e.pulse = 1;
      }
    }
  }

  function animate() {
    ctx.fillStyle = 'rgba(6, 6, 8, 0.12)';
    ctx.fillRect(0, 0, W, H);
    t++;

    // Update nodes
    for (const n of nodes) {
      n.energy *= 0.97;
      n.fatigue = Math.max(0, n.fatigue - 0.0004);
      if (n.cooldown > 0) {
        n.cooldown--;
        if (n.cooldown === 0) n.fatigue = 0.3;
      }
      // Mouse proximity glow
      const md = Math.hypot(n.x - mx, n.y - my);
      if (md < 100) {
        n.energy = Math.max(n.energy, (1 - md / 100) * 0.4);
      }
    }

    // Update signals
    for (let i = signals.length - 1; i >= 0; i--) {
      const s = signals[i];
      s.progress += s.speed;
      if (s.progress >= 1) {
        fireNode(s.to);
        signals.splice(i, 1);
      }
    }

    // Draw edges
    for (const e of edges) {
      const a = nodes[e.a], b = nodes[e.b];
      e.pulse *= 0.96;
      const baseAlpha = 0.04;
      const alpha = baseAlpha + e.pulse * 0.4;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (e.pulse > 0.1) {
        ctx.strokeStyle = 'rgba(168, 85, 247, ' + alpha + ')';
      } else {
        ctx.strokeStyle = 'rgba(80, 85, 100, ' + alpha + ')';
      }
      ctx.lineWidth = 0.4 + e.pulse * 1.5;
      ctx.stroke();
    }

    // Draw signals
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of signals) {
      const a = nodes[s.from], b = nodes[s.to];
      const x = a.x + (b.x - a.x) * s.progress;
      const y = a.y + (b.y - a.y) * s.progress;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, 6);
      grad.addColorStop(0, 'rgba(168, 85, 247, 0.6)');
      grad.addColorStop(0.5, 'rgba(107, 33, 168, 0.2)');
      grad.addColorStop(1, 'rgba(107, 33, 168, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - 6, y - 6, 12, 12);
    }
    ctx.restore();

    // Draw nodes
    for (const n of nodes) {
      const isDark = n.cooldown > 0;
      const brightness = isDark ? 0.03 : (0.1 + n.energy * 0.6);
      const r = isDark ? 1.5 : (2 + n.energy * 2);

      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      if (isDark) {
        ctx.fillStyle = 'rgba(30, 30, 40, ' + brightness + ')';
      } else if (n.energy > 0.3) {
        ctx.fillStyle = 'rgba(168, 85, 247, ' + brightness + ')';
      } else {
        ctx.fillStyle = 'rgba(140, 150, 170, ' + brightness + ')';
      }
      ctx.fill();

      if (n.energy > 0.4 && !isDark) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(168, 85, 247, ' + (n.energy * 0.1) + ')';
        ctx.fill();
      }
    }

    // Spontaneous firing
    if (Math.random() < 0.008) {
      fireNode(Math.floor(Math.random() * nodes.length));
    }

    requestAnimationFrame(animate);
  }
  animate();
})();
