import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const server = createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

const rooms = new Map(); // Room state storage

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Join a specific room
    socket.on('join-room', ({ roomId, name, isTeacher }) => {
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.name = name;
        socket.data.isTeacher = isTeacher;

        console.log(`${name} (${isTeacher ? 'Teacher' : 'Student'}) joined room: ${roomId}`);

        if (isTeacher) {
            if (!rooms.has(roomId)) {
                rooms.set(roomId, { teacherSocket: socket.id, drawings: [] });
            } else {
                const room = rooms.get(roomId);
                room.teacherSocket = socket.id;
            }
        }

        // Send existing drawings to the new user if they exist
        const room = rooms.get(roomId);
        if (room && room.drawings.length > 0) {
            socket.emit('initial-drawings', room.drawings);
        }

        socket.to(roomId).emit('user-joined', { name, isTeacher });
    });

    // Handle drawing events
    socket.on('draw', (data) => {
        const roomId = socket.data.roomId;
        if (roomId) {
            socket.to(roomId).emit('draw', data);

            // Optional: store drawings in memory to send to late joiners
            const room = rooms.get(roomId);
            if (room) {
                // to keep memory bounded, we might want to store paths instead of individual points long-term, 
                // but for this simple version we keep it minimal.
            }
        }
    });

    // Handle board clear
    socket.on('clear-board', () => {
        const roomId = socket.data.roomId;
        if (roomId) {
            const room = rooms.get(roomId);
            if (room) {
                room.drawings = [];
            }
            io.to(roomId).emit('clear-board');
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const roomId = socket.data.roomId;
        if (roomId) {
            socket.to(roomId).emit('user-left', { name: socket.data.name });
        }
    });
});

const PORT = process.env.PORT || 3001;

// Simple health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
