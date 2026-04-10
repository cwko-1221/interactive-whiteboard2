import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { io } from 'socket.io-client';
import styles from './ClassTeacher.module.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const STUDENTS_PER_PAGE = 9;
const OFFSCREEN_WIDTH = 800;
const OFFSCREEN_HEIGHT = 600;

export default function ClassTeacher() {
    const [searchParams] = useSearchParams();
    const roomId = searchParams.get('room');

    const socketRef = useRef(null);
    const fileInputRef = useRef(null);

    // students: [{ socketId, name }]
    const [students, setStudents] = useState([]);
    const [page, setPage] = useState(0);
    const [zoomedStudent, setZoomedStudent] = useState(null);
    const [showLargeQR, setShowLargeQR] = useState(false);
    const [uploadedImage, setUploadedImage] = useState(null); // base64 string
    const [uploading, setUploading] = useState(false);

    // Offscreen canvases
    const offscreenCanvasesRef = useRef(new Map());
    const drawStateRef = useRef(new Map());
    const gridCanvasRefs = useRef(new Map());
    const zoomCanvasRef = useRef(null);
    const animFrameRef = useRef(null);
    const bgImageRef = useRef(null); // HTMLImageElement for the background

    const getOrCreateOffscreen = useCallback((studentId) => {
        if (!offscreenCanvasesRef.current.has(studentId)) {
            const canvas = document.createElement('canvas');
            canvas.width = OFFSCREEN_WIDTH;
            canvas.height = OFFSCREEN_HEIGHT;
            const ctx = canvas.getContext('2d');
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            // Canvas is transparent — strokes only, bg composited separately
            offscreenCanvasesRef.current.set(studentId, { canvas, ctx });
        }
        return offscreenCanvasesRef.current.get(studentId);
    }, []);

    // Socket setup
    useEffect(() => {
        if (!roomId) return;

        socketRef.current = io(SERVER_URL);

        socketRef.current.on('connect', () => {
            socketRef.current.emit('join-room', { roomId, name: 'Teacher', isTeacher: true, roomType: 'class' });
        });

        socketRef.current.on('student-list', (list) => {
            setStudents(list);
            const activeIds = new Set(list.map(s => s.socketId));
            for (const id of offscreenCanvasesRef.current.keys()) {
                if (!activeIds.has(id)) {
                    offscreenCanvasesRef.current.delete(id);
                    drawStateRef.current.delete(id);
                }
            }
        });

        socketRef.current.on('draw', (data) => {
            const { studentId, x, y, state, color, size, isEraser } = data;
            if (!studentId) return;

            const { ctx } = getOrCreateOffscreen(studentId);
            const localX = x * OFFSCREEN_WIDTH;
            const localY = y * OFFSCREEN_HEIGHT;

            if (state === 'start') {
                ctx.beginPath();
                ctx.moveTo(localX, localY);
                drawStateRef.current.set(studentId, { drawing: true });
            } else if (state === 'move') {
                if (isEraser) {
                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.lineWidth = size * 2;
                } else {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = size;
                }
                ctx.lineTo(localX, localY);
                ctx.stroke();
            } else if (state === 'end') {
                drawStateRef.current.set(studentId, { drawing: false });
            }
        });

        socketRef.current.on('student-clear', ({ studentId }) => {
            if (offscreenCanvasesRef.current.has(studentId)) {
                const { ctx } = offscreenCanvasesRef.current.get(studentId);
                ctx.clearRect(0, 0, OFFSCREEN_WIDTH, OFFSCREEN_HEIGHT);
                // Only clear strokes — bg image is composited separately in render loop
            }
        });

        socketRef.current.on('clear-board', () => {
            for (const [, { ctx }] of offscreenCanvasesRef.current) {
                ctx.clearRect(0, 0, OFFSCREEN_WIDTH, OFFSCREEN_HEIGHT);
                // Only clear strokes — bg image is composited separately in render loop
            }
        });

        socketRef.current.on('image-uploaded', () => {
            setUploading(false);
        });

        return () => {
            if (socketRef.current) socketRef.current.disconnect();
        };
    }, [roomId, getOrCreateOffscreen]);

    // Animation loop
    useEffect(() => {
        const render = () => {
            for (const [studentId, canvasEl] of gridCanvasRefs.current) {
                if (!canvasEl) continue;
                const offscreen = offscreenCanvasesRef.current.get(studentId);
                if (!offscreen) continue;

                const ctx = canvasEl.getContext('2d');
                const rect = canvasEl.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;

                if (canvasEl.width !== Math.round(rect.width * dpr) || canvasEl.height !== Math.round(rect.height * dpr)) {
                    canvasEl.width = Math.round(rect.width * dpr);
                    canvasEl.height = Math.round(rect.height * dpr);
                }

                ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
                // Draw background image first
                if (bgImageRef.current) {
                    ctx.drawImage(bgImageRef.current, 0, 0, canvasEl.width, canvasEl.height);
                } else {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
                }
                // Draw student strokes on top
                ctx.drawImage(offscreen.canvas, 0, 0, canvasEl.width, canvasEl.height);
            }

            if (zoomedStudent && zoomCanvasRef.current) {
                const offscreen = offscreenCanvasesRef.current.get(zoomedStudent);
                if (offscreen) {
                    const canvasEl = zoomCanvasRef.current;
                    const ctx = canvasEl.getContext('2d');
                    const rect = canvasEl.getBoundingClientRect();
                    const dpr = window.devicePixelRatio || 1;

                    if (canvasEl.width !== Math.round(rect.width * dpr) || canvasEl.height !== Math.round(rect.height * dpr)) {
                        canvasEl.width = Math.round(rect.width * dpr);
                        canvasEl.height = Math.round(rect.height * dpr);
                    }

                    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
                    // Draw background image first
                    if (bgImageRef.current) {
                        ctx.drawImage(bgImageRef.current, 0, 0, canvasEl.width, canvasEl.height);
                    } else {
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
                    }
                    // Draw student strokes on top
                    ctx.drawImage(offscreen.canvas, 0, 0, canvasEl.width, canvasEl.height);
                }
            }

            animFrameRef.current = requestAnimationFrame(render);
        };

        animFrameRef.current = requestAnimationFrame(render);
        return () => {
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        };
    }, [zoomedStudent]);

    // Pagination
    const totalPages = Math.max(1, Math.ceil(students.length / STUDENTS_PER_PAGE));
    const visibleStudents = students.slice(page * STUDENTS_PER_PAGE, (page + 1) * STUDENTS_PER_PAGE);

    useEffect(() => {
        if (page >= totalPages) {
            setPage(Math.max(0, totalPages - 1));
        }
    }, [page, totalPages]);

    const clearAllBoards = () => {
        if (socketRef.current) {
            socketRef.current.emit('clear-board');
        }
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file.');
            return;
        }

        setUploading(true);

        const reader = new FileReader();
        reader.onload = (event) => {
            const base64 = event.target.result;
            setUploadedImage(base64);

            // Create image element and cache it for the render loop
            const img = new Image();
            img.onload = () => {
                bgImageRef.current = img;
                // No need to repaint offscreen canvases — bg is composited in render loop
            };
            img.src = base64;

            // Send to server
            if (socketRef.current) {
                socketRef.current.emit('upload-image', base64);
            }
        };
        reader.readAsDataURL(file);

        // Reset input so the same file can be re-selected
        e.target.value = '';
    };

    const joinUrl = `${window.location.origin}/class-student?room=${roomId}`;

    const zoomedStudentName = zoomedStudent
        ? students.find(s => s.socketId === zoomedStudent)?.name || 'Student'
        : '';

    return (
        <div className={styles.container}>
            {/* Header */}
            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <h1>Class Module</h1>
                    <div className={styles.roomBadge}>Room: {roomId}</div>
                </div>

                <div className={styles.headerCenter}>
                    <span className={styles.studentCount}>
                        {students.length} Student{students.length !== 1 ? 's' : ''} Connected
                    </span>
                </div>

                <div className={styles.headerRight}>
                    <button
                        className={styles.uploadBtn}
                        onClick={handleUploadClick}
                        disabled={uploading}
                    >
                        {uploading ? 'Uploading...' : uploadedImage ? '📄 Change Image' : '📤 Upload Image'}
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={handleFileChange}
                    />

                    <button className={styles.clearBtn} onClick={clearAllBoards}>
                        Clear All
                    </button>

                    <div
                        className={styles.qrContainer}
                        onClick={() => setShowLargeQR(true)}
                        title="Click to enlarge"
                    >
                        <div className={styles.qrLabel}>Scan to Join</div>
                        <QRCodeSVG value={joinUrl} size={64} />
                    </div>
                </div>
            </header>

            {/* Main Grid Area */}
            <main className={styles.gridArea}>
                {students.length === 0 ? (
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon}>{uploadedImage ? '📄' : '📤'}</div>
                        <h2>{uploadedImage ? 'Image uploaded! Waiting for students...' : 'Upload an image to start'}</h2>
                        <p>
                            {uploadedImage
                                ? 'Share the room code or QR code for students to join.'
                                : 'Click "Upload Image" to set a worksheet, then share the room code.'}
                        </p>
                    </div>
                ) : (
                    <div className={styles.grid}>
                        {visibleStudents.map((student) => (
                            <div
                                key={student.socketId}
                                className={styles.studentTile}
                                onClick={() => setZoomedStudent(student.socketId)}
                            >
                                <div className={styles.tileHeader}>
                                    <span className={styles.dot}></span>
                                    <span className={styles.tileName}>{student.name}</span>
                                </div>
                                <div className={styles.tileCanvas}>
                                    <canvas
                                        ref={(el) => {
                                            if (el) {
                                                gridCanvasRefs.current.set(student.socketId, el);
                                                getOrCreateOffscreen(student.socketId);
                                            } else {
                                                gridCanvasRefs.current.delete(student.socketId);
                                            }
                                        }}
                                        className={styles.miniCanvas}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className={styles.pagination}>
                    <button
                        className={styles.pageBtn}
                        disabled={page === 0}
                        onClick={() => setPage(p => p - 1)}
                    >
                        ← Previous
                    </button>
                    <span className={styles.pageIndicator}>
                        Page {page + 1} of {totalPages}
                    </span>
                    <button
                        className={styles.pageBtn}
                        disabled={page >= totalPages - 1}
                        onClick={() => setPage(p => p + 1)}
                    >
                        Next →
                    </button>
                </div>
            )}

            {/* Zoom Modal */}
            {zoomedStudent && (
                <div className={styles.zoomOverlay} onClick={() => setZoomedStudent(null)}>
                    <div className={styles.zoomContent} onClick={e => e.stopPropagation()}>
                        <div className={styles.zoomHeader}>
                            <h2 className={styles.zoomTitle}>{zoomedStudentName}</h2>
                            <button className={styles.closeZoomBtn} onClick={() => setZoomedStudent(null)}>×</button>
                        </div>
                        <div className={styles.zoomCanvasWrapper}>
                            <canvas ref={zoomCanvasRef} className={styles.zoomCanvas} />
                        </div>
                    </div>
                </div>
            )}

            {/* Large QR Code Overlay */}
            {showLargeQR && (
                <div className={styles.qrModalOverlay} onClick={() => setShowLargeQR(false)}>
                    <div className={styles.qrModalContent} onClick={e => e.stopPropagation()}>
                        <button className={styles.closeQRBtn} onClick={() => setShowLargeQR(false)}>×</button>
                        <h2 className={styles.qrModalTitle}>Scan to Join Class Module</h2>
                        <div className={styles.largeQRCodeWrapper}>
                            <QRCodeSVG value={joinUrl} size={300} />
                        </div>
                        <div className={styles.qrModalRoomCode}>
                            Room Code: <strong>{roomId}</strong>
                        </div>
                        <p className={styles.qrModalInstructions}>
                            Point your device camera here to instantly join the session
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
