import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { io } from 'socket.io-client';
import styles from './Teacher.module.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export default function Teacher() {
    const [searchParams] = useSearchParams();
    const roomId = searchParams.get('room');

    const canvasRef = useRef(null);
    const contextRef = useRef(null);
    const socketRef = useRef(null);

    // UI state
    const [students, setStudents] = useState([]);
    const [showLargeQR, setShowLargeQR] = useState(false);

    // Initial setup
    useEffect(() => {
        if (!roomId) return;

        socketRef.current = io(SERVER_URL);

        socketRef.current.on('connect', () => {
            socketRef.current.emit('join-room', { roomId, name: 'Teacher', isTeacher: true });
        });

        socketRef.current.on('user-joined', ({ name, isTeacher }) => {
            if (!isTeacher) {
                setStudents(prev => [...prev, name]);
            }
        });

        socketRef.current.on('user-left', ({ name }) => {
            setStudents(prev => prev.filter(s => s !== name));
        });

        // Initialize Canvas
        const canvas = canvasRef.current;
        if (canvas) {
            const handleResize = () => {
                const parent = canvas.parentElement;
                const rect = parent.getBoundingClientRect();

                // Keep the canvas high-res based on device pixel ratio
                const dpr = window.devicePixelRatio || 1;
                canvas.width = rect.width * dpr;
                canvas.height = rect.height * dpr;

                const ctx = canvas.getContext('2d');
                ctx.scale(dpr, dpr);
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                contextRef.current = ctx;

                // Repaint white background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, rect.width, rect.height);
            };

            window.addEventListener('resize', handleResize);
            handleResize();

            return () => {
                window.removeEventListener('resize', handleResize);
                if (socketRef.current) socketRef.current.disconnect();
            };
        }
    }, [roomId]);

    // Handle incoming drawings
    useEffect(() => {
        if (!socketRef.current) return;

        const handleDraw = (data) => {
            const { x, y, state, color, size, isEraser } = data;
            const ctx = contextRef.current;
            const canvas = canvasRef.current;

            if (!ctx || !canvas) return;

            const rect = canvas.getBoundingClientRect();
            // x and y are passed as percentages to make it responsive
            const localX = x * rect.width;
            const localY = y * rect.height;

            if (state === 'start') {
                ctx.beginPath();
                ctx.moveTo(localX, localY);
            } else if (state === 'move') {
                if (isEraser) {
                    ctx.globalCompositeOperation = 'destination-out';
                    ctx.lineWidth = size * 2; // Eraser is usually larger
                } else {
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.strokeStyle = color;
                    ctx.lineWidth = size;
                }
                ctx.lineTo(localX, localY);
                ctx.stroke();
            }
        };

        const handleClear = () => {
            const ctx = contextRef.current;
            const canvas = canvasRef.current;
            if (ctx && canvas) {
                const rect = canvas.getBoundingClientRect();
                ctx.clearRect(0, 0, rect.width, rect.height);
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, rect.width, rect.height);
            }
        };

        socketRef.current.on('draw', handleDraw);
        socketRef.current.on('clear-board', handleClear);

        return () => {
            socketRef.current.off('draw', handleDraw);
            socketRef.current.off('clear-board', handleClear);
        };
    }, []);

    const clearCanvas = () => {
        if (socketRef.current) {
            socketRef.current.emit('clear-board');
        }
        // Locally clear
        const ctx = contextRef.current;
        const canvas = canvasRef.current;
        if (ctx && canvas) {
            const rect = canvas.getBoundingClientRect();
            ctx.clearRect(0, 0, rect.width, rect.height);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, rect.width, rect.height);
        }
    };

    const joinUrl = `${window.location.origin}/student?room=${roomId}`;

    return (
        <div className={styles.container}>
            {/* Sidebar / Topbar */}
            <header className={styles.header}>
                <div className={styles.headerLeft}>
                    <h1>Interactive Board</h1>
                    <div className={styles.roomBadge}>Room: {roomId}</div>
                </div>

                <div className={styles.headerRight}>
                    <button className={styles.clearBtn} onClick={clearCanvas}>
                        Clear Board
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

            {/* Main Canvas Area */}
            <main className={styles.mainCanvas}>
                <canvas ref={canvasRef} className={styles.canvas} />
            </main>

            {/* Students List Floating Panel */}
            <div className={styles.studentPanel}>
                <h3>Students ({students.length})</h3>
                <ul className={styles.studentList}>
                    {students.map((student, idx) => (
                        <li key={idx}>
                            <span className={styles.dot}></span>
                            {student}
                        </li>
                    ))}
                    {students.length === 0 && (
                        <li className={styles.emptyText}>Waiting for students...</li>
                    )}
                </ul>
            </div>

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
