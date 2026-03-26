const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

// Ruta básica para Health Check (Render)
app.get('/', (req, res) => {
  res.send('WAR Signaling Server is running OK');
});

const users = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', (username) => {
    users[socket.id] = { username, isConnectedToVoice: false, socketId: socket.id };
    io.emit('user-list', Object.values(users));
  });

  socket.on('set-voice-status', (status) => {
    if (users[socket.id]) {
      users[socket.id].isConnectedToVoice = status;
      io.emit('user-list', Object.values(users));
    }
  });

  socket.on('notify-friends', (username) => {
    socket.broadcast.emit('friend-notif', {
      title: 'WAR Chat',
      body: `${username} está en el grupo y listo para jugar!`,
    });
  });

  // Signaling for WebRTC
  socket.on('signal', (data) => {
    console.log(`[Signaling] Reenviando señal de ${socket.id} hacia ${data.to} (${data.signal.type || 'candidate'})`);
    io.to(data.to).emit('signal', {
      from: socket.id,
      signal: data.signal,
    });
  });

  socket.on('disconnect', () => {
    delete users[socket.id];
    io.emit('user-list', Object.values(users));
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
