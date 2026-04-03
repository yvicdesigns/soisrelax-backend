const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Authentification socket
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Non autorisé'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      next();
    } catch {
      next(new Error('Token invalide'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connecté: user ${socket.userId}`);

    // Rejoindre sa salle personnelle
    socket.join(`user:${socket.userId}`);

    socket.on('send_message', (data) => {
      const { receiverId, content } = data;
      io.to(`user:${receiverId}`).emit('new_message', {
        senderId: socket.userId,
        content,
        createdAt: new Date(),
      });
    });

    socket.on('typing', ({ receiverId }) => {
      io.to(`user:${receiverId}`).emit('user_typing', { userId: socket.userId });
    });

    socket.on('disconnect', () => {
      console.log(`Socket déconnecté: user ${socket.userId}`);
    });
  });

  return io;
}

function getIo() {
  if (!io) throw new Error('Socket non initialisé');
  return io;
}

module.exports = { initSocket, getIo };
