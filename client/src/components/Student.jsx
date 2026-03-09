import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { io } from 'socket.io-client';
import { Pen, Eraser, Trash2 } from 'lucide-react';
import styles from './Student.module.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export default function Student() {
    const [searchParams] = useSearchParams();
    const roomId = searchParams.get('room');

    const [name, setName] = useState('');
    const [joined, setJoined] = useState(false);
    const [error, setError] = useState('');

    const [activeTool, setActiveTool] = useState('pen'); // 'pen' | 'eraser'
    const isDrawing = useRef(false);
    const activePointerId = useRef(null);

    const canvasRef = useRef(null);
    const contextRef = useRef(null);
    const socketRef = useRef(null);

    // Initialize Socket and Canvas context when joined
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
            };

            handleResize();
            window.addEventListener('resize', handleResize);
            return () => {
                window.removeEventListener('resize', handleResize);
                if (socketRef.current) socketRef.current.disconnect();
            };
        }
    }, [joined, roomId, name]);

    const getCoordinates = (e) => {
        if (!canvasRef.current) return { x: 0, y: 0 };

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();

        return {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height
        };
    };

    const setupContextMode = () => {
        const ctx = contextRef.current;
        if (!ctx) return;

        if (activeTool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = 20; // Eraser size
        } else {
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = '#000000'; // Default black pen
            ctx.lineWidth = 3;
        }
    };

    const startDrawing = (e) => {
        // Prevent default browser actions
        if (e.target === canvasRef.current && e.cancelable) {
            e.preventDefault();
        }

        const isPen = e.pointerType === 'pen' || e.pointerType === 'stylus';

        // Ignore if we are already drawing with another pointer, UNLESS it's a pen taking over
        if (isDrawing.current && activePointerId.current !== null && e.pointerId !== activePointerId.current) {
            if (!isPen) {
                return;
            }
        }

        if (e.pointerId !== undefined) {
            activePointerId.current = e.pointerId;
            // Only capture pointer for Pen to prevent iOS Safari quirks with fingers
            if (isPen) {
                try { e.target.setPointerCapture(e.pointerId); } catch (err) { }
            }
        }

        const { x, y } = getCoordinates(e);
        isDrawing.current = true;

        const ctx = contextRef.current;
        if (ctx) {
            ctx.beginPath();
            const rect = canvasRef.current.getBoundingClientRect();
            const localX = x * rect.width;
            const localY = y * rect.height;

            setupContextMode();
            ctx.moveTo(localX, localY);
        }

        emitDrawEvent('start', { x, y });
    };

    const draw = (e) => {
        if (!isDrawing.current) return;

        // Only respond to the tracked pointer
        if (e.pointerId !== undefined && activePointerId.current !== null && e.pointerId !== activePointerId.current) {
            return;
        }

        if (e.target === canvasRef.current && e.cancelable) {
            e.preventDefault();
        }

        const { x, y } = getCoordinates(e);

        const ctx = contextRef.current;
        if (ctx) {
            const rect = canvasRef.current.getBoundingClientRect();
            const localX = x * rect.width;
            const localY = y * rect.height;
            ctx.lineTo(localX, localY);
            ctx.stroke();
        }

        emitDrawEvent('move', { x, y });
    };

    const stopDrawing = (e) => {
        if (!isDrawing.current) return;

        // Only stop if the event comes from the tracked pointer
        if (e.pointerId !== undefined && activePointerId.current !== null && e.pointerId !== activePointerId.current) {
            return;
        }

        if (e.target === canvasRef.current && e.cancelable) {
            e.preventDefault();
        }

        isDrawing.current = false;

        if (e.pointerId !== undefined) {
            if (e.pointerType === 'pen' || e.pointerType === 'stylus') {
                try { e.target.releasePointerCapture(e.pointerId); } catch (err) { }
            }
            activePointerId.current = null;
        }

        const { x, y } = getCoordinates(e);
        emitDrawEvent('end', { x, y });
    };

    const emitDrawEvent = (state, point) => {
        if (socketRef.current && joined) {
            socketRef.current.emit('draw', {
                ...point,
                state,
                color: '#000000',
                size: activeTool === 'eraser' ? 10 : 1.5,
                isEraser: activeTool === 'eraser'
            });
        }
    };

    const clearCanvas = () => {
        const ctx = contextRef.current;
        const canvas = canvasRef.current;
        if (ctx && canvas) {
            const rect = canvas.getBoundingClientRect();
            ctx.clearRect(0, 0, rect.width, rect.height);
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
                    <h2 className={styles.modalTitle}>Join Whiteboard</h2>
                    <p className={styles.modalDesc}>
                        Enter your name to start drawing with your class.
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
                            Start Drawing
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Toolbar - Floating */}
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
                    title="Clear My Canvas Locally"
                >
                    <Trash2 size={20} />
                </button>
            </div>

            {/* Canvas */}
            <canvas
                ref={canvasRef}
                className={styles.canvas}
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={stopDrawing}
                onPointerOut={stopDrawing}
                onPointerCancel={stopDrawing}
            />
        </div>
    );
}
