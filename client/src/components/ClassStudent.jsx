import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Pen, Eraser, Trash2 } from 'lucide-react';
import styles from './ClassStudent.module.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export default function ClassStudent() {
    const [searchParams] = useSearchParams();
    const roomId = searchParams.get('room');

    const [name, setName] = useState('');
    const [joined, setJoined] = useState(false);
    const [error, setError] = useState('');

    const [activeTool, setActiveTool] = useState('pen');
    const isDrawing = useRef(false);
    const activePointerId = useRef(null);
    const activeToolRef = useRef(activeTool);

    const canvasRef = useRef(null);
    const contextRef = useRef(null);
    const socketRef = useRef(null);
    const joinedRef = useRef(false);
    const bgImageRef = useRef(null); // stored HTMLImageElement

    useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
    useEffect(() => { joinedRef.current = joined; }, [joined]);

    // Initialize Socket and Canvas
    useEffect(() => {
        if (!joined || !roomId) return;

        socketRef.current = io(SERVER_URL);

        socketRef.current.on('connect', () => {
            socketRef.current.emit('join-room', { roomId, name, isTeacher: false });
        });

        socketRef.current.on('error', (msg) => {
            setError(msg);
            setJoined(false);
        });

        // Receive background image from server
        socketRef.current.on('room-image', (imageData) => {
            const img = new Image();
            img.onload = () => {
                bgImageRef.current = img;
                drawBackground();
            };
            img.src = imageData;
        });

        // Setup Canvas
        const canvas = canvasRef.current;
        if (canvas) {
            const handleResize = () => {
                const rect = canvas.getBoundingClientRect();
                const dpr = window.devicePixelRatio || 1;
                canvas.width = rect.width * dpr;
                canvas.height = rect.height * dpr;

                const ctx = canvas.getContext('2d');
                ctx.scale(dpr, dpr);
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                contextRef.current = ctx;

                // Redraw background on resize
                drawBackground();
            };

            handleResize();
            window.addEventListener('resize', handleResize);
            return () => {
                window.removeEventListener('resize', handleResize);
                if (socketRef.current) socketRef.current.disconnect();
            };
        }
    }, [joined, roomId, name]);

    const drawBackground = useCallback(() => {
        const ctx = contextRef.current;
        const canvas = canvasRef.current;
        if (!ctx || !canvas) return;

        const rect = canvas.getBoundingClientRect();

        if (bgImageRef.current) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(bgImageRef.current, 0, 0, rect.width, rect.height);
        }
    }, []);

    const getCoordinates = useCallback((e) => {
        if (!canvasRef.current) return { x: 0, y: 0 };
        const rect = canvasRef.current.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height
        };
    }, []);

    const setupContextMode = useCallback(() => {
        const ctx = contextRef.current;
        if (!ctx) return;

        if (activeToolRef.current === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = 20;
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3;
        }
    }, []);

    const emitDrawEvent = useCallback((state, point) => {
        if (socketRef.current && joinedRef.current) {
            socketRef.current.emit('draw', {
                ...point,
                state,
                color: '#000000',
                size: activeToolRef.current === 'eraser' ? 10 : 1.5,
                isEraser: activeToolRef.current === 'eraser'
            });
        }
    }, []);

    // Native event listeners for iPad pen reliability
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const handlePointerDown = (e) => {
            if (e.cancelable) e.preventDefault();

            const isPen = e.pointerType === 'pen' || e.pointerType === 'stylus';

            if (isDrawing.current && activePointerId.current !== null && e.pointerId !== activePointerId.current) {
                if (!isPen) return;
                isDrawing.current = false;
                activePointerId.current = null;
            }

            activePointerId.current = e.pointerId;
            isDrawing.current = true;

            const { x, y } = getCoordinates(e);

            const ctx = contextRef.current;
            if (ctx) {
                ctx.beginPath();
                const rect = canvas.getBoundingClientRect();
                setupContextMode();
                ctx.moveTo(x * rect.width, y * rect.height);
            }

            emitDrawEvent('start', { x, y });
        };

        const handlePointerMove = (e) => {
            if (!isDrawing.current) return;
            if (e.pointerId !== undefined && activePointerId.current !== null && e.pointerId !== activePointerId.current) return;

            if (e.cancelable) e.preventDefault();

            const { x, y } = getCoordinates(e);

            const ctx = contextRef.current;
            if (ctx) {
                const rect = canvas.getBoundingClientRect();
                ctx.lineTo(x * rect.width, y * rect.height);
                ctx.stroke();
            }

            emitDrawEvent('move', { x, y });
        };

        const handlePointerUp = (e) => {
            if (!isDrawing.current) return;
            if (e.pointerId !== undefined && activePointerId.current !== null && e.pointerId !== activePointerId.current) return;

            if (e.cancelable) e.preventDefault();

            isDrawing.current = false;
            activePointerId.current = null;

            const { x, y } = getCoordinates(e);
            emitDrawEvent('end', { x, y });
        };

        const handleTouchStart = (e) => {
            if (e.touches.length === 1 && e.cancelable) {
                e.preventDefault();
            }
        };

        canvas.addEventListener('pointerdown', handlePointerDown, { passive: false });
        canvas.addEventListener('pointermove', handlePointerMove, { passive: false });
        canvas.addEventListener('pointerup', handlePointerUp, { passive: false });
        canvas.addEventListener('pointerleave', handlePointerUp, { passive: false });
        canvas.addEventListener('pointercancel', handlePointerUp, { passive: false });
        canvas.addEventListener('touchstart', handleTouchStart, { passive: false });

        return () => {
            canvas.removeEventListener('pointerdown', handlePointerDown);
            canvas.removeEventListener('pointermove', handlePointerMove);
            canvas.removeEventListener('pointerup', handlePointerUp);
            canvas.removeEventListener('pointerleave', handlePointerUp);
            canvas.removeEventListener('pointercancel', handlePointerUp);
            canvas.removeEventListener('touchstart', handleTouchStart);
        };
    }, [joined, getCoordinates, setupContextMode, emitDrawEvent]);

    const clearCanvas = () => {
        const ctx = contextRef.current;
        const canvas = canvasRef.current;
        if (ctx && canvas) {
            const rect = canvas.getBoundingClientRect();
            ctx.clearRect(0, 0, rect.width, rect.height);
            // Redraw background image after clearing
            drawBackground();
        }
        if (socketRef.current) {
            socketRef.current.emit('student-clear');
        }
    };

    if (!roomId) {
        return <div style={{ padding: '2rem', textAlign: 'center' }}>No Room ID provided. Please scan a valid QR code or enter via Home page.</div>;
    }

    if (!joined) {
        return (
            <div className={styles.joinContainer}>
                <div className={styles.joinCard}>
                    <div className={styles.roomBadgeWrapper}>
                        <span className={styles.roomBadge}>Room: {roomId}</span>
                    </div>
                    <h2 className={styles.modalTitle}>Join Class Module</h2>
                    <p className={styles.modalDesc}>
                        Enter your name to start working on the worksheet.
                    </p>

                    <form onSubmit={(e) => {
                        e.preventDefault();
                        if (name.trim()) setJoined(true);
                    }}>
                        <input
                            type="text"
                            className={styles.inputField}
                            placeholder="Your full name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoFocus
                        />
                        {error && <p style={{ color: '#ef4444', marginBottom: '1rem', fontSize: '0.875rem' }}>{error}</p>}
                        <button
                            type="submit"
                            className={styles.joinBtn}
                            disabled={!name.trim()}
                        >
                            Start Writing
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Toolbar */}
            <div className={styles.toolbar}>
                <button
                    className={`${styles.toolBtn} ${activeTool === 'pen' ? styles.active : ''}`}
                    onClick={() => setActiveTool('pen')}
                    title="Pen"
                >
                    <Pen size={20} />
                </button>
                <button
                    className={`${styles.toolBtn} ${activeTool === 'eraser' ? styles.active : ''}`}
                    onClick={() => setActiveTool('eraser')}
                    title="Eraser"
                >
                    <Eraser size={20} />
                </button>

                <div className={styles.divider}></div>

                <button
                    className={`${styles.toolBtn} ${styles.clearBtn}`}
                    onClick={clearCanvas}
                    title="Clear My Canvas"
                >
                    <Trash2 size={20} />
                </button>
            </div>

            {/* Canvas */}
            <canvas
                ref={canvasRef}
                className={styles.canvas}
            />
        </div>
    );
}
