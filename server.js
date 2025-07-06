app.use(express.static(__dirname));
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// تقديم الملفات الثابتة
app.use(express.static('.'));

// تقديم ملف index.html في الصفحة الرئيسية
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let rooms = {};
let waitingPlayers = []; // قائمة انتظار للبحث العشوائي

// إنشاء كود غرفة عشوائي
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  console.log('مستخدم متصل:', socket.id);

  // إنشاء غرفة جديدة
  socket.on('createRoom', () => {
    const roomId = generateRoomCode();
    rooms[roomId] = {
      players: [socket.id],
      host: socket.id,
      created: Date.now()
    };
    
    socket.join(roomId);
    socket.currentRoom = roomId;
    socket.emit('roomCreated', roomId);
    
    console.log(`تم إنشاء غرفة: ${roomId} بواسطة ${socket.id}`);
  });

  // الانضمام لغرفة موجودة
  socket.on('joinRoom', (roomId) => {
    const room = rooms[roomId];
    
    if (!room) {
      socket.emit('roomError', 'الغرفة غير موجودة');
      return;
    }
    
    if (room.players.length >= 2) {
      socket.emit('roomError', 'الغرفة ممتلئة');
      return;
    }
    
    room.players.push(socket.id);
    socket.join(roomId);
    socket.currentRoom = roomId;
    
    // إشعار اللاعبين
    const role = room.players.length === 1 ? 'host' : 'guest';
    socket.emit('roomJoined', { roomId, role: 'guest' });
    
    if (room.players.length === 2) {
      // إشعار جميع اللاعبين بأن الغرفة جاهزة
      io.to(roomId).emit('playerJoined', {
        roomId,
        players: room.players
      });
      
      // تحديد أدوار اللاعبين
      socket.to(roomId).emit('playerJoined', { yourRole: 'host' });
      socket.emit('playerJoined', { yourRole: 'guest' });
    }
    
    console.log(`انضم ${socket.id} للغرفة ${roomId}`);
  });

  // البحث عن لاعب عشوائي
  socket.on('findRandomPlayer', () => {
    // إضافة اللاعب لقائمة الانتظار
    if (!waitingPlayers.includes(socket.id)) {
      waitingPlayers.push(socket.id);
    }
    
    // إذا كان هناك لاعب آخر في الانتظار
    if (waitingPlayers.length >= 2) {
      const player1 = waitingPlayers.shift();
      const player2 = waitingPlayers.shift();
      
      // إنشاء غرفة جديدة
      const roomId = generateRoomCode();
      rooms[roomId] = {
        players: [player1, player2],
        host: player1,
        created: Date.now(),
        isRandom: true
      };
      
      // إضافة اللاعبين للغرفة
      io.sockets.sockets.get(player1)?.join(roomId);
      io.sockets.sockets.get(player2)?.join(roomId);
      
      // إشعار اللاعبين
      io.to(player1).emit('randomPlayerFound', { roomId, role: 'host' });
      io.to(player2).emit('randomPlayerFound', { roomId, role: 'guest' });
      
      console.log(`تم ربط ${player1} و ${player2} في غرفة عشوائية ${roomId}`);
    }
  });

  // إرسال حركة للخصم
  socket.on('makeMove', (data) => {
    socket.to(data.roomId).emit('opponentMove', data);
    console.log(`حركة من ${socket.id} في الغرفة ${data.roomId}: العمود ${data.col}`);
  });

  // إعادة تعيين اللعبة
  socket.on('resetGame', (roomId) => {
    socket.to(roomId).emit('gameReset');
    console.log(`إعادة تعيين اللعبة في الغرفة ${roomId} بواسطة ${socket.id}`);
  });

  // مغادرة الغرفة
  socket.on('leaveRoom', (roomId) => {
    socket.leave(roomId);
    socket.to(roomId).emit('playerLeft');
    
    if (rooms[roomId]) {
      rooms[roomId].players = rooms[roomId].players.filter(id => id !== socket.id);
      if (rooms[roomId].players.length === 0) {
        delete rooms[roomId];
      }
    }
    
    console.log(`غادر ${socket.id} الغرفة ${roomId}`);
  });

  // قطع الاتصال
  socket.on('disconnect', () => {
    console.log('مستخدم منقطع:', socket.id);
    
    // إزالة من قائمة الانتظار
    const waitingIndex = waitingPlayers.indexOf(socket.id);
    if (waitingIndex > -1) {
      waitingPlayers.splice(waitingIndex, 1);
    }
    
    // إزالة من جميع الغرف
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.players.includes(socket.id)) {
        room.players = room.players.filter(id => id !== socket.id);
        
        // إشعار اللاعبين الآخرين
        socket.to(roomId).emit('playerLeft');
        
        // حذف الغرفة إذا كانت فارغة
        if (room.players.length === 0) {
          delete rooms[roomId];
        }
      }
    }
  });
});

// تنظيف الغرف القديمة كل 30 دقيقة
setInterval(() => {
  const now = Date.now();
  const thirtyMinutes = 30 * 60 * 1000;
  
  for (const roomId in rooms) {
    if (now - rooms[roomId].created > thirtyMinutes && rooms[roomId].players.length === 0) {
      delete rooms[roomId];
      console.log(`تم حذف الغرفة القديمة: ${roomId}`);
    }
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`السيرفر يعمل على المنفذ ${PORT}`));
