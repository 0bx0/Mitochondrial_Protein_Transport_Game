const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

// Initial setup
let canvasInitialized = false;

function resize() {
    const container = canvas.parentElement;
    const r = container.getBoundingClientRect();

    // Capture old width for proportional adjustment
    const oldW = canvas.width;

    canvas.width = r.width;
    canvas.height = r.height;

    // Adjust protein position if resize happens during simulation
    if (state.pos.x > 0 && oldW > 0) {
        state.pos.x = state.pos.x * (canvas.width / oldW);
    }

    if (!canvasInitialized && r.width > 0) {
        canvasInitialized = true;
        init();
    }
}
window.addEventListener('resize', resize);
// Defer initial resize to ensure layout is computed
setTimeout(resize, 50);

// --- Configuration ---
const ZONES = {
    cyto: { y: 0, h: 0.25, color: '#f9f9f9', label: "Cytosol" },
    om: { y: 0.25, h: 0.05, color: '#95a5a6', label: "Outer Membrane" },
    ims: { y: 0.30, h: 0.20, color: '#fff9c4', label: "Intermembrane Space" },
    im: { y: 0.50, h: 0.05, color: '#7f8c8d', label: "Inner Membrane" },
    matrix: { y: 0.55, h: 0.45, color: '#e8f6f3', label: "Matrix" }
};

const COMPLEXES = {
    tom: { x: 0.5, yZone: 'om', color: '#3498db', label: 'TOM' }, // Blue
    sam: { x: 0.85, yZone: 'om', color: '#3498db', label: 'SAM' }, // Blue
    tim23: { x: 0.5, yZone: 'im', color: '#2ecc71', label: 'TIM23' }, // Green
    tim22: { x: 0.2, yZone: 'im', color: '#2ecc71', label: 'TIM22' }  // Green
};

const PROTEIN_TYPES = [
    {
        id: 'tom_tim23',
        name: 'Matrix Enzyme',
        dest: 'Target: Matrix',
        desc: 'Has N-terminal presequence. Needs to cross both membranes to reach the core.',
        color: '#e74c3c', // Red
        signalColor: '#f1c40f'
    },
    {
        id: 'tom_tim22',
        name: 'Carrier Protein',
        dest: 'Target: Inner Membrane',
        desc: 'Multipass hydrophobic protein. Needs to be inserted into the Inner Membrane.',
        color: '#e74c3c', // Red
        signalColor: '#2ecc71'
    },
    {
        id: 'tom_small_tims',
        name: 'IMS Chaperone',
        dest: 'Target: Intermembrane Space',
        desc: 'Cysteine-rich protein. Needs to be kept in the space between membranes.',
        color: '#e74c3c', // Red
        signalColor: '#f39c12'
    },
    {
        id: 'tom_sam',
        name: 'Beta-Barrel Porin',
        dest: 'Target: Outer Membrane',
        desc: 'Beta-sheet structure. Needs to insert into the Outer Membrane.',
        color: '#e74c3c', // Red
        signalColor: '#9b59b6'
    }
];

// --- State ---
let state = {
    score: 0,
    caseIndex: 0,
    protein: null,
    phase: 'idle',
    pos: { x: 0, y: 0 },
    targetPath: null,
    pathPoints: [],
    smallTims: [], // Visual particles
    timer: 0 // New timer for event sequencing
};

function init() {
    spawnProtein();
    requestAnimationFrame(loop);
}

function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
}

function spawnProtein() {
    const typeIndex = state.caseIndex % PROTEIN_TYPES.length;
    state.protein = PROTEIN_TYPES[typeIndex];

    state.phase = 'spawning';
    // Ensure width is valid, fallback to window center if canvas width is weird
    const startX = canvas.width > 0 ? canvas.width * 0.5 : 300;
    state.pos = { x: startX, y: 20 };

    state.targetPath = null;
    state.pathPoints = [];
    state.smallTims = [];
    state.timer = 0; // Reset timer

    // UI
    document.getElementById('pName').innerText = state.protein.name;
    document.getElementById('pDest').innerText = state.protein.dest;
    document.getElementById('pDesc').innerText = state.protein.desc;
    document.getElementById('caseNum').innerText = state.caseIndex + 1;

    toggleButtons(true);
    hideOverlay();
}

function selectPath(pathId) {
    if (state.phase !== 'idle' && state.phase !== 'spawning') return;
    state.targetPath = pathId;
    toggleButtons(false);
    state.phase = 'moving_tom';
    state.timer = 0; // Reset timer for move phase
}

function update() {
    if (!state.protein) return;

    const tomY = (ZONES.om.y * canvas.height);
    const imsY = (ZONES.ims.y * canvas.height) + (ZONES.ims.h * canvas.height) / 2;
    const tim23Y = (ZONES.im.y * canvas.height);
    const speed = 4;
    const jitter = () => (Math.random() - 0.5) * 2;

    // Global: Update Chaperones if they exist
    updateSmallTIMs();

    // 1. Spawning
    if (state.phase === 'spawning') {
        state.pos.y += 2;
        if (state.pos.y > 50) state.phase = 'idle';
    }

    // 2. To TOM
    else if (state.phase === 'moving_tom') {
        moveTo(canvas.width * COMPLEXES.tom.x, tomY - 20, speed, () => {
            state.phase = 'translocate_tom';
        });
    }

    // 3. Through TOM
    else if (state.phase === 'translocate_tom') {
        state.pos.y += 2;
        state.pos.x = canvas.width * COMPLEXES.tom.x + jitter();
        if (state.pos.y > tomY + 30) {
            state.phase = 'decision_point';
            state.timer = 0; // Reset for decision logic
        }
    }

    // 4. Decision Logic
    else if (state.phase === 'decision_point') {
        if (state.targetPath === 'tom_sam') state.phase = 'moving_sam';
        else if (state.targetPath === 'tom_tim22') state.phase = 'moving_tim22';
        else if (state.targetPath === 'tom_small_tims') {
            state.phase = 'ims_trap';
            state.timer = 0; // Ensure timer starts at 0 for trap duration
        }
        else state.phase = 'moving_tim23';

        // Spawn small TIMs if needed (For TIM22 or IMS Trap)
        if (state.targetPath === 'tom_tim22' || state.targetPath === 'tom_small_tims') {
            spawnSmallTIMs(state.pos.x, state.pos.y);
        }
    }

    // --- PATHWAYS ---

    // A. Matrix (TIM23)
    else if (state.phase === 'moving_tim23') {
        moveTo(canvas.width * COMPLEXES.tim23.x, tim23Y - 20, speed, () => {
            state.phase = 'entering_tim23';
        });
    }
    else if (state.phase === 'entering_tim23') {
        state.pos.y += 2;
        state.pos.x = canvas.width * COMPLEXES.tim23.x + jitter();
        if (state.pos.y > tim23Y + 150) evaluateResult();
    }

    // B. Inner Membrane (TIM22) - Multipass Weaving
    else if (state.phase === 'moving_tim22') {
        // Move laterally in IMS with chaperones
        const tX = canvas.width * COMPLEXES.tim22.x;
        moveTo(tX, tim23Y - 20, speed, () => {
            state.phase = 'entering_tim22';
            state.timer = 0; // Reset timer for weaving
        });
    }
    else if (state.phase === 'entering_tim22') {
        state.timer++;

        // Fade out chaperones
        if (state.smallTims.length > 0 && Math.random() > 0.8) state.smallTims.pop();

        // Multipass Weaving Animation
        // Weave up and down across the membrane line
        const membraneY = tim23Y;
        const weaveSpeed = 0.1;
        const weaveAmp = 15;

        // Horizontal drift
        state.pos.x += (Math.random() - 0.5);

        // Vertical Weave
        // Use sin wave to simulate passing in and out
        state.pos.y = membraneY + Math.sin(state.timer * weaveSpeed) * weaveAmp;

        // Damping amplitude over time to "stuck" it
        if (state.timer > 100) {
            // Settle into membrane
            const targetY = membraneY;
            state.pos.y += (targetY - state.pos.y) * 0.05;

            if (Math.abs(state.pos.y - targetY) < 1 && state.timer > 150) {
                evaluateResult();
            }
        }
    }

    // C. IMS Trap (Small TIMs) - Bouncing Physics
    else if (state.phase === 'ims_trap') {
        state.timer++;

        // Define IMS boundaries
        const imsTop = (ZONES.ims.y * canvas.height);
        const imsBottom = imsTop + (ZONES.ims.h * canvas.height);

        // Random velocity changes (Brownian-ish)
        if (!state.vel) state.vel = { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2 };

        state.vel.x += (Math.random() - 0.5) * 0.2;
        state.vel.y += (Math.random() - 0.5) * 0.2;

        // Dampen velocity
        state.vel.x *= 0.98;
        state.vel.y *= 0.98;

        state.pos.x += state.vel.x;
        state.pos.y += state.vel.y;

        // Boundary Checks (Bounce)
        if (state.pos.y < imsTop + 10) { state.pos.y = imsTop + 10; state.vel.y *= -1; }
        if (state.pos.y > imsBottom - 10) { state.pos.y = imsBottom - 10; state.vel.y *= -1; }

        // Side walls
        if (state.pos.x < 10) { state.pos.x = 10; state.vel.x *= -1; }
        if (state.pos.x > canvas.width - 10) { state.pos.x = canvas.width - 10; state.vel.x *= -1; }

        // Duration
        if (state.timer > 180) {
            evaluateResult();
        }
    }

    // D. Outer Membrane (SAM) - Single Pass Insertion
    else if (state.phase === 'moving_sam') {
        const tX = canvas.width * COMPLEXES.sam.x;
        moveTo(tX, tomY + 40, speed, () => {
            state.phase = 'entering_sam';
            state.timer = 0;
        });
    }
    else if (state.phase === 'entering_sam') {
        state.timer++;
        const targetY = tomY + 15; // Center of OM

        // Move upwards into membrane
        const dy = targetY - state.pos.y;
        state.pos.y += dy * 0.05; // Ease in

        // Slight wobble while inserting
        state.pos.x += Math.sin(state.timer * 0.5) * 0.5;

        if (Math.abs(dy) < 0.5 && state.timer > 60) {
            evaluateResult();
        }
    }
    //commit thing
    // Trail
    state.pathPoints.unshift({ x: state.pos.x, y: state.pos.y });
    if (state.pathPoints.length > 25) state.pathPoints.pop();
}

function updateSmallTIMs() {
    if (state.smallTims.length === 0) return;
    state.smallTims.forEach(p => {
        // Swarm behavior: Move towards protein
        const dx = state.pos.x - p.x;
        const dy = state.pos.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Keep a polite distance (radius 15)
        if (dist > 15) {
            p.x += dx * 0.05;
            p.y += dy * 0.05;
        }

        // Brownian jitter
        p.x += (Math.random() - 0.5) * 2;
        p.y += (Math.random() - 0.5) * 2;
    });
}

function moveTo(tx, ty, s, cb) {
    const dx = tx - state.pos.x;
    const dy = ty - state.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < s) {
        state.pos.x = tx; state.pos.y = ty;
        if (cb) cb();
    } else {
        state.pos.x += (dx / dist) * s;
        state.pos.y += (dy / dist) * s;
    }
}

// --- Visuals ---

function spawnSmallTIMs(x, y) {
    for (let i = 0; i < 6; i++) {
        // Spawn randomly around point
        const angle = Math.random() * Math.PI * 2;
        const rad = 20 + Math.random() * 20;
        state.smallTims.push({
            x: x + Math.cos(angle) * rad,
            y: y + Math.sin(angle) * rad
        });
    }
}

function draw() {
    if (!canvasInitialized) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Zones
    drawZone(ZONES.cyto);
    drawZone(ZONES.om);
    drawZone(ZONES.ims);
    drawZone(ZONES.im);
    drawZone(ZONES.matrix);

    // Complexes
    drawComplex(COMPLEXES.tom);
    drawComplex(COMPLEXES.sam);
    drawComplex(COMPLEXES.tim23);
    drawComplex(COMPLEXES.tim22);

    // Small TIMs (Chaperones)
    ctx.fillStyle = "#f39c12";
    state.smallTims.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    // Protein
    if (state.protein && state.pathPoints.length > 0) {
        drawPolypeptide(state.protein);
    }
}

function drawZone(z) {
    const y = z.y * canvas.height;
    const h = z.h * canvas.height;
    ctx.fillStyle = z.color;
    ctx.fillRect(0, y, canvas.width, h);

    if (z.label.includes("Membrane")) {
        ctx.strokeStyle = "#555";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
        ctx.moveTo(0, y + h); ctx.lineTo(canvas.width, y + h);
        ctx.stroke();
    }

    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.font = "italic 14px Georgia";
    // Fix: Moved label to avoid SAM overlap (right side)
    // If it's OM, move label to center-left
    if (z.label === "Outer Membrane") {
        ctx.textAlign = "left";
        ctx.fillText(z.label, 20, y + h / 2 + 5);
    } else {
        ctx.textAlign = "right";
        ctx.fillText(z.label, canvas.width - 20, y + h - 10);
    }
}

function drawComplex(c) {
    const cx = c.x * canvas.width;
    const cy = (ZONES[c.yZone].y * canvas.height) + (ZONES[c.yZone].h * canvas.height) / 2;
    const w = 40, h = 30;

    // PAM Complex (Only for TIM23)
    if (c.label === 'TIM23') {
        ctx.beginPath();
        ctx.arc(cx + 15, cy + h / 2 + 5, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#f1c40f'; // Yellow
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = "#000";
        ctx.font = "10px Arial";
        ctx.fillText("PAM", cx + 25, cy + h / 2 + 20);
    }

    ctx.fillStyle = c.color;
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);

    // Channel
    ctx.fillStyle = "#fff";
    ctx.fillRect(cx - 5, cy - h / 2, 10, h);

    ctx.fillStyle = "#000";
    ctx.font = "bold 11px Arial";
    ctx.textAlign = "center";
    ctx.fillText(c.label, cx, cy + h + 12);
}

function drawPolypeptide(p) {
    // Special "Stuck" Animations for Complete Phase
    if (state.phase === 'complete') {
        if (state.targetPath === 'tom_tim22') {
            // Draw Multipass Weaving (Static)
            const cx = state.pos.x;
            const cy = (ZONES.im.y * canvas.height);
            ctx.beginPath();
            ctx.moveTo(cx - 20, cy);
            for (let i = -20; i <= 20; i++) {
                ctx.lineTo(cx + i, cy + Math.sin(i * 0.5) * 15);
            }
            ctx.lineCap = "round";
            ctx.lineJoin = "round";
            ctx.lineWidth = 5;
            ctx.strokeStyle = p.color;
            ctx.stroke();
            return;
        } else if (state.targetPath === 'tom_sam') {
            // Draw Beta-Barrel (Zigzag/Rectangle)
            const cx = state.pos.x;
            const cy = (ZONES.om.y * canvas.height) + 15;
            ctx.beginPath();
            // Draw a simple barrel shape
            ctx.rect(cx - 10, cy - 15, 20, 30);
            ctx.lineWidth = 4;
            ctx.strokeStyle = p.color;
            ctx.stroke();

            // Internal zigzag
            ctx.beginPath();
            ctx.moveTo(cx - 8, cy - 12);
            ctx.lineTo(cx + 8, cy - 5);
            ctx.lineTo(cx - 8, cy + 5);
            ctx.lineTo(cx + 8, cy + 12);
            ctx.lineWidth = 2;
            ctx.stroke();
            return;
        }
    }

    ctx.beginPath();
    if (state.pathPoints.length > 0) {
        let pts = state.pathPoints;
        ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        for (let i = pts.length - 2; i >= 0; i--) {
            ctx.lineTo(pts[i].x, pts[i].y);
        }
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 5;
    ctx.strokeStyle = p.color;
    ctx.stroke();

    const head = state.pos;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = p.signalColor;
    ctx.fill();
}

function evaluateResult() {
    state.phase = 'complete';
    const correct = state.targetPath === state.protein.id;

    if (correct) {
        state.score++;
        showOverlay(true, "Correct Pathway!", "Protein reached correct destination.");
    } else {
        showOverlay(false, "Incorrect Pathway", "Signals did not match the transport machinery.");
    }

    document.getElementById('scoreVal').innerText = state.score;

    setTimeout(() => {
        state.caseIndex++;
        spawnProtein();
    }, 2500);
}

function showOverlay(success, title, body) {
    const el = document.getElementById('overlay');
    el.className = `msg-overlay ${success ? 'success' : 'fail'}`;
    el.style.display = 'block';
    document.getElementById('msgTitle').innerText = title;
    document.getElementById('msgBody').innerText = body;
}

function hideOverlay() {
    document.getElementById('overlay').style.display = 'none';
}

function toggleButtons(enable) {
    const btns = document.querySelectorAll('.btn');
    btns.forEach(b => b.disabled = !enable);
}
