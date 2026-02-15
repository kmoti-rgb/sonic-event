// ============================================================
// Sonic Event - 計算パズルアクションゲーム（オンライン対戦対応）
// ============================================================

(() => {
    'use strict';

    // ===== Canvas Setup =====
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const W = 960;
    const H = 640;
    canvas.width = W;
    canvas.height = H;

    // ===== DOM Elements =====
    const hudTarget = document.getElementById('target-display');
    const hudCurrent = document.getElementById('current-display');
    const hudPending = document.getElementById('pending-display');
    const hudLevel = document.getElementById('level-display');
    const overlay = document.getElementById('overlay');
    const overlayTitle = document.getElementById('overlay-title');
    const overlayMessage = document.getElementById('overlay-message');
    const overlayButton = document.getElementById('overlay-button');
    const opponentHud = document.getElementById('opponent-hud');
    const opponentCurrentEl = document.getElementById('opponent-current');
    const opponentPendingEl = document.getElementById('opponent-pending');

    // Lobby elements
    const lobby = document.getElementById('lobby');
    const lobbyMenu = document.getElementById('lobby-menu');
    const roomPanel = document.getElementById('room-panel');
    const roomCreatePanel = document.getElementById('room-create-panel');
    const roomJoinPanel = document.getElementById('room-join-panel');
    const roomIdDisplay = document.getElementById('room-id-display');
    const roomStatus = document.getElementById('room-status');
    const roomIdInput = document.getElementById('room-id-input');
    const joinError = document.getElementById('join-error');

    // ===== Constants =====
    const TILE = 48;
    const GRAVITY = 0.6;
    const MAX_FALL = 12;
    const PLAYER_SPEED = 4.5;
    const JUMP_FORCE = -14;
    const PLAYER_W = 32;
    const PLAYER_H = 40;
    const STATE_SYNC_INTERVAL = 50; // ms

    // ===== State Enum =====
    const CALC_STATE = {
        INITIAL: 'INITIAL',
        WAITING_OPERATOR: 'WAITING_OPERATOR',
        WAITING_NUMBER: 'WAITING_NUMBER'
    };

    // ===== Input =====
    const keys = {};
    window.addEventListener('keydown', e => {
        keys[e.code] = true;
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
            e.preventDefault();
        }
        if (e.code === 'KeyR') resetLevel();
    });
    window.addEventListener('keyup', e => { keys[e.code] = false; });

    // ===== Touch Controls =====
    function setupTouchButton(id, keyCode) {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            keys[keyCode] = true;
            btn.classList.add('active');
        }, { passive: false });
        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            keys[keyCode] = false;
            btn.classList.remove('active');
        }, { passive: false });
        btn.addEventListener('touchcancel', (e) => {
            keys[keyCode] = false;
            btn.classList.remove('active');
        });
        // Prevent context menu on long press
        btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    setupTouchButton('touch-left', 'ArrowLeft');
    setupTouchButton('touch-right', 'ArrowRight');
    setupTouchButton('touch-up', 'ArrowUp');
    setupTouchButton('touch-down', 'ArrowDown');
    setupTouchButton('touch-jump', 'Space');

    // Reset button (tap only, not hold)
    const touchResetBtn = document.getElementById('touch-reset');
    if (touchResetBtn) {
        touchResetBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            touchResetBtn.classList.add('active');
            resetLevel();
        }, { passive: false });
        touchResetBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            touchResetBtn.classList.remove('active');
        }, { passive: false });
        touchResetBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Prevent default touch behavior on game container to avoid scrolling
    document.getElementById('game-container').addEventListener('touchmove', (e) => {
        e.preventDefault();
    }, { passive: false });

    // ===== Online State =====
    let socket = null;
    let isOnline = false;
    let myPlayerIndex = -1;
    let opponent = null; // { x, y, facingRight, walkFrame, currentValue, pendingOperator, calcState }
    let lastStateSend = 0;

    // ===== Particle System =====
    const particles = [];

    function spawnParticles(x, y, color, count = 12) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 3;
            particles.push({
                x,
                y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1,
                life: 1,
                decay: 0.02 + Math.random() * 0.03,
                color,
                size: 2 + Math.random() * 4
            });
        }
    }

    function updateParticles() {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.05;
            p.life -= p.decay;
            if (p.life <= 0) particles.splice(i, 1);
        }
    }

    function drawParticles() {
        for (const p of particles) {
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.shadowBlur = 8;
            ctx.shadowColor = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
    }

    // ===== Floating Text =====
    const floatingTexts = [];

    function spawnFloatingText(x, y, text, color) {
        floatingTexts.push({ x, y, text, color, life: 1, vy: -1.5 });
    }

    function updateFloatingTexts() {
        for (let i = floatingTexts.length - 1; i >= 0; i--) {
            const ft = floatingTexts[i];
            ft.y += ft.vy;
            ft.vy *= 0.98;
            ft.life -= 0.015;
            if (ft.life <= 0) floatingTexts.splice(i, 1);
        }
    }

    function drawFloatingTexts() {
        for (const ft of floatingTexts) {
            ctx.globalAlpha = ft.life;
            ctx.font = `bold 18px 'Orbitron', monospace`;
            ctx.textAlign = 'center';
            ctx.fillStyle = ft.color;
            ctx.shadowBlur = 12;
            ctx.shadowColor = ft.color;
            ctx.fillText(ft.text, ft.x, ft.y);
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.textAlign = 'left';
    }

    // ===== Background Stars =====
    const stars = [];
    for (let i = 0; i < 80; i++) {
        stars.push({
            x: Math.random() * W,
            y: Math.random() * H,
            size: 0.5 + Math.random() * 1.5,
            twinkle: Math.random() * Math.PI * 2,
            speed: 0.01 + Math.random() * 0.03
        });
    }

    function drawBackground() {
        const grd = ctx.createLinearGradient(0, 0, 0, H);
        grd.addColorStop(0, '#0a0a1a');
        grd.addColorStop(0.5, '#0d0d2b');
        grd.addColorStop(1, '#12122e');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, W, H);

        for (const s of stars) {
            s.twinkle += s.speed;
            const brightness = 0.3 + Math.sin(s.twinkle) * 0.3;
            ctx.globalAlpha = brightness;
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // ===== Seeded Random Number Generator =====
    function createRNG(seed) {
        let s = seed;
        return function () {
            s = (s * 1664525 + 1013904223) & 0xFFFFFFFF;
            return (s >>> 0) / 0xFFFFFFFF;
        };
    }

    function randInt(rng, min, max) {
        return Math.floor(rng() * (max - min + 1)) + min;
    }

    function pick(rng, arr) {
        return arr[Math.floor(rng() * arr.length)];
    }

    // ===== Random Level Generator (ドンキーコング算数遊び風バランス) =====
    function generateLevel(difficulty, seed) {
        const rng = seed != null ? createRNG(seed) : Math.random.bind(Math);

        // --- Difficulty (ドンキーコング CALCULATE A/B style) ---
        const diff = Math.min(difficulty, 12);
        let allowedOps;
        if (diff < 3) { allowedOps = ['+', '-']; }
        else if (diff < 6) { allowedOps = ['+', '-', '×']; }
        else { allowedOps = ['+', '-', '×', '÷']; }

        // --- Build a guaranteed solution chain ---
        const solNums = [];
        const solOps = [];
        const numSteps = diff < 3 ? 2 : 3;
        let cur = randInt(rng, 2, 9);
        solNums.push(cur);

        for (let s = 0; s < numSteps - 1; s++) {
            const op = pick(rng, allowedOps);
            let n;
            if (op === '×') {
                n = randInt(rng, 2, Math.min(5, Math.floor(99 / Math.max(cur, 1))));
                if (n < 2) n = 2; if (n > 9) n = 9;
                cur *= n;
            } else if (op === '÷') {
                const divs = [];
                for (let d = 2; d <= 9; d++) { if (cur % d === 0 && cur / d >= 1) divs.push(d); }
                if (divs.length > 0) { n = pick(rng, divs); cur = Math.floor(cur / n); }
                else { n = randInt(rng, 1, 9); cur += n; solOps.push('+'); solNums.push(n); continue; }
            } else if (op === '-') {
                n = randInt(rng, 1, Math.min(cur - 1, 9));
                if (n < 1) n = 1;
                cur -= n;
            } else {
                n = randInt(rng, 1, 9);
                cur += n;
            }
            solOps.push(op);
            solNums.push(n);
        }
        const target = Math.max(cur, 1);

        // --- Fixed 3-layer layout with ladders (DK Jr. style) ---
        const groundY = H - TILE;
        const midY = H - TILE * 4;
        const topY = H - TILE * 7;
        const platH = TILE * 0.5;

        const platforms = [
            { x: 0, y: groundY, w: W, h: TILE },
            { x: 0, y: midY, w: 280, h: platH },
            { x: 340, y: midY, w: 280, h: platH },
            { x: 680, y: midY, w: 280, h: platH },
            { x: 60, y: topY, w: 240, h: platH },
            { x: 360, y: topY, w: 240, h: platH },
            { x: 660, y: topY, w: 240, h: platH },
        ];

        const ladderW = 36;
        const ladders = [
            { x: 140, y: midY + platH, w: ladderW, h: groundY - midY - platH },
            { x: 460, y: midY + platH, w: ladderW, h: groundY - midY - platH },
            { x: 780, y: midY + platH, w: ladderW, h: groundY - midY - platH },
            { x: 300, y: topY + platH, w: ladderW, h: midY - topY - platH },
            { x: 660, y: topY + platH, w: ladderW, h: midY - topY - platH },
        ];

        // Fixed block spots on each floor
        const BS = 40;
        const blockSpots = [
            { x: 200, y: groundY - BS - 8 },
            { x: 380, y: groundY - BS - 8 },
            { x: 560, y: groundY - BS - 8 },
            { x: 740, y: groundY - BS - 8 },
            { x: 60, y: midY - BS - 8 },
            { x: 360, y: midY - BS - 8 },
            { x: 520, y: midY - BS - 8 },
            { x: 800, y: midY - BS - 8 },
            { x: 120, y: topY - BS - 8 },
            { x: 420, y: topY - BS - 8 },
            { x: 720, y: topY - BS - 8 },
        ];

        // Shuffle spots
        const shuffled = [...blockSpots];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        // Place solution blocks first, then decoys
        const blocks = [];
        let si = 0;
        for (let i = 0; i < solNums.length && si < shuffled.length; i++) {
            blocks.push({ type: 'number', value: solNums[i], x: shuffled[si].x, y: shuffled[si].y }); si++;
            if (i < solOps.length && si < shuffled.length) {
                blocks.push({ type: 'operator', value: solOps[i], x: shuffled[si].x, y: shuffled[si].y }); si++;
            }
        }
        const extraOps = ['+', '-', '×', '÷'];
        while (si < shuffled.length) {
            const p = shuffled[si];
            if (rng() < 0.65) blocks.push({ type: 'number', value: randInt(rng, 1, 9), x: p.x, y: p.y });
            else blocks.push({ type: 'operator', value: pick(rng, extraOps), x: p.x, y: p.y });
            si++;
        }

        const playerStart = { x: 60, y: groundY - PLAYER_H };
        return { target, platforms, ladders, blocks, playerStart };
    }

    // ===== Level Management =====
    let currentLevelData = null;
    let levelSeed = 0;

    const levels = {
        get length() { return 999; } // effectively infinite
    };

    // ===== Game State =====
    let currentLevel = 0;
    let player = {};
    let calcState = CALC_STATE.INITIAL;
    let currentValue = 0;
    let pendingOperator = null;
    let activeBlocks = [];
    let gameRunning = false;
    let winAnimation = 0;
    let animFrame = 0;

    // ===== Initialize Level =====
    function initLevel(index, seed) {
        levelSeed = seed != null ? seed : Math.floor(Math.random() * 999999999);
        currentLevelData = generateLevel(index, levelSeed);
        const lvl = currentLevelData;
        player = {
            x: lvl.playerStart.x,
            y: lvl.playerStart.y,
            vx: 0,
            vy: 0,
            onGround: false,
            onLadder: false,
            facingRight: true,
            walkFrame: 0
        };
        calcState = CALC_STATE.INITIAL;
        currentValue = 0;
        pendingOperator = null;
        activeBlocks = lvl.blocks.map(b => ({ ...b, collected: false, bobOffset: Math.random() * Math.PI * 2 }));
        winAnimation = 0;
        gameRunning = true;
        particles.length = 0;
        floatingTexts.length = 0;
        opponent = null;
        updateHUD();
        overlay.classList.add('hidden');

        if (isOnline) {
            opponentHud.classList.remove('hidden');
            opponentCurrentEl.textContent = '0';
            opponentPendingEl.textContent = '-';
        }
    }

    function resetLevel() {
        if (!gameRunning) return;
        initLevel(currentLevel, levelSeed);
    }

    // ===== HUD Update =====
    function updateHUD() {
        hudTarget.textContent = currentLevelData ? currentLevelData.target : '?';
        hudCurrent.textContent = currentValue;
        hudPending.textContent = pendingOperator || '-';
        hudLevel.textContent = currentLevel + 1;
    }

    function pulseHUD(elementId) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const valueEl = el.querySelector('.hud-value');
        if (!valueEl) return;
        valueEl.classList.remove('hud-pulse');
        void valueEl.offsetWidth;
        valueEl.classList.add('hud-pulse');
    }

    // ===== Collision Detection =====
    function rectCollision(a, b) {
        return a.x < b.x + b.w && a.x + a.w > b.x &&
            a.y < b.y + b.h && a.y + a.h > b.y;
    }

    // ===== Calculate =====
    function performCalc(op, a, b) {
        switch (op) {
            case '+': return a + b;
            case '-': return a - b;
            case '×': return a * b;
            case '÷':
                if (b === 0) return null;
                return Math.floor(a / b);
            default: return null;
        }
    }

    // ===== Block Interaction =====
    function handleBlockCollision(block) {
        if (block.collected) return;

        if (block.type === 'number') {
            if (calcState === CALC_STATE.INITIAL) {
                currentValue = block.value;
                calcState = CALC_STATE.WAITING_OPERATOR;
                block.collected = true;
                spawnParticles(block.x + 20, block.y + 20, '#00ffcc', 16);
                spawnFloatingText(block.x + 20, block.y - 10, `${block.value}`, '#00ffcc');
                pulseHUD('hud-current');
                updateHUD();
                sendBlockCollected(block);
                checkWin();
            } else if (calcState === CALC_STATE.WAITING_NUMBER) {
                const result = performCalc(pendingOperator, currentValue, block.value);
                if (result !== null) {
                    const expr = `${currentValue} ${pendingOperator} ${block.value} = ${result}`;
                    spawnFloatingText(block.x + 20, block.y - 10, expr, '#ffcc00');
                    currentValue = result;
                    pendingOperator = null;
                    calcState = CALC_STATE.WAITING_OPERATOR;
                    block.collected = true;
                    spawnParticles(block.x + 20, block.y + 20, '#00ffcc', 20);
                    pulseHUD('hud-current');
                    pulseHUD('hud-pending');
                    updateHUD();
                    sendBlockCollected(block);
                    checkWin();
                }
            }
        } else if (block.type === 'operator') {
            if (calcState === CALC_STATE.WAITING_OPERATOR) {
                pendingOperator = block.value;
                calcState = CALC_STATE.WAITING_NUMBER;
                block.collected = true;
                spawnParticles(block.x + 20, block.y + 20, '#ff66cc', 16);
                spawnFloatingText(block.x + 20, block.y - 10, block.value, '#ff66cc');
                pulseHUD('hud-pending');
                updateHUD();
                sendBlockCollected(block);
            }
        }
    }

    function sendBlockCollected(block) {
        if (!isOnline || !socket) return;
        socket.emit('block-collected', {
            x: block.x,
            y: block.y,
            type: block.type,
            value: block.value
        });
    }

    // ===== Win Check =====
    function checkWin() {
        if (currentLevelData && currentValue === currentLevelData.target) {
            gameRunning = false;
            winAnimation = 1;
            for (let i = 0; i < 5; i++) {
                setTimeout(() => {
                    spawnParticles(player.x + PLAYER_W / 2, player.y + PLAYER_H / 2, '#ffcc00', 20);
                    spawnParticles(player.x + PLAYER_W / 2, player.y + PLAYER_H / 2, '#00ffcc', 15);
                    spawnParticles(player.x + PLAYER_W / 2, player.y + PLAYER_H / 2, '#ff66cc', 10);
                }, i * 150);
            }

            if (isOnline) {
                socket.emit('player-won');
            } else {
                setTimeout(() => showSoloOverlay(), 1200);
            }
        }
    }

    // ===== Solo overlay =====
    // ===== Solo overlay =====
    function showSoloOverlay() {
        overlayTitle.textContent = 'STAGE CLEAR!';
        overlayMessage.textContent = `目標値 ${currentLevelData.target} に到達しました！`;
        overlayButton.textContent = 'NEXT STAGE';
        overlayButton.onclick = () => {
            currentLevel++;
            initLevel(currentLevel);
        };
        overlay.classList.remove('hidden');
    }

    // ===== Online result overlay =====
    function showOnlineResult(result) {
        gameRunning = false;
        if (result === 'win') {
            overlayTitle.textContent = 'YOU WIN!';
            overlayMessage.textContent = '目標値に先に到達しました！';
            winAnimation = 1;
            for (let i = 0; i < 5; i++) {
                setTimeout(() => {
                    spawnParticles(W / 2, H / 2, '#ffcc00', 20);
                    spawnParticles(W / 2, H / 2, '#00ffcc', 15);
                }, i * 150);
            }
        } else {
            overlayTitle.textContent = 'YOU LOSE...';
            overlayMessage.textContent = '相手が先に目標値に到達しました。';
        }
        overlayButton.textContent = 'REMATCH';
        overlayButton.onclick = () => {
            overlay.classList.add('hidden');
            roomStatus.textContent = 'リマッチ待機中...';
            socket.emit('rematch');
        };
        setTimeout(() => overlay.classList.remove('hidden'), 800);
    }

    // ===== Player Update =====
    function updatePlayer() {
        if (!gameRunning) return;

        const lvl = currentLevelData;
        const ladders = lvl.ladders || [];

        // Check if player is overlapping any ladder
        const playerCX = player.x + PLAYER_W / 2;
        const playerCY = player.y + PLAYER_H / 2;
        let onLadderNow = false;
        for (const lad of ladders) {
            if (playerCX > lad.x && playerCX < lad.x + lad.w &&
                player.y + PLAYER_H > lad.y && player.y < lad.y + lad.h) {
                onLadderNow = true;
                break;
            }
        }

        // Enter ladder with up/down
        const wantUp = keys['ArrowUp'] || keys['KeyW'];
        const wantDown = keys['ArrowDown'] || keys['KeyS'];
        if (onLadderNow && (wantUp || wantDown)) {
            player.onLadder = true;
        }
        if (!onLadderNow) {
            player.onLadder = false;
        }

        // Horizontal input
        let moveX = 0;
        if (keys['KeyA'] || keys['ArrowLeft']) moveX = -1;
        if (keys['KeyD'] || keys['ArrowRight']) moveX = 1;

        if (player.onLadder) {
            // --- Ladder movement ---
            player.vx = 0;
            player.vy = 0;
            const CLIMB_SPEED = 3.5;
            if (wantUp) player.y -= CLIMB_SPEED;
            if (wantDown) player.y += CLIMB_SPEED;
            // Slow horizontal movement on ladder
            player.x += moveX * 1.5;
        } else {
            // --- Normal movement ---
            player.vx = moveX * PLAYER_SPEED;

            // Jump (only on ground, not on ladder)
            if ((keys['Space'] || keys['ArrowUp']) && player.onGround) {
                player.vy = JUMP_FORCE;
                player.onGround = false;
                spawnParticles(player.x + PLAYER_W / 2, player.y + PLAYER_H, '#66ccff', 8);
            }

            // Gravity
            player.vy = Math.min(player.vy + GRAVITY, MAX_FALL);
        }

        // Move X
        player.x += player.vx;
        if (player.x < 0) player.x = 0;
        if (player.x + PLAYER_W > W) player.x = W - PLAYER_W;

        // X collision
        for (const plat of lvl.platforms) {
            if (rectCollision({ x: player.x, y: player.y, w: PLAYER_W, h: PLAYER_H }, plat)) {
                if (player.vx > 0) player.x = plat.x - PLAYER_W;
                else if (player.vx < 0) player.x = plat.x + plat.w;
            }
        }

        // Move Y (only if not on ladder - ladder already moved Y)
        if (!player.onLadder) {
            player.y += player.vy;
        }
        player.onGround = false;

        for (const plat of lvl.platforms) {
            if (rectCollision({ x: player.x, y: player.y, w: PLAYER_W, h: PLAYER_H }, plat)) {
                if (player.vy >= 0 || player.onLadder) {
                    player.y = plat.y - PLAYER_H;
                    player.vy = 0;
                    player.onGround = true;
                    if (player.onLadder && !wantDown) player.onLadder = false;
                } else if (player.vy < 0) {
                    player.y = plat.y + plat.h;
                    player.vy = 0;
                }
            }
        }

        // Fall off screen
        if (player.y > H + 100) {
            initLevel(currentLevel);
        }

        // Facing direction
        if (moveX !== 0) {
            player.facingRight = moveX > 0;
            player.walkFrame += 0.15;
        } else {
            player.walkFrame = 0;
        }

        // Block collision
        for (const block of activeBlocks) {
            if (!block.collected) {
                const blockRect = { x: block.x, y: block.y, w: 40, h: 40 };
                const playerRect = { x: player.x, y: player.y, w: PLAYER_W, h: PLAYER_H };
                if (rectCollision(playerRect, blockRect)) {
                    handleBlockCollision(block);
                }
            }
        }

        // Player vs Opponent collision (push each other)
        if (isOnline && opponent) {
            const opRect = { x: opponent.x, y: opponent.y, w: PLAYER_W, h: PLAYER_H };
            const myRect = { x: player.x, y: player.y, w: PLAYER_W, h: PLAYER_H };
            if (rectCollision(myRect, opRect)) {
                const overlapX = Math.min(myRect.x + PLAYER_W, opRect.x + PLAYER_W) - Math.max(myRect.x, opRect.x);
                const overlapY = Math.min(myRect.y + PLAYER_H, opRect.y + PLAYER_H) - Math.max(myRect.y, opRect.y);
                if (overlapX < overlapY) {
                    // Push horizontally
                    const pushX = overlapX / 2 + 1;
                    if (player.x < opponent.x) {
                        player.x -= pushX;
                    } else {
                        player.x += pushX;
                    }
                    if (player.x < 0) player.x = 0;
                    if (player.x + PLAYER_W > W) player.x = W - PLAYER_W;
                } else {
                    // Push vertically
                    if (player.y < opponent.y) {
                        player.y = opponent.y - PLAYER_H;
                        player.vy = 0;
                        player.onGround = true;
                    } else {
                        player.y = opponent.y + PLAYER_H;
                        player.vy = Math.max(player.vy, 0);
                    }
                }
            }
        }

        // Send state to server
        if (isOnline) {
            const now = Date.now();
            if (now - lastStateSend > STATE_SYNC_INTERVAL) {
                socket.emit('player-state', {
                    x: player.x,
                    y: player.y,
                    facingRight: player.facingRight,
                    walkFrame: player.walkFrame,
                    currentValue,
                    pendingOperator,
                    calcState
                });
                lastStateSend = now;
            }
        }
    }

    // ===== Draw Player =====
    function drawPlayer() {
        drawCharacter(player.x, player.y, player.facingRight, player.walkFrame, player.onGround, '#00ff88', '#00cc66', 1);
    }

    function drawOpponent() {
        if (!opponent || !isOnline) return;
        drawCharacter(opponent.x, opponent.y, opponent.facingRight, opponent.walkFrame, true, '#ff4444', '#cc2222', 0.6);
    }

    function drawCharacter(x, y, facingRight, walkFrame, onGround, bodyColor, darkColor, alpha) {
        ctx.globalAlpha = alpha;
        const bobY = onGround ? Math.sin(walkFrame * 2) * 2 : 0;
        const drawY = y + bobY;

        // Body
        ctx.fillStyle = bodyColor;
        ctx.shadowBlur = 15;
        ctx.shadowColor = bodyColor;

        const bodyR = 6;
        const bx = x;
        const by = drawY + 8;
        const bw = PLAYER_W;
        const bh = PLAYER_H - 8;

        ctx.beginPath();
        ctx.moveTo(bx + bodyR, by);
        ctx.lineTo(bx + bw - bodyR, by);
        ctx.arcTo(bx + bw, by, bx + bw, by + bodyR, bodyR);
        ctx.lineTo(bx + bw, by + bh - bodyR);
        ctx.arcTo(bx + bw, by + bh, bx + bw - bodyR, by + bh, bodyR);
        ctx.lineTo(bx + bodyR, by + bh);
        ctx.arcTo(bx, by + bh, bx, by + bh - bodyR, bodyR);
        ctx.lineTo(bx, by + bodyR);
        ctx.arcTo(bx, by, bx + bodyR, by, bodyR);
        ctx.fill();

        // Head
        ctx.fillStyle = darkColor;
        ctx.fillRect(x + 4, drawY, PLAYER_W - 8, 12);
        ctx.fillStyle = bodyColor;
        ctx.fillRect(x + 6, drawY + 2, PLAYER_W - 12, 8);

        // Eye
        const eyeX = facingRight ? x + PLAYER_W - 12 : x + 6;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(eyeX + 3, drawY + 16, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#111';
        const pupilX = facingRight ? eyeX + 4.5 : eyeX + 1.5;
        ctx.beginPath();
        ctx.arc(pupilX, drawY + 16, 2.5, 0, Math.PI * 2);
        ctx.fill();

        // Legs
        const legSpread = Math.sin(walkFrame * 4) * 4;
        ctx.fillStyle = darkColor;
        ctx.fillRect(x + 5, drawY + PLAYER_H - 6, 8, 6 - bobY);
        ctx.fillRect(x + PLAYER_W - 13, drawY + PLAYER_H - 6 + legSpread * 0.3, 8, 6 - bobY);

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
    }

    // ===== Draw Platforms =====
    function drawPlatforms() {
        const lvl = currentLevelData;
        for (const plat of lvl.platforms) {
            if (plat.y >= H - TILE) {
                // Ground
                const grdGround = ctx.createLinearGradient(0, plat.y, 0, plat.y + plat.h);
                grdGround.addColorStop(0, '#2a2a4a');
                grdGround.addColorStop(1, '#1a1a35');
                ctx.fillStyle = grdGround;
                ctx.fillRect(plat.x, plat.y, plat.w, plat.h);

                ctx.strokeStyle = 'rgba(100, 100, 200, 0.3)';
                ctx.lineWidth = 1;
                for (let gx = plat.x; gx < plat.x + plat.w; gx += TILE) {
                    ctx.strokeRect(gx, plat.y, TILE, TILE);
                }

                ctx.fillStyle = 'rgba(100, 150, 255, 0.15)';
                ctx.fillRect(plat.x, plat.y, plat.w, 2);
            } else {
                // Floating platform
                ctx.fillStyle = '#2a2a50';
                ctx.shadowBlur = 8;
                ctx.shadowColor = 'rgba(100, 150, 255, 0.2)';
                ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
                ctx.fillStyle = 'rgba(100, 200, 255, 0.2)';
                ctx.fillRect(plat.x, plat.y, plat.w, 2);
                ctx.shadowBlur = 0;
            }
        }

        // Draw ladders
        const ladders = lvl.ladders || [];
        for (const lad of ladders) {
            // Side rails
            ctx.fillStyle = '#8B6914';
            ctx.fillRect(lad.x, lad.y, 4, lad.h);
            ctx.fillRect(lad.x + lad.w - 4, lad.y, 4, lad.h);
            // Rungs
            ctx.fillStyle = '#A0782C';
            const rungSpacing = 24;
            for (let ry = lad.y + 12; ry < lad.y + lad.h; ry += rungSpacing) {
                ctx.fillRect(lad.x + 2, ry, lad.w - 4, 4);
            }
            // Highlight
            ctx.fillStyle = 'rgba(255, 200, 80, 0.15)';
            ctx.fillRect(lad.x + 8, lad.y, lad.w - 16, lad.h);
        }
    }

    // ===== Draw Blocks =====
    function drawBlocks() {
        for (const block of activeBlocks) {
            if (block.collected) continue;

            const bob = Math.sin(animFrame * 0.04 + block.bobOffset) * 4;
            const bx = block.x;
            const by = block.y + bob;
            const size = 40;
            const r = 10;

            let color, glowColor, labelColor;
            if (block.type === 'number') {
                color = '#00e0ff';
                glowColor = 'rgba(0, 220, 255, 0.6)';
                labelColor = '#fff';
            } else {
                color = '#ff3388';
                glowColor = 'rgba(255, 50, 130, 0.6)';
                labelColor = '#fff';
            }

            // Glow
            ctx.shadowBlur = 20;
            ctx.shadowColor = glowColor;

            // Block body
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(bx + r, by);
            ctx.lineTo(bx + size - r, by);
            ctx.arcTo(bx + size, by, bx + size, by + r, r);
            ctx.lineTo(bx + size, by + size - r);
            ctx.arcTo(bx + size, by + size, bx + size - r, by + size, r);
            ctx.lineTo(bx + r, by + size);
            ctx.arcTo(bx, by + size, bx, by + size - r, r);
            ctx.lineTo(bx, by + r);
            ctx.arcTo(bx, by, bx + r, by, r);
            ctx.fill();

            // Inner
            ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
            ctx.beginPath();
            const ir = 7;
            const im = 4;
            ctx.moveTo(bx + im + ir, by + im);
            ctx.lineTo(bx + size - im - ir, by + im);
            ctx.arcTo(bx + size - im, by + im, bx + size - im, by + im + ir, ir);
            ctx.lineTo(bx + size - im, by + size - im - ir);
            ctx.arcTo(bx + size - im, by + size - im, bx + size - im - ir, by + size - im, ir);
            ctx.lineTo(bx + im + ir, by + size - im);
            ctx.arcTo(bx + im, by + size - im, bx + im, by + size - im - ir, ir);
            ctx.lineTo(bx + im, by + im + ir);
            ctx.arcTo(bx + im, by + im, bx + im + ir, by + im, ir);
            ctx.fill();

            // Label
            ctx.shadowBlur = 0;
            ctx.fillStyle = labelColor;
            ctx.font = `bold 20px 'Orbitron', monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(block.type === 'number' ? block.value : block.value, bx + size / 2, by + size / 2 + 1);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.shadowBlur = 0;
        }
    }

    // ===== Draw State Indicator =====
    function drawStateIndicator() {
        if (!gameRunning) return;

        let text = '';
        let color = '';

        switch (calcState) {
            case CALC_STATE.INITIAL:
                text = '数字を取れ!';
                color = '#00e0ff';
                break;
            case CALC_STATE.WAITING_OPERATOR:
                text = '記号を探せ!';
                color = '#ff66cc';
                break;
            case CALC_STATE.WAITING_NUMBER:
                text = `${pendingOperator} の後に数字！`;
                color = '#ffcc00';
                break;
        }

        const textX = player.x + PLAYER_W / 2;
        const textY = player.y - 20;

        ctx.globalAlpha = 0.7 + Math.sin(animFrame * 0.08) * 0.3;
        ctx.font = `bold 12px 'Inter', sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = color;
        ctx.shadowBlur = 8;
        ctx.shadowColor = color;
        ctx.fillText(text, textX, textY);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
    }

    // ===== Win Animation =====
    function drawWinEffect() {
        if (winAnimation <= 0) return;
        ctx.globalAlpha = winAnimation * 0.3;
        ctx.fillStyle = '#ffcc00';
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        winAnimation -= 0.01;
    }

    // ===== Unified Game Loop =====
    function unifiedLoop() {
        animFrame++;
        drawBackground();

        if (gameRunning || activeBlocks.length > 0) {
            drawPlatforms();
            drawBlocks();
        }

        if (gameRunning) {
            updatePlayer();
            drawStateIndicator();
        }

        if (player.x !== undefined) {
            drawPlayer();
        }

        // Draw opponent ghost
        drawOpponent();

        updateParticles();
        drawParticles();
        updateFloatingTexts();
        drawFloatingTexts();
        drawWinEffect();

        requestAnimationFrame(unifiedLoop);
    }

    // ===== Lobby Logic =====
    function showLobby() {
        lobby.classList.remove('hidden');
        overlay.classList.add('hidden');
        lobbyMenu.style.display = 'flex';
        roomPanel.classList.add('hidden');
        roomCreatePanel.classList.add('hidden');
        roomJoinPanel.classList.add('hidden');
        opponentHud.classList.add('hidden');
        gameRunning = false;
        isOnline = false;
    }

    // Solo play
    document.getElementById('btn-solo').addEventListener('click', () => {
        isOnline = false;
        lobby.classList.add('hidden');
        opponentHud.classList.add('hidden');
        currentLevel = 0;
        initLevel(0);
    });

    // Create room
    document.getElementById('btn-create').addEventListener('click', () => {
        connectSocket();
        lobbyMenu.style.display = 'none';
        roomPanel.classList.remove('hidden');
        roomCreatePanel.classList.remove('hidden');
        roomJoinPanel.classList.add('hidden');
        roomStatus.textContent = '接続中...';

        socket.emit('create-room', (response) => {
            if (response.success) {
                myPlayerIndex = response.playerIndex;
                roomIdDisplay.textContent = response.roomId;
                roomStatus.textContent = '対戦相手を待っています...';
            }
        });
    });

    // Join room
    document.getElementById('btn-join').addEventListener('click', () => {
        connectSocket();
        lobbyMenu.style.display = 'none';
        roomPanel.classList.remove('hidden');
        roomCreatePanel.classList.add('hidden');
        roomJoinPanel.classList.remove('hidden');
        joinError.textContent = '';
        roomIdInput.value = '';
        roomIdInput.focus();
    });

    // Join confirm
    document.getElementById('btn-join-confirm').addEventListener('click', () => {
        const roomId = roomIdInput.value.trim();
        if (!roomId) {
            joinError.textContent = 'ルームIDを入力してください';
            return;
        }
        joinError.textContent = '接続中...';
        socket.emit('join-room', roomId, (response) => {
            if (response.success) {
                myPlayerIndex = response.playerIndex;
                joinError.textContent = '';
            } else {
                joinError.textContent = response.error;
            }
        });
    });

    // Enter key for room ID input
    roomIdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('btn-join-confirm').click();
        }
    });

    // Back button
    document.getElementById('btn-back').addEventListener('click', () => {
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        showLobby();
    });

    // ===== Socket.io Connection =====
    function connectSocket() {
        if (socket && socket.connected) return;

        socket = io();
        isOnline = true;

        socket.on('opponent-joined', () => {
            roomStatus.textContent = '対戦相手が参加しました！';
        });

        socket.on('game-start', (data) => {
            currentLevel = data.level;
            lobby.classList.add('hidden');
            initLevel(currentLevel, data.seed);
        });

        socket.on('opponent-state', (state) => {
            opponent = state;
            // Update opponent HUD
            if (opponentCurrentEl) {
                opponentCurrentEl.textContent = state.currentValue;
            }
            if (opponentPendingEl) {
                opponentPendingEl.textContent = state.pendingOperator || '-';
            }
        });

        socket.on('opponent-block-collected', (data) => {
            // Mark the block as collected so this player can't pick it up
            for (const block of activeBlocks) {
                if (!block.collected && block.x === data.x && block.y === data.y && block.type === data.type && block.value === data.value) {
                    block.collected = true;
                    break;
                }
            }
            // Show particle effect at opponent's collected block position
            spawnParticles(data.x + 20, data.y + 20, '#ff4444', 12);
            spawnFloatingText(data.x + 20, data.y - 10, '✕', '#ff4444');
        });

        socket.on('game-result', (data) => {
            setTimeout(() => showOnlineResult(data.result), 500);
        });

        socket.on('opponent-wants-rematch', () => {
            overlayMessage.textContent = '相手がリマッチを希望しています！';
        });

        socket.on('opponent-left', () => {
            gameRunning = false;
            opponent = null;
            opponentHud.classList.add('hidden');
            overlayTitle.textContent = '対戦終了';
            overlayMessage.textContent = '相手が退出しました。';
            overlayButton.textContent = 'ロビーに戻る';
            overlayButton.onclick = () => {
                if (socket) {
                    socket.disconnect();
                    socket = null;
                }
                showLobby();
            };
            overlay.classList.remove('hidden');
        });

        socket.on('disconnect', () => {
            isOnline = false;
            opponent = null;
        });
    }

    // ===== Init =====
    showLobby();
    unifiedLoop();

})();
