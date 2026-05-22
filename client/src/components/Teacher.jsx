import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { io } from 'socket.io-client';
import styles from './Teacher.module.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const STUDENTS_PER_PAGE = 12;
const OFFSCREEN_WIDTH = 800;
const OFFSCREEN_HEIGHT = 600;

export default function Teacher() {
    const [searchParams] = useSearchParams();
    const roomId = searchParams.get('room');

    const socketRef = useRef(null);

    // students: [{ socketId, name }]
    const [students, setStudents] = useState([]);
    const [page, setPage] = useState(0);
    const [zoomedStudent, setZoomedStudent] = useState(null); // socketId or null
    const [showLargeQR, setShowLargeQR] = useState(false);
    const [locked, setLocked] = useState(false);

    // Teacher drawing state
    const [teacherActiveTool, setTeacherActiveTool] = useState('pen');
    const isTeacherDrawing = useRef(false);
    const teacherLastPos = useRef({ normX: 0, normY: 0 });

    // Special offscreen canvas for the Teacher Board
    const teacherOffscreenRef = useRef(null);

    // Map<socketId, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }>
    const offscreenCanvasesRef = useRef(new Map());
    // Map<socketId, { drawing: boolean }> — track per-student drawing state for beginPath
    const drawStateRef = useRef(new Map());

    // Refs for visible grid canvases
    const gridCanvasRefs = useRef(new Map());
    // Ref for zoomed canvas
    const zoomCanvasRef = useRef(null);
    const animFrameRef = useRef(null);

    useEffect(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 800;
        const ctx = canvas.getContext('2d');
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        teacherOffscreenRef.current = { canvas, ctx };
    }, []);

    const getOrCreateOffscreen = useCallback((studentId) => {
        if (!offscreenCanvasesRef.current.has(studentId)) {
            const canvas = document.createElement('canvas');
            canvas.width = OFFSCREEN_WIDTH;
            canvas.height = OFFSCREEN_HEIGHT;
            const ctx = canvas.getContext('2d');
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            // White background
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, OFFSCREEN_WIDTH, OFFSCREEN_HEIGHT);
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
                ctx.globalCompositeOperation = 'source-over';
                ctx.clearRect(0, 0, OFFSCREEN_WIDTH, OFFSCREEN_HEIGHT);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, OFFSCREEN_WIDTH, OFFSCREEN_HEIGHT);
            }
        });

        socketRef.current.on('clear-board', () => {
            // Clear all offscreen canvases
            for (const [, { ctx }] of offscreenCanvasesRef.current) {
                ctx.globalCompositeOperation = 'source-over';
                ctx.clearRect(0, 0, OFFSCREEN_WIDTH, OFFSCREEN_HEIGHT);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, OFFSCREEN_WIDTH, OFFSCREEN_HEIGHT);
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
                ctx.drawImage(offscreen.canvas, 0, 0, canvasEl.width, canvasEl.height);
            }

            // Render zoom canvas
            if (zoomedStudent && zoomCanvasRef.current) {
                const offscreen = zoomedStudent === 'teacher' 
                    ? teacherOffscreenRef.current 
                    : offscreenCanvasesRef.current.get(zoomedStudent);
                
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

    const toggleLock = () => {
        if (socketRef.current) {
            if (locked) {
                socketRef.current.emit('unlock-board');
            } else {
                socketRef.current.emit('lock-board');
            }
            setLocked(!locked);
        }
    };

    const emitTeacherDraw = useCallback((studentId, state, normX, normY) => {
        if (studentId === 'teacher') return; // Don't emit network events for local teacher board
        if (socketRef.current) {
            socketRef.current.emit('teacher-draw', {
                studentId,
                x: normX,
                y: normY,
                state,
                color: '#ef4444', // Red for teacher
                size: teacherActiveTool === 'eraser' ? 10 : 3,
                isEraser: teacherActiveTool === 'eraser'
            });
        }
    }, [teacherActiveTool]);

    const getZoomNormCoords = (e) => {
        const canvas = zoomCanvasRef.current;
        const rect = canvas.getBoundingClientRect();
        
        const cssX = e.clientX - rect.left;
        const cssY = e.clientY - rect.top;
        
        const offscreen = zoomedStudent === 'teacher' 
            ? teacherOffscreenRef.current 
            : offscreenCanvasesRef.current.get(zoomedStudent);
            
        if (!offscreen) return null;
        
        const srcW = offscreen.canvas.width;
        const srcH = offscreen.canvas.height;
        const dstW = rect.width;
        const dstH = rect.height;
        
        const scale = Math.min(dstW / srcW, dstH / srcH);
        const drawW = srcW * scale;
        const drawH = srcH * scale;
        const offsetX = (dstW - drawW) / 2;
        const offsetY = (dstH - drawH) / 2;
        
        const normX = (cssX - offsetX) / drawW;
        const normY = (cssY - offsetY) / drawH;
        
        return { normX, normY, offscreen };
    };

    const handleZoomPointerDown = (e) => {
        if (!zoomedStudent) return;
        if (e.cancelable) e.preventDefault();
        
        const coords = getZoomNormCoords(e);
        if (!coords) return;
        
        isTeacherDrawing.current = true;
        teacherLastPos.current = { normX: coords.normX, normY: coords.normY };
        
        const { offscreen, normX, normY } = coords;
        const ctx = offscreen.ctx;
        const pxX = normX * offscreen.canvas.width;
        const pxY = normY * offscreen.canvas.height;
        
        ctx.beginPath();
        if (teacherActiveTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = 20;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 3;
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(pxX, pxY);
        ctx.lineTo(pxX, pxY);
        ctx.stroke();
        
        emitTeacherDraw(zoomedStudent, 'start', normX, normY);
    };

    const handleZoomPointerMove = (e) => {
        if (!isTeacherDrawing.current || !zoomedStudent) return;
        if (e.cancelable) e.preventDefault();
        
        const coords = getZoomNormCoords(e);
        if (!coords) return;
        const { offscreen, normX, normY } = coords;
        
        const ctx = offscreen.ctx;
        const startX = teacherLastPos.current.normX * offscreen.canvas.width;
        const startY = teacherLastPos.current.normY * offscreen.canvas.height;
        const endX = normX * offscreen.canvas.width;
        const endY = normY * offscreen.canvas.height;
        
        ctx.beginPath();
        if (teacherActiveTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = 20;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 3;
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        
        teacherLastPos.current = { normX, normY };
        emitTeacherDraw(zoomedStudent, 'move', normX, normY);
    };

    const handleZoomPointerUp = (e) => {
        if (!isTeacherDrawing.current || !zoomedStudent) return;
        if (e.cancelable) e.preventDefault();
        
        isTeacherDrawing.current = false;
        
        const coords = getZoomNormCoords(e);
        if (coords) {
            emitTeacherDraw(zoomedStudent, 'end', coords.normX, coords.normY);
        }
    };

    const joinUrl = `${window.location.origin}/student?room=${roomId}`;

    const zoomedStudentName = zoomedStudent === 'teacher' 
        ? '👨‍🏫 Teacher Board' 
        : (zoomedStudent ? (students.find(s => s.socketId === zoomedStudent)?.name || 'Unknown Student') : '');

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
                    <button
                        className={styles.teachingBtn}
                        onClick={() => setZoomedStudent('teacher')}
                    >
                        👨‍🏫 Teaching
                    </button>

                    <button
                        className={locked ? styles.unlockBtn : styles.lockBtn}
                        onClick={toggleLock}
                    >
                        {locked ? '🔓 Unlock' : '🔒 Lock'}
                    </button>

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
                            <div className={styles.zoomToolbar}>
                                <button 
                                    className={`${styles.zoomToolBtn} ${teacherActiveTool === 'pen' ? styles.zoomToolActive : ''}`}
                                    onClick={() => setTeacherActiveTool('pen')}
                                >Pen</button>
                                <button 
                                    className={`${styles.zoomToolBtn} ${teacherActiveTool === 'eraser' ? styles.zoomToolActive : ''}`}
                                    onClick={() => setTeacherActiveTool('eraser')}
                                >Eraser</button>
                            </div>
                            <button className={styles.closeZoomBtn} onClick={() => setZoomedStudent(null)}>×</button>
                        </div>
                        <div className={styles.zoomCanvasWrapper}>
                            <canvas 
                                ref={zoomCanvasRef} 
                                className={styles.zoomCanvas} 
                                onPointerDown={handleZoomPointerDown}
                                onPointerMove={handleZoomPointerMove}
                                onPointerUp={handleZoomPointerUp}
                                onPointerCancel={handleZoomPointerUp}
                                onPointerLeave={handleZoomPointerUp}
                                style={{ touchAction: 'none' }}
                            />
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
