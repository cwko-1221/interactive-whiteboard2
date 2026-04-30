import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { io } from 'socket.io-client';
import styles from './Teacher.module.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const STUDENTS_PER_PAGE = 12;
const DEFAULT_OFFSCREEN_WIDTH = 800;
const DEFAULT_OFFSCREEN_HEIGHT = 600;

export default function Teacher() {
    const [searchParams] = useSearchParams();
    const roomId = searchParams.get('room');

    const socketRef = useRef(null);

    // students: [{ socketId, name }]
    const [students, setStudents] = useState([]);
    const [page, setPage] = useState(0);
    const [zoomedStudent, setZoomedStudent] = useState(null); // socketId or null
    const [showLargeQR, setShowLargeQR] = useState(false);

    // Map<socketId, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }>
    const offscreenCanvasesRef = useRef(new Map());
    // Map<socketId, { drawing: boolean }> — track per-student drawing state for beginPath
    const drawStateRef = useRef(new Map());
    const studentRatiosRef = useRef(new Map()); // studentId -> { width, height }

    // Refs for visible grid canvases
    const gridCanvasRefs = useRef(new Map());
    // Ref for zoomed canvas
    const zoomCanvasRef = useRef(null);
    const animFrameRef = useRef(null);

    const getOrCreateOffscreen = useCallback((studentId, w, h) => {
        const offW = w || DEFAULT_OFFSCREEN_WIDTH;
        const offH = h || DEFAULT_OFFSCREEN_HEIGHT;
        if (!offscreenCanvasesRef.current.has(studentId)) {
            const canvas = document.createElement('canvas');
            canvas.width = offW;
            canvas.height = offH;
            const ctx = canvas.getContext('2d');
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            // White background
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, offW, offH);
            offscreenCanvasesRef.current.set(studentId, { canvas, ctx });
        }
        return offscreenCanvasesRef.current.get(studentId);
    }, []);

    // Socket setup
    useEffect(() => {
        if (!roomId) return;

        socketRef.current = io(SERVER_URL);

        socketRef.current.on('connect', () => {
            socketRef.current.emit('join-room', { roomId, name: 'Teacher', isTeacher: true });
        });

        socketRef.current.on('student-list', (list) => {
            setStudents(list);
            // Clean up offscreen canvases for students who left
            const activeIds = new Set(list.map(s => s.socketId));
            for (const id of offscreenCanvasesRef.current.keys()) {
                if (!activeIds.has(id)) {
                    offscreenCanvasesRef.current.delete(id);
                    drawStateRef.current.delete(id);
                }
            }
        });

        // Handle canvas aspect ratio from students
        socketRef.current.on('canvas-ratio', ({ studentId, width, height }) => {
            if (!studentId || !width || !height) return;
            studentRatiosRef.current.set(studentId, { width, height });

            // If offscreen canvas exists but had different dimensions, recreate it
            if (offscreenCanvasesRef.current.has(studentId)) {
                const existing = offscreenCanvasesRef.current.get(studentId);
                const targetW = Math.round(width);
                const targetH = Math.round(height);
                if (existing.canvas.width !== targetW || existing.canvas.height !== targetH) {
                    const newCanvas = document.createElement('canvas');
                    newCanvas.width = targetW;
                    newCanvas.height = targetH;
                    const newCtx = newCanvas.getContext('2d');
                    newCtx.lineCap = 'round';
                    newCtx.lineJoin = 'round';
                    newCtx.drawImage(existing.canvas, 0, 0, targetW, targetH);
                    offscreenCanvasesRef.current.set(studentId, { canvas: newCanvas, ctx: newCtx });
                }
            }
        });

        socketRef.current.on('draw', (data) => {
            const { studentId, x, y, state, color, size, isEraser } = data;
            if (!studentId) return;

            const ratio = studentRatiosRef.current.get(studentId);
            const offW = ratio ? Math.round(ratio.width) : DEFAULT_OFFSCREEN_WIDTH;
            const offH = ratio ? Math.round(ratio.height) : DEFAULT_OFFSCREEN_HEIGHT;
            const { ctx } = getOrCreateOffscreen(studentId, offW, offH);
            const localX = x * offW;
            const localY = y * offH;

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
                const { canvas, ctx } = offscreenCanvasesRef.current.get(studentId);
                ctx.globalCompositeOperation = 'source-over';
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
        });

        socketRef.current.on('clear-board', () => {
            // Clear all offscreen canvases
            for (const [, { canvas, ctx }] of offscreenCanvasesRef.current) {
                ctx.globalCompositeOperation = 'source-over';
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
        });

        return () => {
            if (socketRef.current) socketRef.current.disconnect();
        };
    }, [roomId, getOrCreateOffscreen]);

    // Animation loop — copy offscreen canvases to visible grid canvases + zoom canvas
    useEffect(() => {
        const render = () => {
            // Render grid canvases
            for (const [studentId, canvasEl] of gridCanvasRefs.current) {
                if (!canvasEl) continue;
                const offscreen = offscreenCanvasesRef.current.get(studentId);
                if (!offscreen) continue;

                const ctx = canvasEl.getContext('2d');
                const rect = canvasEl.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;

                // Ensure canvas buffer matches display size
                if (canvasEl.width !== Math.round(rect.width * dpr) || canvasEl.height !== Math.round(rect.height * dpr)) {
                    canvasEl.width = Math.round(rect.width * dpr);
                    canvasEl.height = Math.round(rect.height * dpr);
                }

                ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

                // Calculate aspect-ratio-preserving draw area ("contain" fit)
                const srcW = offscreen.canvas.width;
                const srcH = offscreen.canvas.height;
                const dstW = canvasEl.width;
                const dstH = canvasEl.height;
                const scale = Math.min(dstW / srcW, dstH / srcH);
                const drawW = srcW * scale;
                const drawH = srcH * scale;
                const offsetX = (dstW - drawW) / 2;
                const offsetY = (dstH - drawH) / 2;

                ctx.fillStyle = '#f0f2f5';
                ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
                ctx.drawImage(offscreen.canvas, offsetX, offsetY, drawW, drawH);
            }

            // Render zoom canvas
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

                    // Calculate aspect-ratio-preserving draw area
                    const srcW = offscreen.canvas.width;
                    const srcH = offscreen.canvas.height;
                    const dstW = canvasEl.width;
                    const dstH = canvasEl.height;
                    const scale = Math.min(dstW / srcW, dstH / srcH);
                    const drawW = srcW * scale;
                    const drawH = srcH * scale;
                    const offsetX = (dstW - drawW) / 2;
                    const offsetY = (dstH - drawH) / 2;

                    ctx.fillStyle = '#f0f2f5';
                    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);
                    ctx.drawImage(offscreen.canvas, offsetX, offsetY, drawW, drawH);
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

    // Adjust page if students leave and page is now out of bounds
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

    const joinUrl = `${window.location.origin}/student?room=${roomId}`;

    const zoomedStudentName = zoomedStudent
        ? students.find(s => s.socketId === zoomedStudent)?.name || 'Student'
        : '';

    return (
        <div className={styles.container}>
            {/* Header */}
            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <h1>Interactive Board</h1>
                    <div className={styles.roomBadge}>Room: {roomId}</div>
                </div>

                <div className={styles.headerCenter}>
                    <span className={styles.studentCount}>
                        {students.length} Student{students.length !== 1 ? 's' : ''} Connected
                    </span>
                </div>

                <div className={styles.headerRight}>
                    <button className={styles.clearBtn} onClick={clearAllBoards}>
                        Clear All Boards
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
                        <div className={styles.emptyIcon}>👋</div>
                        <h2>Waiting for students...</h2>
                        <p>Share the room code or QR code for students to join.</p>
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
                                                // Ensure offscreen exists
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
                        <h2 className={styles.qrModalTitle}>Scan to Join Board</h2>
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
