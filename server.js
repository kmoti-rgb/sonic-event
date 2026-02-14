// ============================================================
// Sonic Event - オンライン対戦サーバー
// ============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// 静的ファイル配信
app.use(express.static(path.join(__dirname)));

// ルーム管理
const rooms = new Map();

function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 5; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

io.on('connection', (socket) => {
    console.log(`接続: ${socket.id}`);
    let currentRoom = null;

    // ルーム作成
    socket.on('create-room', (callback) => {
        let roomId = generateRoomId();
        while (rooms.has(roomId)) {
            roomId = generateRoomId();
        }

        rooms.set(roomId, {
            players: [{ id: socket.id, ready: false }],
            level: 0,
            state: 'waiting', // waiting, playing, finished
            winner: null
        });

        currentRoom = roomId;
        socket.join(roomId);
        console.log(`ルーム作成: ${roomId} by ${socket.id}`);
        callback({ success: true, roomId, playerIndex: 0 });
    });

    // ルーム参加
    socket.on('join-room', (roomId, callback) => {
        roomId = roomId.toUpperCase().trim();
        const room = rooms.get(roomId);

        if (!room) {
            callback({ success: false, error: 'ルームが見つかりません' });
            return;
        }
        if (room.players.length >= 2) {
            callback({ success: false, error: 'ルームが満員です' });
            return;
        }
        if (room.state !== 'waiting') {
            callback({ success: false, error: 'ゲームが既に進行中です' });
            return;
        }

        room.players.push({ id: socket.id, ready: false });
        currentRoom = roomId;
        socket.join(roomId);
        console.log(`ルーム参加: ${roomId} by ${socket.id}`);

        callback({ success: true, roomId, playerIndex: 1 });

        // 相手に通知
        socket.to(roomId).emit('opponent-joined');

        // 2人揃ったら自動的にゲーム開始
        if (room.players.length === 2) {
            room.state = 'playing';
            // ランダムにレベルを選択（0-2）
            room.level = Math.floor(Math.random() * 3);
            io.to(roomId).emit('game-start', { level: room.level });
            console.log(`ゲーム開始: ${roomId}, Level: ${room.level}`);
        }
    });

    // プレイヤー状態の送信（位置、計算値など）
    socket.on('player-state', (state) => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('opponent-state', state);
    });

    // ブロック取得通知
    socket.on('block-collected', (data) => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('opponent-block-collected', data);
    });

    // 勝利通知
    socket.on('player-won', () => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room || room.state !== 'playing') return;

        room.state = 'finished';
        room.winner = socket.id;

        socket.emit('game-result', { result: 'win' });
        socket.to(currentRoom).emit('game-result', { result: 'lose' });
        console.log(`勝利: ${socket.id} in ${currentRoom}`);
    });

    // リマッチ要求
    socket.on('rematch', () => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);
        if (!room) return;

        const player = room.players.find(p => p.id === socket.id);
        if (player) player.ready = true;

        // 両方readyならリスタート
        if (room.players.every(p => p.ready)) {
            room.state = 'playing';
            room.winner = null;
            room.level = Math.floor(Math.random() * 3);
            room.players.forEach(p => p.ready = false);
            io.to(currentRoom).emit('game-start', { level: room.level });
            console.log(`リマッチ開始: ${currentRoom}, Level: ${room.level}`);
        } else {
            socket.to(currentRoom).emit('opponent-wants-rematch');
        }
    });

    // 切断
    socket.on('disconnect', () => {
        console.log(`切断: ${socket.id}`);
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                room.players = room.players.filter(p => p.id !== socket.id);
                if (room.players.length === 0) {
                    rooms.delete(currentRoom);
                    console.log(`ルーム削除: ${currentRoom}`);
                } else {
                    room.state = 'waiting';
                    io.to(currentRoom).emit('opponent-left');
                }
            }
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sonic Event サーバー起動: http://localhost:${PORT}`);
});
