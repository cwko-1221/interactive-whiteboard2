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
    maxHttpBufferSize: 10 * 1024 * 1024, // 10 MB for image uploads
});

const rooms = new Map(); // roomId -> { teacherSocket, students: Map<socketId, name>, image: string|null, type: string }

function getRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, { teacherSocket: null, students: new Map(), image: null, type: 'whiteboard' });
    }
    return rooms.get(roomId);
}

function emitStudentList(roomId) {
    const room = rooms.get(roomId);
    if (!room || !room.teacherSocket) return;

    const studentList = [];
    for (const [socketId, name] of room.students) {
        studentList.push({ socketId, name });
    }

    io.to(room.teacherSocket).emit('student-list', studentList);
}

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join-room', ({ roomId, name, isTeacher, roomType }) => {
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.name = name;
        socket.data.isTeacher = isTeacher;

        console.log(`${name} (${isTeacher ? 'Teacher' : 'Student'}) joined room: ${roomId}`);

        const room = getRoom(roomId);

        if (isTeacher) {
            room.teacherSocket = socket.id;
            // Store the room type if provided by teacher
            if (roomType) {
                room.type = roomType;
            }
            // Send the current student list to the teacher immediately
            emitStudentList(roomId);
        } else {
            // Add student to room roster
            room.students.set(socket.id, name);
            // Notify teacher about updated roster
            emitStudentList(roomId);

            // If the room has an image, send it to the new student
            if (room.image) {
                socket.emit('room-image', room.image);
            }
        }

        socket.to(roomId).emit('user-joined', { name, isTeacher });
    });

    // Handle drawing events — attach student identity
    socket.on('draw', (data) => {
        const roomId = socket.data.roomId;
        if (roomId && !socket.data.isTeacher) {
            socket.to(roomId).emit('draw', {
                ...data,
                studentId: socket.id,
                studentName: socket.data.name,
            });
        }
    });

    // Handle student clearing their own board
    socket.on('student-clear', () => {
        const roomId = socket.data.roomId;
        if (roomId && !socket.data.isTeacher) {
            socket.to(roomId).emit('student-clear', {
                studentId: socket.id,
                studentName: socket.data.name,
            });
        }
    });

    // Handle teacher clearing ALL boards
    socket.on('clear-board', () => {
        const roomId = socket.data.roomId;
        if (roomId) {
            io.to(roomId).emit('clear-board');
        }
    });

    // Handle teacher uploading an image (base64)
    socket.on('upload-image', (imageData) => {
        const roomId = socket.data.roomId;
        if (roomId && socket.data.isTeacher) {
            const room = rooms.get(roomId);
            if (room) {
                room.image = imageData;
                // Broadcast image to all students in the room
                socket.to(roomId).emit('room-image', imageData);
                // Confirm to teacher
                socket.emit('image-uploaded', true);
                console.log(`Image uploaded for room ${roomId} (${Math.round(imageData.length / 1024)}KB)`);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const roomId = socket.data.roomId;
        if (roomId) {
            const room = rooms.get(roomId);
            if (room) {
                if (socket.data.isTeacher) {
                    room.teacherSocket = null;
                } else {
                    room.students.delete(socket.id);
                    // Notify teacher about updated roster
                    emitStudentList(roomId);
                }

                // Clean up empty rooms
                if (!room.teacherSocket && room.students.size === 0) {
                    rooms.delete(roomId);
                }
            }
            socket.to(roomId).emit('user-left', { name: socket.data.name });
        }
    });
});

const PORT = process.env.PORT || 3001;

// Simple health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Room type lookup endpoint
app.get('/api/room-type/:roomId', (req, res) => {
    const { roomId } = req.params;
    const room = rooms.get(roomId);
    if (room) {
        res.json({ exists: true, type: room.type });
    } else {
        res.json({ exists: false, type: null });
    }
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
